#!/usr/bin/env python3
"""StockPilot market sync.

Fetches index levels, live IPO data and equity prices, writes them to Supabase
with the service role key, then asks the analyze-holding Edge Function to
refresh the AI verdict for positions that moved significantly. Every IPO it
inserts is immediately handed to analyze-ipo, which grades the issue with
Gemini and stores the score, verdict and underwriting note on the row.

IPO data comes from NSE first. NSE blocks most datacenter IPs (GitHub Actions
routinely gets 401/403 or an empty payload), so when it returns no usable
issues the scraper falls back to IPOWatch's public pages, which also carry the
grey-market premium and total subscription that NSE does not publish.

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
from html.parser import HTMLParser
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

# Fallback source: server-rendered WordPress tables, no JavaScript needed.
IPOWATCH_BASE = "https://ipowatch.in"
IPOWATCH_UPCOMING = f"{IPOWATCH_BASE}/upcoming-ipo-list/"
IPOWATCH_GMP = f"{IPOWATCH_BASE}/ipo-grey-market-premium-latest-ipo-gmp/"
IPOWATCH_SUBSCRIPTION = f"{IPOWATCH_BASE}/ipo-subscription-status-today/"

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
    # IPOWatch publishes GMP directly; the NSE path leaves this empty and relies
    # on the optional IPO_GMP_API_URL feed instead.
    gmp: float | None = None
    issue_size: str | None = None

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

    LOG.info(
        "NSE returned %s live issues (%s in the raw payload).",
        len(issues),
        len(payload),
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
# IPOWatch fallback
# --------------------------------------------------------------------------- #
# NSE serves its API only to browser-like sessions from Indian consumer IPs;
# datacenter runners usually get 401/403 or an empty array. IPOWatch publishes
# the same issues as plain server-rendered tables, including GMP and total
# subscription, so it is a complete fallback rather than a partial one.

_MONTHS = {
    datetime(2000, month, 1).strftime("%b").lower(): month for month in range(1, 13)
}

_STATUS_SUFFIX = re.compile(
    r"\s+(?:open|closed|upcoming|closing today|listed|allotment)\s*$", re.IGNORECASE
)


class _TableParser(HTMLParser):
    """Collects every <table> as a list of rows of whitespace-normalised cells."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            # IPOWatch puts the status badge after a <br> in the company cell.
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None
            self._row = None
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            self._table.append(self._row)
            self._row = None
            self._cell = None
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def fetch_html(url: str, config: Config) -> str | None:
    headers = {**BROWSER_HEADERS, "Accept": "text/html,application/xhtml+xml"}
    try:
        response = requests.get(url, headers=headers, timeout=config.request_timeout)
        response.raise_for_status()
        LOG.debug("Fetched %s (%s bytes).", url, len(response.text))
        return response.text
    except requests.RequestException as error:
        LOG.warning("IPOWatch request failed for %s: %s", url, error)
        return None


def parse_html_tables(html: str) -> list[list[list[str]]]:
    parser = _TableParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:  # noqa: BLE001 - malformed markup is not fatal
        LOG.warning("Could not parse an IPOWatch page: %s", error)
    return parser.tables


def clean_company_name(value: str) -> str:
    return _STATUS_SUFFIX.sub("", (value or "").strip()).strip(" -–\t")


def column_index(headers: Sequence[str], *names: str) -> int | None:
    """Header-name lookup: ignores punctuation/case, e.g. 'Total (X)' -> 'total x'."""
    normalised = [re.sub(r"[^a-z ]", "", header.lower()).strip() for header in headers]
    for name in names:
        if name in normalised:
            return normalised.index(name)
    return None


