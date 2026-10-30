export type ModuleKey = "ipo" | "portfolio" | "sip";
export type UserRole = "admin" | "user";
export type UserStatus = "active" | "invited" | "suspended";
export type IpoVerdict = "APPLY" | "WATCH" | "AVOID";
export type HoldingVerdict =
  | "STRONG BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG SELL";
/** Where the stored verdict came from; "unknown" covers pre-marker rows. */
export type AiSource = "gemini" | "placeholder" | "unknown";
export type SipVerdict = "START" | "WAIT";
export type IpoType = "SME" | "Mainboard";
export type IpoStatus = "Open" | "Closing today" | "Upcoming";
export type SipRisk = "Low" | "Moderate" | "High";

export const MODULE_KEYS: ModuleKey[] = ["ipo", "portfolio", "sip"];

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: ModuleKey[];
  status: UserStatus;
  joinedOn: string;
  lastActive: string;
}

export interface MarketIndex {
  id: string;
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePct: number;
  dayLow: number;
  dayHigh: number;
  spark: number[];
}

export interface Ipo {
  id: string;
  company: string;
  type: IpoType;
  sector: string;
  priceBand: [number, number];
  lotSize: number;
  issueSize: string;
  gmp: number;
  gmpPct: number;
  aiScore: number;
  verdict: IpoVerdict;
  subscription: number;
  openDate: string;
  closeDate: string;
  /** ISO date (YYYY-MM-DD) the book opens, null when the feed omits it. */
  openOn: string | null;
  /** ISO date (YYYY-MM-DD) the book closes, null when the feed omits it. */
  closeOn: string | null;
  status: IpoStatus;
  thesis: string;
}

export interface Holding {
  id: string;
  stock: string;
  symbol: string;
  sector: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  aiVerdict: HoldingVerdict;
  aiSource: AiSource;
  confidence: number;
  reason: string;
  /** ISO date (YYYY-MM-DD) the position was bought, when recorded. */
  purchaseDate: string | null;
  /** ISO timestamp of the last AI analysis, null until one has run. */
  lastAnalyzedAt: string | null;
}

export interface Stock {
  id: number;
  symbol: string;
  name: string;
  sector: string;
  marketCap: string;
  price: number;
  changePct: number;
  aiScore: number;
  verdict: HoldingVerdict;
  spark: number[];
}

export interface SipFund {
  id: string;
  fund: string;
  category: string;
  cagr: string;
  cagrValue: number;
  threeYear: string;
  risk: SipRisk;
  minSip: number;
  aum: string;
  aiVerdict: SipVerdict;
  reason: string;
  spark: number[];
}

export interface MarketMood {
  sentiment: "Bullish" | "Bearish" | "Neutral";
  score: number;
  confidence: number;
  updated: string;
  headline: string;
  drivers: {
    label: string;
    value: string;
    direction: "up" | "down" | "flat";
  }[];
}

export interface DeskNote {
  id: number;
  title: string;
  body: string;
  tag: string;
}

/** One item in the dashboard's AI desk briefing. */
export interface DeskBriefingItem {
  tag: string;
  title: string;
  body: string;
}

/** Everything the market-mood Edge Function returns for the dashboard. */
export interface MarketBriefing {
  mood: MarketMood;
  briefing: DeskBriefingItem[];
  /** ISO timestamp of the Gemini call that produced this analysis. */
  generatedAt: string;
}
