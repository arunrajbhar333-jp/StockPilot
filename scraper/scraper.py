#!/usr/bin/env python3
"""StockPilot market sync.

Fetches index levels, NSE IPO subscription data and live equity prices, writes
them to Supabase with the service role key, then asks the analyze-holding Edge
Function to refresh the AI verdict for positions that moved significantly.

Run:
    python scraper/scraper.py --dry-run     # fetch + log, write nothing
    python scraper/scraper.py               # full sync

Environment (see scraper/README.md):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    AI_TRIGGER_PCT (default 1.5), AI_MAX_ANALYSES (default 20)
    IPO_GMP_API_URL / IPO_GMP_API_KEY (optional; NSE does not publish GMP)

Only the service role key can write these tables, so this script must run in a
trusted environment (GitHub Actions secret, private VM). Never ship it to the
browser.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

LOG = logging.getLogger("stockpilot.scraper")

IST = timezone(timedelta(hours=5, minutes=30))

YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
NSE_HOME = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
NSE_UPCOMING = "https://www.nseindia.com/api/all-upcoming-issues?category=ipo"
NSE_DETAIL = "https://www.nseindia.com/api/ipo-detail?symbol={symbol}"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
}

INDICES: tuple[tuple[str, str, str], ...] = (
    ("^NSEI", "NIFTY 50", "NSE · Large-cap benchmark"),
    ("^BSESN", "SENSEX", "BSE · 30 constituents"),
    ("^NSEBANK", "BANK NIFTY", "NSE · Banking index"),
)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    request_timeout: int = 20
    ai_trigger_pct: float = 1.5
    ai_max_analyses: int = 20
    ai_delay_seconds: float = 1.0
    gmp_api_url: str | None = None
    gmp_api_key: str | None = None
    dry_run: bool = False
    skip_ai: bool = False


def _env_number(name: str, default: float, cast=float):
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return cast(raw)
    except ValueError:
        LOG.warning("Ignoring invalid %s=%r; using %s.", name, raw, default)
        return default


def config_from_env(dry_run: bool, skip_ai: bool) -> Config:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", url),
            ("SUPABASE_SERVICE_ROLE_KEY", key),
        )
        if not value
    ]
    if missing:
        raise SystemExit(
            "Missing required environment variables: "
            + ", ".join(missing)
            + ". See scraper/README.md."
        )

    return Config(
        supabase_url=url,
        service_role_key=key,
        request_timeout=int(_env_number("REQUEST_TIMEOUT", 20, int)),
        ai_trigger_pct=_env_number("AI_TRIGGER_PCT", 1.5),
        ai_max_analyses=int(_env_number("AI_MAX_ANALYSES", 20, int)),
        ai_delay_seconds=_env_number("AI_DELAY_SECONDS", 1.0),
        gmp_api_url=(os.getenv("IPO_GMP_API_URL") or "").strip() or None,
        gmp_api_key=(os.getenv("IPO_GMP_API_KEY") or "").strip() or None,
        dry_run=dry_run,
        skip_ai=skip_ai,
    )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if cleaned in ("", "-", ".", "-."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


_SUFFIXES = re.compile(
    r"\b(limited|ltd|pvt|private|corporation|corp|company|co)\b", re.IGNORECASE
)


def normalise_company(value: str) -> str:
    text = _SUFFIXES.sub(" ", (value or "").lower().replace("&", " and "))
    return re.sub(r"[^a-z0-9]", "", text)


def now_ist() -> datetime:
    return datetime.now(timezone.utc).astimezone(IST)


def parse_nse_date(value: Any) -> date | None:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def parse_price_band(value: Any) -> tuple[float | None, float | None]:
    numbers = [
        float(item) for item in re.findall(r"\d+(?:\.\d+)?", str(value or ""))
    ]
    if len(numbers) >= 2:
        low, high = numbers[0], numbers[1]
        return (min(low, high), max(low, high))
    if len(numbers) == 1:
        return (numbers[0], numbers[0])
    return (None, None)


def derive_status(open_date: date | None, close_date: date | None, today: date) -> str:
    if open_date and today < open_date:
        return "Upcoming"
    if close_date and today == close_date:
        return "Closing today"
    return "Open"


# --------------------------------------------------------------------------- #
# Yahoo Finance
# --------------------------------------------------------------------------- #


@dataclass
class Quote:
    ticker: str
    price: float
    previous_close: float
    day_low: float | None
    day_high: float | None
    spark: list[float]
    currency: str

    @property
    def change(self) -> float:
        return round(self.price - self.previous_close, 2)

    @property
    def change_pct(self) -> float:
        if self.previous_close <= 0:
            return 0.0
        return round((self.price - self.previous_close) / self.previous_close * 100, 2)


def yahoo_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": BROWSER_HEADERS["User-Agent"],
            "Accept": "application/json",
        }
    )
    return session


def fetch_quote(session: requests.Session, ticker: str, timeout: int) -> Quote | None:
    """One day of 15-minute candles from Yahoo's chart endpoint."""
    try:
        response = session.get(
            YAHOO_CHART.format(symbol=quote(ticker, safe="")),
            params={"range": "1d", "interval": "15m", "includePrePost": "false"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        LOG.warning("Yahoo quote failed for %s: %s", ticker, error)
        return None

    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        return None

    result = results[0]
    meta = result.get("meta") or {}
    quote_data = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = [
        float(value)
        for value in (quote_data.get("close") or [])
        if isinstance(value, (int, float)) and value > 0
    ]
    price = to_float(meta.get("regularMarketPrice")) or (closes[-1] if closes else None)
    previous = (
        to_float(meta.get("chartPreviousClose"))
        or to_float(meta.get("previousClose"))
        or price
    )

    if not price or not previous:
        return None

    spark = (closes or [price])[-30:]
    if len(spark) < 2:
        spark = [spark[0], spark[0]]

    return Quote(
        ticker=str(meta.get("symbol") or ticker),
        price=round(float(price), 2),
        previous_close=round(float(previous), 2),
        day_low=to_float(meta.get("regularMarketDayLow")),
        day_high=to_float(meta.get("regularMarketDayHigh")),
        spark=[round(value, 2) for value in spark],
        currency=str(meta.get("currency") or ""),
    )


def resolve_equity_quote(
    session: requests.Session, symbol: str, timeout: int
) -> Quote | None:
    """Try SYMBOL.NS, then SYMBOL.BO. Rejects non-INR listings."""
    base = re.sub(r"[^A-Z0-9.&-]", "", (symbol or "").upper())
    if not base:
        return None

    candidates = [base] if "." in base else [f"{base}.NS", f"{base}.BO"]
    for candidate in candidates:
        quote = fetch_quote(session, candidate, timeout)
        if quote and quote.currency == "INR":
            return quote
        time.sleep(0.15)
    return None


# --------------------------------------------------------------------------- #
# NSE India
# --------------------------------------------------------------------------- #


def nse_session(timeout: int) -> requests.Session:
    session = requests.Session()
    session.headers.update(BROWSER_HEADERS)
    try:
        session.get(NSE_HOME, timeout=timeout)
        session.get(NSE_HOME, timeout=timeout)
    except requests.RequestException as error:
        LOG.warning("Could not prime the NSE session: %s", error)
    return session


def nse_get_json(
    session: requests.Session, url: str, timeout: int, attempts: int = 3
) -> Any | None:
    for attempt in range(1, attempts + 1):
        try:
            response = session.get(
                url,
                headers={
                    "Referer": NSE_HOME,
                    "Accept": "application/json",
                },
                timeout=timeout,
            )
            if response.status_code in (401, 403) and attempt < attempts:
                session.get(NSE_HOME, timeout=timeout)
                time.sleep(1.0)
                continue
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            LOG.warning("NSE request failed (%s/%s) %s: %s", attempt, attempts, url, error)
            time.sleep(1.0)
    return None


@dataclass
class LiveIpo:
    company: str
    symbol: str
    series: str
    open_date: date | None
    close_date: date | None
    price_low: float | None
    price_high: float | None
    subscription: float | None
    status: str

    @property
    def issue_type(self) -> str:
        return "SME" if self.series.upper() in ("SM", "SME") else "Mainboard"


def fetch_live_ipos(session: requests.Session, config: Config) -> list[LiveIpo]:
    payload = nse_get_json(session, NSE_UPCOMING, config.request_timeout)
    if not isinstance(payload, list):
        LOG.warning("NSE returned an unexpected IPO payload; skipping IPO sync.")
        return []

    today = now_ist().date()
    issues: list[LiveIpo] = []

    for item in payload:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").strip().upper()
        company = str(item.get("companyName") or "").strip()
        if not symbol or not company:
            continue

        open_date = parse_nse_date(item.get("issueStartDate"))
        close_date = parse_nse_date(item.get("issueEndDate"))
        price_low, price_high = parse_price_band(item.get("issuePrice"))

        # Closed issues stay in the NSE payload; updating them would mislabel a
        # listed issue as "Open" in the tracker.
        if close_date and close_date < today:
            continue

        status = derive_status(open_date, close_date, today)

        # Upcoming books have no subscription yet; skip the extra request.
        subscription = None
        if status != "Upcoming":
            subscription = fetch_ipo_subscription(session, symbol, config)
            time.sleep(0.25)

        issues.append(
            LiveIpo(
                company=company,
                symbol=symbol,
                series=str(item.get("series") or "EQ"),
                open_date=open_date,
                close_date=close_date,
                price_low=price_low,
                price_high=price_high,
                subscription=subscription,
                status=status,
            )
        )

    return issues


def fetch_ipo_subscription(
    session: requests.Session, symbol: str, config: Config
) -> float | None:
    payload = nse_get_json(
        session,
        NSE_DETAIL.format(symbol=quote(symbol, safe="")),
        config.request_timeout,
    )
    if not isinstance(payload, dict):
        return None

    combined = (payload.get("demandGraphALL") or {}).get("noOfTimesIssueSubscribed")
    value = to_float(combined)
    if value is not None:
        return round(value, 2)

    nse_only = (payload.get("demandGraph") or {}).get("noOfTimesIssueSubscribed")
    value = to_float(nse_only)
    if value is not None:
        return round(value, 2)

    rows = (payload.get("activeCat") or {}).get("dataList") or []
    for row in rows:
        if isinstance(row, dict) and str(row.get("category", "")).strip().lower() == "total":
            total = to_float(row.get("noOfTotalMeant"))
            return round(total, 2) if total is not None else None
    return None


# --------------------------------------------------------------------------- #
# Optional GMP feed
# --------------------------------------------------------------------------- #


@dataclass
class GmpQuote:
    gmp: float
    price_high: float | None


@dataclass
class GmpIndex:
    by_name: dict[str, GmpQuote] = field(default_factory=dict)
    by_symbol: dict[str, GmpQuote] = field(default_factory=dict)


def fetch_gmp(config: Config) -> GmpIndex:
    """Load GMP from a licensed JSON feed.

    NSE and BSE do not publish grey-market premium, so this step is opt-in:
    point IPO_GMP_API_URL at a provider that returns a JSON array of objects
    with company/symbol and gmp fields. Without it, stored GMP values are left
    untouched while subscription and dates still refresh.
    """
    if not config.gmp_api_url:
        LOG.info(
            "IPO_GMP_API_URL is not set; keeping the GMP values already in Supabase."
        )
        return GmpIndex()

    headers = {"Accept": "application/json", "User-Agent": BROWSER_HEADERS["User-Agent"]}
    if config.gmp_api_key:
        headers["Authorization"] = f"Bearer {config.gmp_api_key}"

    try:
        response = requests.get(
            config.gmp_api_url, headers=headers, timeout=config.request_timeout
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        LOG.warning("GMP feed failed, keeping stored values: %s", error)
        return GmpIndex()

    if isinstance(payload, dict):
        for key in ("data", "ipos", "results", "items"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break

    if not isinstance(payload, list):
        LOG.warning("GMP feed did not return a list; keeping stored values.")
        return GmpIndex()

    index = GmpIndex()
    for item in payload:
        if not isinstance(item, dict):
            continue

        name = next(
            (
                str(item[key]).strip()
                for key in ("companyName", "company_name", "company", "name", "ipoName")
                if item.get(key)
            ),
            "",
        )
        symbol = str(item.get("symbol") or item.get("ticker") or "").strip().upper()

        gmp = to_float(
            next(
                (
                    item[key]
                    for key in (
                        "gmp",
                        "gmpValue",
                        "gmp_value",
                        "greyMarketPremium",
                        "grey_market_premium",
                        "premium",
                    )
                    if item.get(key) is not None
                ),
                None,
            )
        )
        if gmp is None:
            continue

        price = to_float(
            next(
                (
                    item[key]
                    for key in (
                        "price",
                        "issuePrice",
                        "issue_price",
                        "priceBandHigh",
                        "price_band_high",
                        "upperBand",
                    )
                    if item.get(key) is not None
                ),
                None,
            )
        )

        quote_value = GmpQuote(gmp=gmp, price_high=price)
        if name:
            index.by_name[normalise_company(name)] = quote_value
        if symbol:
            index.by_symbol[symbol] = quote_value

    LOG.info("Loaded GMP for %s names from the feed.", len(index.by_name))
    return index


def lookup_gmp(index: GmpIndex, issue: LiveIpo) -> GmpQuote | None:
    if issue.symbol and issue.symbol in index.by_symbol:
        return index.by_symbol[issue.symbol]

    target = normalise_company(issue.company)
    if target in index.by_name:
        return index.by_name[target]

    for name, quote_value in index.by_name.items():
        if len(name) >= 6 and (name in target or target in name):
            return quote_value
    return None


# --------------------------------------------------------------------------- #
# Supabase sync
# --------------------------------------------------------------------------- #


def sync_indices(client: Client, config: Config) -> int:
    session = yahoo_session()
    records: list[dict[str, Any]] = []

    for ticker, symbol, name in INDICES:
        quote_value = fetch_quote(session, ticker, config.request_timeout)
        if not quote_value:
            continue
        records.append(
            {
                "id": symbol.lower().replace(" ", ""),
                "symbol": symbol,
                "name": name,
                "value": quote_value.price,
                "change": quote_value.change,
                "change_pct": quote_value.change_pct,
                "day_low": quote_value.day_low,
                "day_high": quote_value.day_high,
                "spark": quote_value.spark,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        LOG.info(
            "%s %s (%+.2f%%)",
            symbol,
            f"{quote_value.price:,.2f}",
            quote_value.change_pct,
        )
        time.sleep(0.15)

    if not records:
        LOG.warning("No index quotes were available.")
        return 0

    if config.dry_run:
        LOG.info("[dry-run] would upsert %s index rows.", len(records))
        return len(records)

    try:
        client.table("market_indices").upsert(records, on_conflict="id").execute()
    except Exception as error:  # noqa: BLE001 - reported, not fatal
        LOG.warning(
            "market_indices write failed (%s). Did you run "
            "supabase/migrations/20261029190000_market_indices.sql?",
            error,
        )
        return 0

    return len(records)


def match_ipo_row(company: str, rows: Sequence[dict[str, Any]]) -> dict[str, Any] | None:
    target = normalise_company(company)
    if not target:
        return None

    for row in rows:
        if normalise_company(str(row.get("company_name") or "")) == target:
            return row

    best: tuple[int, dict[str, Any]] | None = None
    for row in rows:
        candidate = normalise_company(str(row.get("company_name") or ""))
        if len(candidate) < 6:
            continue
        if candidate in target or target in candidate:
            score = min(len(candidate), len(target))
            if best is None or score > best[0]:
                best = (score, row)
    return best[1] if best else None


def sync_ipos(client: Client, config: Config) -> tuple[int, int]:
    rows = (
        client.table("ipos")
        .select("id, company_name, type, gmp, gmp_pct")
        .execute()
        .data
        or []
    )
    if not rows:
        LOG.info("No IPO rows in Supabase; nothing to update.")
        return (0, 0)

    session = nse_session(config.request_timeout)
    issues = fetch_live_ipos(session, config)
    gmp_index = fetch_gmp(config)

    if not issues:
        LOG.warning("No live NSE issues were returned; IPO sync skipped.")
        return (0, 0)

    updated = 0
    unmatched: list[str] = []

    for issue in issues:
        row = match_ipo_row(issue.company, rows)
        if row is None:
            unmatched.append(f"{issue.company} ({issue.symbol})")
            continue

        patch: dict[str, Any] = {
            "type": issue.issue_type,
            "status": issue.status,
        }

        # Only touch fields we actually received, so a failed detail request
        # cannot blank the subscription or date that is already stored.
        if issue.subscription is not None:
            patch["subscription"] = issue.subscription
        if issue.open_date:
            patch["open_date"] = issue.open_date.isoformat()
        if issue.close_date:
            patch["close_date"] = issue.close_date.isoformat()
        if issue.price_low is not None and issue.price_high is not None:
            patch["price_band_low"] = issue.price_low
            patch["price_band_high"] = issue.price_high

        gmp_quote = lookup_gmp(gmp_index, issue)
        if gmp_quote:
            patch["gmp"] = round(gmp_quote.gmp, 2)

        effective_gmp = to_float(patch.get("gmp", row.get("gmp")))
        reference_price = issue.price_high or (gmp_quote.price_high if gmp_quote else None)
        if effective_gmp is not None and reference_price and reference_price > 0:
            patch["gmp_pct"] = round(effective_gmp / reference_price * 100, 2)

        if config.dry_run:
            LOG.info("[dry-run] IPO %s -> %s", issue.company, patch)
        else:
            client.table("ipos").update(patch).eq("id", row["id"]).execute()
        rows = [item for item in rows if item["id"] != row["id"]]
        updated += 1

    LOG.info("IPO sync: %s updated, %s unmatched.", updated, len(unmatched))
    for name in unmatched:
        LOG.info("  unmatched live issue: %s", name)

    return (updated, len(unmatched))


def sync_portfolio(client: Client, config: Config) -> dict[str, Any]:
    rows = (
        client.table("portfolio")
        .select("id, user_id, symbol, stock_name, current_price, last_analyzed_at")
        .execute()
        .data
        or []
    )

    if not rows:
        LOG.info("No portfolio holdings to update.")
        return {"rows": 0, "symbols": 0, "missing": 0, "analyses": 0}

    # Group by upper-case symbol for quoting, but write by row id so mixed-case
    # spellings of the same ticker are all updated.
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        stored = str(row.get("symbol") or "").strip()
        if not stored:
            continue
        groups.setdefault(stored.upper(), []).append(row)

    session = yahoo_session()
    updated_rows = 0
    missing = 0
    triggers: list[tuple[float, str, str, float | None]] = []

    for symbol, holdings in sorted(groups.items()):
        quote_value = resolve_equity_quote(session, symbol, config.request_timeout)
        if not quote_value:
            LOG.warning("No NSE/BSE quote for %s; leaving its price unchanged.", symbol)
            missing += len(holdings)
            continue

        price = quote_value.price
        if not config.dry_run:
            client.table("portfolio").update({"current_price": price}).in_(
                "id", [row["id"] for row in holdings]
            ).execute()
        else:
            LOG.info("[dry-run] would set %s.current_price = %s", symbol, price)

        for row in holdings:
            old_price = to_float(row.get("current_price")) or 0.0
            change_pct = (
                (price - old_price) / old_price * 100 if old_price > 0 else None
            )
            stale = not row.get("last_analyzed_at")

            if (
                stale
                or change_pct is None
                or abs(change_pct) >= config.ai_trigger_pct
            ):
                triggers.append(
                    (abs(change_pct) if change_pct is not None else 0.0, row["id"], symbol, change_pct)
                )

        updated_rows += len(holdings)
        LOG.info(
            "%s -> ₹%.2f (%s%%) across %s holding(s)",
            symbol,
            price,
            f"{quote_value.change_pct:+.2f}",
            len(holdings),
        )
        time.sleep(0.2)

    LOG.info(
        "Portfolio sync: %s rows across %s symbols, %s unquoted.",
        updated_rows,
        len(groups),
        missing,
    )

    analyses = 0
    if config.skip_ai:
        LOG.info("AI refresh skipped (--skip-ai).")
    elif triggers:
        triggers.sort(key=lambda item: item[0], reverse=True)
        selected = triggers[: max(0, config.ai_max_analyses)]
        LOG.info(
            "AI refresh: %s of %s moved %.2f%% or more; analysing %s.",
            len(triggers),
            len(rows),
            config.ai_trigger_pct,
            len(selected),
        )
        for _, holding_id, symbol, change_pct in selected:
            if config.dry_run:
                LOG.info(
                    "[dry-run] would analyse %s (%s).",
                    symbol,
                    "first review" if change_pct is None else f"{change_pct:+.2f}%",
                )
                continue
            analyses += request_analysis(config, holding_id, symbol, change_pct)
            time.sleep(max(0.0, config.ai_delay_seconds))
    else:
        LOG.info("AI refresh: no holding moved %.2f%% or more.", config.ai_trigger_pct)

    return {
        "rows": updated_rows,
        "symbols": len(groups),
        "missing": missing,
        "analyses": analyses,
    }


def request_analysis(
    config: Config, holding_id: str, symbol: str, change_pct: float | None
) -> int:
    url = f"{config.supabase_url}/functions/v1/analyze-holding"
    headers = {
        "Authorization": f"Bearer {config.service_role_key}",
        "apikey": config.service_role_key,
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            url, headers=headers, json={"holdingId": holding_id}, timeout=90
        )
    except requests.RequestException as error:
        LOG.warning("AI call failed for %s: %s", symbol, error)
        return 0

    if response.status_code >= 400:
        LOG.warning(
            "AI call for %s returned %s: %s",
            symbol,
            response.status_code,
            response.text[:200].replace("\n", " "),
        )
        return 0

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if payload.get("skipped"):
        LOG.warning("AI call for %s skipped: %s", symbol, payload.get("reason"))
        return 0

    LOG.info(
        "%s re-analysed: %s (%s)%s",
        symbol,
        payload.get("verdict", "?"),
        payload.get("source", "?"),
        "" if change_pct is None else f" after {change_pct:+.2f}%",
    )
    return 1


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync StockPilot market data from public feeds.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and log everything but write nothing and call no AI function.",
    )
    parser.add_argument(
        "--skip-ai",
        action="store_true",
        help="Update prices but do not invoke analyze-holding.",
    )
    parser.add_argument(
        "--skip-ipos",
        action="store_true",
        help="Skip the NSE IPO sync for this run.",
    )
    parser.add_argument(
        "--skip-indices",
        action="store_true",
        help="Skip the index snapshot for this run.",
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    # Supports scraper/.env no matter which directory the command runs from.
    load_dotenv(Path(__file__).resolve().parent / ".env")
    load_dotenv()
    args = parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        config = config_from_env(dry_run=args.dry_run, skip_ai=args.skip_ai)
        client = create_client(config.supabase_url, config.service_role_key)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        LOG.error("Could not create the Supabase client: %s", error)
        return 1

    started = time.monotonic()
    LOG.info(
        "StockPilot market sync starting%s.",
        " (dry run)" if config.dry_run else "",
    )

    indices_written = 0
    ipo_counts = (0, 0)
    portfolio_summary = {"rows": 0, "symbols": 0, "missing": 0, "analyses": 0}

    try:
        if not args.skip_indices:
            indices_written = sync_indices(client, config)
        if not args.skip_ipos:
            ipo_counts = sync_ipos(client, config)
        portfolio_summary = sync_portfolio(client, config)
    except Exception:
        LOG.exception("Market sync aborted.")
        return 1

    LOG.info(
        "Done in %.1fs | indices %s | IPOs %s updated / %s unmatched | "
        "portfolio %s rows, %s symbols, %s unquoted | AI %s",
        time.monotonic() - started,
        indices_written,
        ipo_counts[0],
        ipo_counts[1],
        portfolio_summary["rows"],
        portfolio_summary["symbols"],
        portfolio_summary["missing"],
        portfolio_summary["analyses"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