def parse_ipowatch_dates(value: str, today: date) -> tuple[date | None, date | None]:
    """'29-2 Nov' -> (2026-10-29, 2026-11-02); '28-30 Oct' -> same-month range.

    IPOWatch omits the year and renders one rolling list, so the current year is
    assumed. Anything more than ~7 months ahead is last year's listing, and a
    window almost a year old is next year's calendar (e.g. "2-4 Jan" read in
    late December). A start day above the end day means the window opened in the
    previous month, so December/January windows span two years.
    """
    text = (value or "").strip()
    match = re.search(r"(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})", text)
    if not match:
        return (None, None)

    start_day = int(match.group(1))
    end_day = int(match.group(2))
    month = _MONTHS.get(match.group(3)[:3].lower())
    if month is None:
        return (None, None)

    def build(year: int) -> tuple[date, date] | None:
        start_month, start_year = month, year
        if start_day > end_day:
            start_month = 12 if month == 1 else month - 1
            start_year = year - 1 if month == 1 else year
        try:
            return (
                date(start_year, start_month, start_day),
                date(year, month, end_day),
            )
        except ValueError:
            return None

    window = build(today.year)
    if window is None:
        return (None, None)

    offset = (window[1] - today).days
    if offset > 200:
        window = build(today.year - 1) or window
    elif offset < -330:
        window = build(today.year + 1) or window

    return window


def parse_ipowatch_upcoming(
    tables: Sequence[list[list[str]]], today: date
) -> list[dict[str, Any]]:
    """Both upcoming tables: mainboard ('IPO Date') and SME ('Platform')."""
    records: list[dict[str, Any]] = []

    for table in tables:
        if len(table) < 2:
            continue

        headers = table[0]
        name_col = column_index(headers, "company", "ipo", "ipo name")
        date_col = column_index(headers, "ipo date", "date")
        band_col = column_index(headers, "ipo price band", "price band")
        if name_col is None or date_col is None or band_col is None:
            continue

        size_col = column_index(headers, "ipo size")
        platform_col = column_index(headers, "platform")

        for row in table[1:]:
            if len(row) <= max(name_col, date_col, band_col):
                continue

            company = clean_company_name(row[name_col])
            if len(company) < 2:
                continue

            open_date, close_date = parse_ipowatch_dates(row[date_col], today)
            if close_date is None:
                LOG.debug("Skipping %s: could not read dates from %r.", company, row[date_col])
                continue
            if close_date < today:
                continue

            platform = row[platform_col] if platform_col is not None and len(row) > platform_col else ""
            price_low, price_high = parse_price_band(row[band_col])

            records.append(
                {
                    "company": company,
                    "type": "SME" if "sme" in platform.lower() else "Mainboard",
                    "open_date": open_date,
                    "close_date": close_date,
                    "price_low": price_low,
                    "price_high": price_high,
                    "issue_size": (row[size_col].strip() if size_col is not None and len(row) > size_col else None) or None,
                }
            )

    return records


def parse_ipowatch_gmp(tables: Sequence[list[list[str]]]) -> dict[str, float]:
    quotes: dict[str, float] = {}
    for table in tables:
        if len(table) < 2:
            continue
        headers = table[0]
        name_col = column_index(headers, "company", "ipo", "ipo name")
        gmp_col = column_index(headers, "gmp", "last gmp", "gmp today")
        if name_col is None or gmp_col is None:
            continue

        for row in table[1:]:
            if len(row) <= max(name_col, gmp_col):
                continue
            company = clean_company_name(row[name_col])
            value = to_float(row[gmp_col])
            if company and value is not None:
                quotes[normalise_company(company)] = value
    return quotes


def parse_ipowatch_subscription(tables: Sequence[list[list[str]]]) -> dict[str, float]:
    subscriptions: dict[str, float] = {}
    for table in tables:
        if len(table) < 2:
            continue
        headers = table[0]
        name_col = column_index(headers, "ipo name", "company", "ipo")
        total_col = column_index(headers, "total x", "total", "total subscription")
        if name_col is None or total_col is None:
            continue

        for row in table[1:]:
            if len(row) <= max(name_col, total_col):
                continue
            company = clean_company_name(row[name_col])
            value = to_float(row[total_col])
            if company and value is not None:
                subscriptions[normalise_company(company)] = value
    return subscriptions


def lookup_by_company(values: dict[str, float], company: str) -> float | None:
    """Exact normalised match first, then the same substring rule match_ipo_row uses."""
    target = normalise_company(company)
    if not target:
        return None
    if target in values:
        return values[target]
    for candidate, value in values.items():
        if len(candidate) >= 6 and (candidate in target or target in candidate):
            return value
    return None


def ipowatch_symbol(company: str) -> str:
    """IPOWatch has no NSE symbol; keep a stable slug for logs and GMP matching."""
    slug = re.sub(r"[^A-Z0-9]", "", company.upper())[:14]
    return slug or "IPO"


