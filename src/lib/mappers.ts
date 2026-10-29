import {
  MODULE_KEYS,
  type Holding,
  type HoldingVerdict,
  type Ipo,
  type IpoStatus,
  type IpoVerdict,
  type ModuleKey,
  type SipFund,
  type SipRisk,
  type SipVerdict,
  type UserStatus,
  type WorkspaceUser,
} from "@/types/domain";

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  permissions: unknown;
  status: string | null;
  created_at: string | null;
  last_active_at: string | null;
}

export interface IpoRow {
  id: string;
  company_name: string;
  type: string | null;
  sector: string | null;
  price_band_low: number | string | null;
  price_band_high: number | string | null;
  lot_size: number | string | null;
  issue_size: string | null;
  gmp: number | string | null;
  gmp_pct: number | string | null;
  ai_score: number | string | null;
  verdict: string | null;
  subscription: number | string | null;
  open_date: string | null;
  close_date: string | null;
  status: string | null;
  thesis: string | null;
  created_at: string | null;
}

export interface PortfolioRow {
  id: string;
  user_id: string;
  stock_name: string;
  symbol: string | null;
  sector: string | null;
  quantity: number | string | null;
  buy_price: number | string | null;
  current_price: number | string | null;
  ai_verdict: string | null;
  ai_reasoning: string | null;
  ai_source: string | null;
  confidence: number | string | null;
  purchase_date: string | null;
  last_analyzed_at: string | null;
  created_at: string | null;
}

export interface SipRow {
  id: string;
  fund_name: string;
  category: string | null;
  cagr: number | string | null;
  three_year: number | string | null;
  risk: string | null;
  min_sip: number | string | null;
  aum: string | null;
  ai_verdict: string | null;
  reasoning: string | null;
  sparkline: unknown;
  created_at: string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parsePermissions(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ModuleKey =>
      typeof item === "string" && MODULE_KEYS.includes(item as ModuleKey),
  );
}

function parseStatus(value: string | null): UserStatus {
  return value === "invited" || value === "suspended" ? value : "active";
}

const joinedFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const lastActiveFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatIsoDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : joinedFormatter.format(parsed);
}

function formatLastActive(value: string | null): string {
  if (!value) return "Not yet active";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not yet active"
    : lastActiveFormatter.format(parsed);
}

/** "2026-10-28" -> "28 Oct" (date-only, interpreted as UTC). */
function formatShortDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export function mapProfileRow(row: ProfileRow): WorkspaceUser {
  return {
    id: row.id,
    name:
      row.full_name?.trim() ||
      row.email?.split("@")[0] ||
      "Team member",
    email: row.email ?? "",
    role: row.role === "admin" ? "admin" : "user",
    permissions: parsePermissions(row.permissions),
    status: parseStatus(row.status),
    joinedOn: formatIsoDate(row.created_at),
    lastActive: formatLastActive(row.last_active_at),
  };
}

export function mapIpoRow(row: IpoRow): Ipo {
  const priceLow = toNumber(row.price_band_low);
  const priceHigh = toNumber(row.price_band_high);
  const gmp = toNumber(row.gmp);
  const verdict: IpoVerdict =
    row.verdict === "APPLY" || row.verdict === "AVOID" ? row.verdict : "WATCH";
  const status: IpoStatus =
    row.status === "Open" || row.status === "Closing today"
      ? row.status
      : "Upcoming";

  return {
    id: row.id,
    company: row.company_name,
    type: row.type === "SME" ? "SME" : "Mainboard",
    sector: row.sector ?? "—",
    priceBand: [priceLow, priceHigh],
    lotSize: toNumber(row.lot_size),
    issueSize: row.issue_size ?? "—",
    gmp,
    gmpPct:
      row.gmp_pct === null || row.gmp_pct === undefined
        ? priceHigh > 0
          ? (gmp / priceHigh) * 100
          : 0
        : toNumber(row.gmp_pct),
    aiScore: Math.min(10, Math.max(0, toNumber(row.ai_score))),
    verdict,
    subscription: toNumber(row.subscription),
    openDate: formatShortDate(row.open_date),
    closeDate: formatShortDate(row.close_date),
    status,
    thesis: row.thesis ?? "",
  };
}

const HOLDING_VERDICTS: HoldingVerdict[] = [
  "STRONG BUY",
  "BUY",
  "HOLD",
  "SELL",
  "STRONG SELL",
];

/** Accepts "STRONG BUY", "strong_buy" or "strong buy" from the database. */
export function parseHoldingVerdict(value: string | null): HoldingVerdict {
  const normalized = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return (
    HOLDING_VERDICTS.find((verdict) => verdict === normalized) ?? "HOLD"
  );
}

export function mapPortfolioRow(row: PortfolioRow): Holding {
  return {
    id: row.id,
    stock: row.stock_name,
    symbol: row.symbol ?? row.stock_name.slice(0, 8).toUpperCase(),
    sector: row.sector ?? "—",
    quantity: toNumber(row.quantity),
    avgPrice: toNumber(row.buy_price),
    ltp: toNumber(row.current_price),
    aiVerdict: parseHoldingVerdict(row.ai_verdict),
    aiSource:
      row.ai_source === "gemini" || row.ai_source === "placeholder"
        ? row.ai_source
        : "unknown",
    confidence: toNumber(row.confidence),
    reason: row.ai_reasoning ?? "",
    purchaseDate: row.purchase_date,
    lastAnalyzedAt: row.last_analyzed_at,
  };
}

export function mapSipRow(row: SipRow): SipFund {
  const cagr = toNumber(row.cagr);
  const threeYear = toNumber(row.three_year);
  const risk: SipRisk =
    row.risk === "Low" || row.risk === "High" ? row.risk : "Moderate";
  const aiVerdict: SipVerdict = row.ai_verdict === "START" ? "START" : "WAIT";
  const spark =
    Array.isArray(row.sparkline) && row.sparkline.length > 1
      ? row.sparkline.map((value) => toNumber(value as number | string))
      : [100, 100];

  return {
    id: row.id,
    fund: row.fund_name,
    category: row.category ?? "—",
    cagr: `${cagr.toFixed(1)}%`,
    cagrValue: cagr,
    threeYear: `${threeYear.toFixed(1)}%`,
    risk,
    minSip: toNumber(row.min_sip),
    aum: row.aum ?? "—",
    aiVerdict,
    reason: row.reasoning ?? "",
    spark,
  };
}