def fetch_ipowatch(config: Config) -> tuple[list[LiveIpo], dict[str, float]]:
    """All live/upcoming issues plus the raw GMP map (used to top up NSE rows)."""
    today = now_ist().date()

    upcoming_html = fetch_html(IPOWATCH_UPCOMING, config)
    if not upcoming_html:
        LOG.error("IPOWatch fallback failed: the upcoming-IPO list could not be fetched.")
        return ([], {})

    records = parse_ipowatch_upcoming(parse_html_tables(upcoming_html), today)
    if not records:
        LOG.error("IPOWatch fallback failed: no live or upcoming issues were parsed.")
        return ([], {})

    sme_count = sum(1 for record in records if record["type"] == "SME")
    LOG.info(
        "IPOWatch upcoming list: %s open/upcoming issues (%s SME, %s mainboard).",
        len(records),
        sme_count,
        len(records) - sme_count,
    )

    quotes: dict[str, float] = {}
    gmp_html = fetch_html(IPOWATCH_GMP, config)
    if gmp_html:
        quotes = parse_ipowatch_gmp(parse_html_tables(gmp_html))
        LOG.info("IPOWatch GMP page: %s quotes parsed.", len(quotes))
    else:
        LOG.warning("IPOWatch GMP page unavailable; GMP values will be left as stored.")

    subscriptions: dict[str, float] = {}
    subscription_html = fetch_html(IPOWATCH_SUBSCRIPTION, config)
    if subscription_html:
        subscriptions = parse_ipowatch_subscription(parse_html_tables(subscription_html))
        LOG.info("IPOWatch subscription page: %s subscriptions parsed.", len(subscriptions))
    else:
        LOG.warning(
            "IPOWatch subscription page unavailable; subscription will be left as stored."
        )

    issues: list[LiveIpo] = []
    gmp_matched = 0
    subscription_matched = 0

    for record in records:
        company = str(record["company"])
        gmp = lookup_by_company(quotes, company)
        if gmp is not None:
            gmp_matched += 1

        status = derive_status(record["open_date"], record["close_date"], today)
        # Books that have not opened yet carry no subscription; the subscription
        # page may still hold an older issue under a similar name.
        subscription = None
        if status != "Upcoming":
            subscription = lookup_by_company(subscriptions, company)
            if subscription is not None:
                subscription_matched += 1

        issues.append(
            LiveIpo(
                company=company,
                symbol=ipowatch_symbol(company),
                series="SM" if record["type"] == "SME" else "EQ",
                open_date=record["open_date"],
                close_date=record["close_date"],
                price_low=record["price_low"],
                price_high=record["price_high"],
                subscription=subscription,
                status=status,
                gmp=gmp,
                issue_size=record["issue_size"],
            )
        )

    LOG.info(
        "IPOWatch matched GMP for %s/%s issues and subscription for %s/%s.",
        gmp_matched,
        len(issues),
        subscription_matched,
        len(issues),
    )
    return (issues, quotes)


def apply_ipowatch_gmp(quotes: dict[str, float], issues: Sequence[LiveIpo]) -> int:
    """NSE never publishes GMP; fill any missing premium from the IPOWatch map."""
    filled = 0
    for issue in issues:
        if issue.gmp is not None:
            continue
        value = lookup_by_company(quotes, issue.company)
        if value is not None:
            issue.gmp = value
            filled += 1
    return filled


def fetch_ipos(config: Config) -> tuple[list[LiveIpo], str]:
    """NSE first; IPOWatch supplies what NSE blocks, omits, or never publishes.

    NSE's list only carries NSE issues and has no GMP, so IPOWatch is always
    read as a supplement. When NSE is blocked the supplement becomes the whole
    dataset, which is the common case on GitHub Actions runners.
    """
    session = nse_session(config.request_timeout)
    try:
        nse_issues = fetch_live_ipos(session, config)
    except Exception as error:  # noqa: BLE001 - NSE is best-effort
        LOG.warning("NSE IPO fetch raised: %s", error)
        nse_issues = []

    ipowatch_issues, quotes = fetch_ipowatch(config)

    if not nse_issues:
        LOG.warning(
            "NSE returned 0 usable issues - using the IPOWatch fallback (%s issues).",
            len(ipowatch_issues),
        )
        return (ipowatch_issues, "ipowatch")

    LOG.info("Using NSE as the primary IPO source (%s issues).", len(nse_issues))

    filled = apply_ipowatch_gmp(quotes, nse_issues)
    if filled:
        LOG.info(
            "IPOWatch filled GMP for %s/%s NSE issues.", filled, len(nse_issues)
        )

    known = {normalise_company(issue.company) for issue in nse_issues}
    extra: list[LiveIpo] = []
    for issue in ipowatch_issues:
        key = normalise_company(issue.company)
        if not key or key in known:
            continue
        known.add(key)
        extra.append(issue)

    if extra:
        LOG.info(
            "IPOWatch added %s live issues that NSE did not list (mostly BSE SME).",
            len(extra),
        )
        nse_issues.extend(extra)

    return (nse_issues, "nse+ipowatch" if extra else "nse")


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
    """Insert live issues that are missing and refresh the ones already stored.

    Returns (rows written, rows skipped). Nothing is deleted: closed issues stay
    in the table so the tracker keeps its history.
    """
    rows = (
        client.table("ipos")
        .select("id, company_name, type, gmp, gmp_pct")
        .execute()
        .data
        or []
    )
    LOG.info("Supabase ipos table holds %s rows before the sync.", len(rows))

    issues, source = fetch_ipos(config)
    gmp_index = fetch_gmp(config)

    if not issues:
        LOG.error(
            "No live IPO data from NSE or IPOWatch; the ipos table was left unchanged."
        )
        return (0, 0)

    today = now_ist().date()
    inserted = 0
    updated = 0
    skipped = 0
    seen: set[str] = set()
    # (id, company) of rows created in this run, scored by analyze-ipo at the end.
    new_ipo_ids: list[tuple[str, str]] = []

    for issue in issues:
        key = normalise_company(issue.company)
        if not key or key in seen:
            skipped += 1
            continue
        seen.add(key)

        if issue.close_date and issue.close_date < today:
            LOG.debug(
                "Skipping %s: the issue closed on %s.", issue.company, issue.close_date
            )
            skipped += 1
            continue

        row = match_ipo_row(issue.company, rows)

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
        if issue.issue_size:
            patch["issue_size"] = issue.issue_size

        # A configured GMP provider wins; otherwise use the premium IPOWatch
        # publishes, and only then leave the stored value alone.
        gmp_quote = lookup_gmp(gmp_index, issue)
        if gmp_quote:
            patch["gmp"] = round(gmp_quote.gmp, 2)
        elif issue.gmp is not None:
            patch["gmp"] = round(issue.gmp, 2)

        effective_gmp = to_float(patch.get("gmp", row.get("gmp") if row else 0))
        reference_price = issue.price_high or (gmp_quote.price_high if gmp_quote else None)
        if effective_gmp is not None and reference_price and reference_price > 0:
            patch["gmp_pct"] = round(effective_gmp / reference_price * 100, 2)

        if row is not None:
            if config.dry_run:
                LOG.info("[dry-run] IPO update %s -> %s", issue.company, patch)
            else:
                client.table("ipos").update(patch).eq("id", row["id"]).execute()
                LOG.debug("Updated IPO %s (%s).", issue.company, patch)
            rows = [item for item in rows if item["id"] != row["id"]]
            updated += 1
            continue

        payload: dict[str, Any] = {"company_name": issue.company, **patch}

        if config.dry_run:
            LOG.info("[dry-run] IPO insert %s -> %s", issue.company, payload)
            inserted += 1
            continue

        try:
            created = (
                client.table("ipos").insert(payload).select("id").execute().data or []
            )
        except Exception as error:  # noqa: BLE001 - one bad row must not stop the run
            LOG.error("Could not insert IPO %s: %s", issue.company, error)
            skipped += 1
            continue

        LOG.info(
            "Inserted IPO %s (%s, %s, closes %s).",
            issue.company,
            issue.issue_type,
            issue.status,
            issue.close_date.isoformat() if issue.close_date else "unknown",
        )
        if created:
            new_id = str(created[0]["id"])
            rows.append(
                {
                    "id": new_id,
                    "company_name": issue.company,
                    "gmp": patch.get("gmp"),
                }
            )
            new_ipo_ids.append((new_id, issue.company))
        inserted += 1

    LOG.info(
        "IPO sync via %s: %s inserted, %s updated, %s skipped.",
        source.upper(),
        inserted,
        updated,
        skipped,
    )

    # Fresh rows land with ai_score 0.0 / WATCH, so grade them right away
    # instead of waiting for the next manual pass.
    if new_ipo_ids and config.skip_ai:
        LOG.info("IPO AI scoring skipped (--skip-ai).")
    elif new_ipo_ids:
        LOG.info(
            "IPO AI scoring: analysing %s new issue(s) via analyze-ipo.",
            len(new_ipo_ids),
        )
        scored = 0
        for ipo_id, company in new_ipo_ids:
            scored += request_ipo_analysis(config, ipo_id, company)
            time.sleep(max(0.0, config.ai_delay_seconds))
        LOG.info(
            "IPO AI scoring: %s/%s new issue(s) updated.", scored, len(new_ipo_ids)
        )

    return (inserted + updated, skipped)


def rescore_ipos(client: Client, config: Config) -> int:
    """One-off backfill: grade issues that still sit at the default 0.0 / WATCH.

    Rows inserted before analyze-ipo existed never went through the AI pass, so
    `--rescore-ipos` scores up to AI_MAX_ANALYSES of them per run.
    """
    rows = (
        client.table("ipos")
        .select("id, company_name")
        .eq("ai_score", 0)
        .limit(max(0, config.ai_max_analyses))
        .execute()
        .data
        or []
    )

    if not rows:
        LOG.info("IPO rescore: every issue already has an AI score.")
        return 0

    LOG.info("IPO rescore: %s issue(s) at 0.0 / WATCH.", len(rows))
    rescored = 0
    for row in rows:
        if config.dry_run:
            LOG.info("[dry-run] would score %s.", row.get("company_name"))
            continue
        rescored += request_ipo_analysis(
            config, str(row["id"]), str(row.get("company_name") or "issue")
        )
        time.sleep(max(0.0, config.ai_delay_seconds))

    LOG.info("IPO rescore: %s/%s issue(s) updated.", rescored, len(rows))
    return rescored


def request_ipo_analysis(config: Config, ipo_id: str, company: str) -> int:
    """Ask analyze-ipo to score one issue. Returns 1 when the row was updated."""
    url = f"{config.supabase_url}/functions/v1/analyze-ipo"
    headers = {
        "Authorization": f"Bearer {config.service_role_key}",
        "apikey": config.service_role_key,
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            url, headers=headers, json={"ipo_id": ipo_id}, timeout=90
        )
    except requests.RequestException as error:
        LOG.warning("IPO AI call failed for %s: %s", company, error)
        return 0

    if response.status_code >= 400:
        LOG.warning(
            "IPO AI call for %s returned %s: %s",
            company,
            response.status_code,
            response.text[:200].replace("\n", " "),
        )
        return 0

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if payload.get("skipped"):
        LOG.warning(
            "IPO AI call for %s skipped: %s", company, payload.get("reason")
        )
        return 0

    LOG.info(
        "%s scored: %s at %s/10",
        company,
        payload.get("verdict", "?"),
        payload.get("aiScore", "?"),
    )
    return 1


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
        help="Update prices and IPOs but invoke neither analyze-holding nor analyze-ipo.",
    )
    parser.add_argument(
        "--skip-ipos",
        action="store_true",
        help="Skip the NSE IPO sync for this run.",
    )
    parser.add_argument(
        "--rescore-ipos",
        action="store_true",
        help=(
            "Backfill: score existing IPO rows still at the default 0.0 / WATCH "
            "(up to AI_MAX_ANALYSES per run)."
        ),
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
        if args.rescore_ipos:
            if config.skip_ai:
                LOG.info("IPO rescore skipped (--skip-ai).")
            else:
                rescore_ipos(client, config)
        portfolio_summary = sync_portfolio(client, config)
    except Exception:
        LOG.exception("Market sync aborted.")
        return 1

    LOG.info(
        "Done in %.1fs | indices %s | IPOs %s written / %s skipped | "
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
