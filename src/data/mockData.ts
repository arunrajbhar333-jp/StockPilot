/**
 * Phase 1 mock dataset.
 *
 * Shapes mirror the tables planned for Supabase so this file can be replaced by
 * real queries later without touching component props:
 * users -> profiles, ipos -> ipo_issues, portfolio -> holdings, sips -> funds.
 */

export type ModuleKey = "ipo" | "portfolio" | "sip";
export type UserRole = "admin" | "user";
export type UserStatus = "active" | "invited" | "suspended";
export type IpoVerdict = "APPLY" | "WATCH" | "AVOID";
export type HoldingVerdict = "BUY" | "HOLD" | "SELL";
export type SipVerdict = "START" | "WAIT";

export interface User {
  id: number;
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
  id: number;
  company: string;
  type: "SME" | "Mainboard";
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
  status: "Open" | "Closing today" | "Upcoming";
  thesis: string;
}

export interface Holding {
  id: number;
  stock: string;
  symbol: string;
  sector: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  aiVerdict: HoldingVerdict;
  confidence: number;
  reason: string;
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
  id: number;
  fund: string;
  category: string;
  cagr: string;
  cagrValue: number;
  threeYear: string;
  risk: "Low" | "Moderate" | "High";
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

export const modules: { key: ModuleKey; label: string; description: string }[] = [
  {
    key: "ipo",
    label: "IPO Tracker",
    description: "Live GMP, subscriptions and AI issue scores",
  },
  {
    key: "portfolio",
    label: "My Portfolio",
    description: "Holdings with AI buy / hold / sell verdicts",
  },
  {
    key: "sip",
    label: "Smart SIP",
    description: "Fund shortlists, CAGR history and SIP signals",
  },
];

export const users: User[] = [
  {
    id: 1,
    name: "Arun Mehta",
    email: "arun@stockpilot.io",
    role: "admin",
    permissions: ["ipo", "portfolio", "sip"],
    status: "active",
    joinedOn: "12 Jan 2026",
    lastActive: "Online now",
  },
  {
    id: 2,
    name: "Priya Nair",
    email: "priya@stockpilot.io",
    role: "user",
    permissions: ["ipo", "sip"],
    status: "active",
    joinedOn: "04 Mar 2026",
    lastActive: "12 minutes ago",
  },
  {
    id: 3,
    name: "Rohan Iyer",
    email: "rohan@stockpilot.io",
    role: "user",
    permissions: ["ipo", "portfolio", "sip"],
    status: "invited",
    joinedOn: "22 Oct 2026",
    lastActive: "Invite pending",
  },
  {
    id: 4,
    name: "Meera Shah",
    email: "meera@stockpilot.io",
    role: "user",
    permissions: ["portfolio"],
    status: "active",
    joinedOn: "18 Jun 2026",
    lastActive: "3 hours ago",
  },
  {
    id: 5,
    name: "Vikram Rao",
    email: "vikram@stockpilot.io",
    role: "user",
    permissions: ["ipo"],
    status: "suspended",
    joinedOn: "09 Feb 2026",
    lastActive: "14 Sep 2026",
  },
];

export const indices: MarketIndex[] = [
  {
    id: "nifty",
    symbol: "NIFTY 50",
    name: "NSE · Large-cap benchmark",
    value: 24812.35,
    change: 152.4,
    changePct: 0.62,
    dayLow: 24680.15,
    dayHigh: 24859.8,
    spark: [24630, 24695, 24662, 24740, 24712, 24788, 24755, 24830, 24812],
  },
  {
    id: "sensex",
    symbol: "SENSEX",
    name: "BSE · 30 constituents",
    value: 81246.18,
    change: 436.92,
    changePct: 0.54,
    dayLow: 80710.4,
    dayHigh: 81412.6,
    spark: [80760, 80840, 80815, 80990, 80945, 81080, 81020, 81190, 81246],
  },
  {
    id: "banknifty",
    symbol: "BANK NIFTY",
    name: "NSE · Banking index",
    value: 51884.7,
    change: -84.2,
    changePct: -0.16,
    dayLow: 51740.25,
    dayHigh: 52196.5,
    spark: [52140, 52060, 52110, 51980, 52040, 51910, 51960, 51840, 51884],
  },
];

export const ipos: Ipo[] = [
  {
    id: 1,
    company: "BLS Poly",
    type: "SME",
    sector: "Packaging",
    priceBand: [72, 76],
    lotSize: 1600,
    issueSize: "₹48.2 Cr",
    gmp: 40,
    gmpPct: 52.6,
    aiScore: 8.5,
    verdict: "APPLY",
    subscription: 14.8,
    openDate: "28 Oct",
    closeDate: "30 Oct",
    status: "Open",
    thesis:
      "GMP of 53% with a 14.8x SME book, and FY26 margins running 240 bps above the SME packaging median.",
  },
  {
    id: 2,
    company: "NexaGrid Energy",
    type: "Mainboard",
    sector: "Renewable energy",
    priceBand: [382, 401],
    lotSize: 35,
    issueSize: "₹1,840 Cr",
    gmp: 112,
    gmpPct: 27.9,
    aiScore: 9.1,
    verdict: "APPLY",
    subscription: 22.4,
    openDate: "27 Oct",
    closeDate: "31 Oct",
    status: "Open",
    thesis:
      "Order book covers 2.6x FY26 revenue and anchor allocation is dominated by long-only funds. Strongest issue of the cycle.",
  },
  {
    id: 3,
    company: "Vaidya Lifesciences",
    type: "Mainboard",
    sector: "Pharma",
    priceBand: [645, 678],
    lotSize: 22,
    issueSize: "₹1,210 Cr",
    gmp: 64,
    gmpPct: 9.4,
    aiScore: 7.8,
    verdict: "APPLY",
    subscription: 8.6,
    openDate: "29 Oct",
    closeDate: "02 Nov",
    status: "Upcoming",
    thesis:
      "Priced at 26x FY26 earnings versus 32x for listed CDMO peers, with 18% revenue CAGR over three years.",
  },
  {
    id: 4,
    company: "Kalyani Precision",
    type: "SME",
    sector: "Capital goods",
    priceBand: [118, 124],
    lotSize: 1000,
    issueSize: "₹36.4 Cr",
    gmp: 18,
    gmpPct: 14.5,
    aiScore: 6.4,
    verdict: "WATCH",
    subscription: 5.2,
    openDate: "28 Oct",
    closeDate: "30 Oct",
    status: "Closing today",
    thesis:
      "Reasonable business, but the entire float is 4.2% of capital and client concentration above 60% caps conviction.",
  },
  {
    id: 5,
    company: "Suryoday Coatings",
    type: "Mainboard",
    sector: "Chemicals",
    priceBand: [246, 259],
    lotSize: 57,
    issueSize: "₹620 Cr",
    gmp: 28,
    gmpPct: 10.8,
    aiScore: 7.0,
    verdict: "WATCH",
    subscription: 3.9,
    openDate: "30 Oct",
    closeDate: "03 Nov",
    status: "Upcoming",
    thesis:
      "Volume growth is intact but a 31x asking multiple already prices in the next two quarters of margin expansion.",
  },
  {
    id: 6,
    company: "Arka Logistics",
    type: "SME",
    sector: "Logistics",
    priceBand: [94, 99],
    lotSize: 1200,
    issueSize: "₹21.6 Cr",
    gmp: 6,
    gmpPct: 6.1,
    aiScore: 4.2,
    verdict: "AVOID",
    subscription: 1.4,
    openDate: "29 Oct",
    closeDate: "31 Oct",
    status: "Upcoming",
    thesis:
      "Working-capital cycle stretched to 118 days and promoter stake drops to 42% post-issue. Skip this cycle.",
  },
];

export const portfolio: Holding[] = [
  {
    id: 1,
    stock: "Reliance Industries",
    symbol: "RELIANCE",
    sector: "Energy",
    quantity: 40,
    avgPrice: 2410.5,
    ltp: 2688.4,
    aiVerdict: "HOLD",
    confidence: 74,
    reason:
      "Strong Jio and retail cash flows, but the current price already discounts the next two quarters.",
  },
  {
    id: 2,
    stock: "HDFC Bank",
    symbol: "HDFCBANK",
    sector: "Financials",
    quantity: 60,
    avgPrice: 1520,
    ltp: 1712.35,
    aiVerdict: "BUY",
    confidence: 82,
    reason:
      "Deposit growth is outpacing peers and the NIM floor is in sight — risk-reward stays favourable.",
  },
  {
    id: 3,
    stock: "Infosys",
    symbol: "INFY",
    sector: "Information technology",
    quantity: 35,
    avgPrice: 1480.2,
    ltp: 1602.1,
    aiVerdict: "HOLD",
    confidence: 68,
    reason:
      "Deal wins are healthy, yet discretionary IT spend remains soft into FY27.",
  },
  {
    id: 4,
    stock: "Tata Motors",
    symbol: "TATAMOTORS",
    sector: "Automobile",
    quantity: 80,
    avgPrice: 890,
    ltp: 812.6,
    aiVerdict: "SELL",
    confidence: 71,
    reason:
      "JLR margin guidance looks stretched while domestic EV capex keeps free cash flow under pressure.",
  },
  {
    id: 5,
    stock: "Dixon Technologies",
    symbol: "DIXON",
    sector: "Electronics",
    quantity: 8,
    avgPrice: 6210,
    ltp: 9875.5,
    aiVerdict: "HOLD",
    confidence: 63,
    reason:
      "Manufacturing tailwind is structural, but 78x earnings leaves no room for execution slippage.",
  },
  {
    id: 6,
    stock: "Titan Company",
    symbol: "TITAN",
    sector: "Consumer",
    quantity: 25,
    avgPrice: 3180,
    ltp: 3642.8,
    aiVerdict: "BUY",
    confidence: 76,
    reason:
      "Festive demand and steady store additions support a mid-teens earnings compounding runway.",
  },
];

/** Tracked equities for the searchable market catalog. */
export const stocks: Stock[] = [
  {
    id: 1,
    symbol: "HDFCBANK",
    name: "HDFC Bank",
    sector: "Financials",
    marketCap: "₹13.1 L Cr",
    price: 1712.35,
    changePct: 1.12,
    aiScore: 8.6,
    verdict: "BUY",
    spark: [1520, 1548, 1536, 1592, 1610, 1602, 1654, 1668, 1690, 1712],
  },
  {
    id: 2,
    symbol: "ICICIBANK",
    name: "ICICI Bank",
    sector: "Financials",
    marketCap: "₹9.5 L Cr",
    price: 1348.55,
    changePct: 1.35,
    aiScore: 8.4,
    verdict: "BUY",
    spark: [1198, 1214, 1236, 1228, 1264, 1282, 1276, 1305, 1322, 1348],
  },
  {
    id: 3,
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    marketCap: "₹18.2 L Cr",
    price: 2688.4,
    changePct: 0.84,
    aiScore: 8.1,
    verdict: "HOLD",
    spark: [2410, 2456, 2482, 2468, 2524, 2556, 2590, 2634, 2658, 2688],
  },
  {
    id: 4,
    symbol: "BHARTIARTL",
    name: "Bharti Airtel",
    sector: "Telecom",
    marketCap: "₹9.8 L Cr",
    price: 1876.2,
    changePct: 0.48,
    aiScore: 8.0,
    verdict: "BUY",
    spark: [1660, 1698, 1712, 1704, 1756, 1788, 1812, 1834, 1852, 1876],
  },
  {
    id: 5,
    symbol: "HAL",
    name: "Hindustan Aeronautics",
    sector: "Defence",
    marketCap: "₹3.3 L Cr",
    price: 4870.9,
    changePct: 1.62,
    aiScore: 8.3,
    verdict: "BUY",
    spark: [4080, 4212, 4190, 4380, 4444, 4520, 4648, 4702, 4790, 4870],
  },
  {
    id: 6,
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical",
    sector: "Pharma",
    marketCap: "₹4.4 L Cr",
    price: 1824.05,
    changePct: 1.08,
    aiScore: 7.7,
    verdict: "BUY",
    spark: [1580, 1612, 1638, 1624, 1682, 1704, 1742, 1768, 1796, 1824],
  },
  {
    id: 7,
    symbol: "TITAN",
    name: "Titan Company",
    sector: "Consumer",
    marketCap: "₹3.7 L Cr",
    price: 3642.8,
    changePct: 0.62,
    aiScore: 7.6,
    verdict: "BUY",
    spark: [3180, 3244, 3226, 3312, 3388, 3364, 3450, 3520, 3588, 3642],
  },
  {
    id: 8,
    symbol: "INFY",
    name: "Infosys",
    sector: "Information technology",
    marketCap: "₹6.7 L Cr",
    price: 1602.1,
    changePct: -0.34,
    aiScore: 7.4,
    verdict: "HOLD",
    spark: [1480, 1512, 1538, 1526, 1564, 1580, 1596, 1572, 1608, 1602],
  },
  {
    id: 9,
    symbol: "LT",
    name: "Larsen & Toubro",
    sector: "Capital goods",
    marketCap: "₹5.3 L Cr",
    price: 3842.1,
    changePct: -0.22,
    aiScore: 7.3,
    verdict: "HOLD",
    spark: [3520, 3584, 3620, 3602, 3668, 3712, 3744, 3790, 3852, 3842],
  },
  {
    id: 10,
    symbol: "DIXON",
    name: "Dixon Technologies",
    sector: "Electronics",
    marketCap: "₹59.4 K Cr",
    price: 9875.5,
    changePct: 1.94,
    aiScore: 7.2,
    verdict: "HOLD",
    spark: [6210, 6820, 7140, 7480, 8020, 8460, 8920, 9240, 9580, 9875],
  },
  {
    id: 11,
    symbol: "TCS",
    name: "Tata Consultancy Services",
    sector: "Information technology",
    marketCap: "₹12.3 L Cr",
    price: 3864.2,
    changePct: -0.58,
    aiScore: 7.2,
    verdict: "HOLD",
    spark: [3720, 3784, 3812, 3790, 3856, 3888, 3912, 3874, 3896, 3864],
  },
  {
    id: 12,
    symbol: "TATASTEEL",
    name: "Tata Steel",
    sector: "Metals",
    marketCap: "₹2.1 L Cr",
    price: 168.42,
    changePct: 2.36,
    aiScore: 7.1,
    verdict: "BUY",
    spark: [138, 142, 141, 148, 152, 151, 157, 161, 164, 168],
  },
  {
    id: 13,
    symbol: "MARUTI",
    name: "Maruti Suzuki",
    sector: "Automobile",
    marketCap: "₹4.0 L Cr",
    price: 12840.6,
    changePct: -0.64,
    aiScore: 6.8,
    verdict: "HOLD",
    spark: [11820, 11980, 12140, 12060, 12280, 12420, 12580, 12640, 12910, 12840],
  },
  {
    id: 14,
    symbol: "ASIANPAINT",
    name: "Asian Paints",
    sector: "Consumer",
    marketCap: "₹2.3 L Cr",
    price: 2416.3,
    changePct: -1.12,
    aiScore: 5.2,
    verdict: "SELL",
    spark: [2860, 2790, 2824, 2740, 2668, 2702, 2610, 2548, 2470, 2416],
  },
  {
    id: 15,
    symbol: "TATAMOTORS",
    name: "Tata Motors",
    sector: "Automobile",
    marketCap: "₹2.9 L Cr",
    price: 812.6,
    changePct: -2.18,
    aiScore: 4.8,
    verdict: "SELL",
    spark: [890, 912, 904, 878, 892, 864, 846, 838, 826, 812],
  },
];

export const sips: SipFund[] = [
  {
    id: 1,
    fund: "Nifty 50 Index",
    category: "Index · Large cap",
    cagr: "14.2%",
    cagrValue: 14.2,
    threeYear: "16.8%",
    risk: "Moderate",
    minSip: 500,
    aum: "₹18,420 Cr",
    aiVerdict: "START",
    reason:
      "Lowest-cost beta with a 10-year CAGR that beat 68% of active large-cap funds.",
    spark: [100, 104, 103, 109, 108, 114, 118, 117, 124, 129],
  },
  {
    id: 2,
    fund: "Parag Parikh Flexi Cap",
    category: "Flexi cap",
    cagr: "18.6%",
    cagrValue: 18.6,
    threeYear: "21.4%",
    risk: "Moderate",
    minSip: 1000,
    aum: "₹92,680 Cr",
    aiVerdict: "START",
    reason:
      "Controlled drawdowns and global diversification suit a seven-year-plus horizon.",
    spark: [100, 102, 106, 105, 112, 116, 121, 119, 127, 134],
  },
  {
    id: 3,
    fund: "HDFC Mid-Cap Opportunities",
    category: "Mid cap",
    cagr: "22.4%",
    cagrValue: 22.4,
    threeYear: "27.1%",
    risk: "High",
    minSip: 500,
    aum: "₹78,240 Cr",
    aiVerdict: "WAIT",
    reason:
      "Best-in-class compounding, but mid-cap valuations at 34x call for a staggered entry.",
    spark: [100, 108, 112, 110, 120, 126, 124, 133, 138, 141],
  },
  {
    id: 4,
    fund: "ICICI Pru Short Term",
    category: "Short duration debt",
    cagr: "7.8%",
    cagrValue: 7.8,
    threeYear: "8.2%",
    risk: "Low",
    minSip: 500,
    aum: "₹14,120 Cr",
    aiVerdict: "START",
    reason:
      "Ballast for equity-heavy portfolios; duration positioning benefits if rates soften.",
    spark: [100, 100.6, 101.2, 101.6, 102.4, 103, 103.6, 104.4, 105, 105.8],
  },
];

export const marketMood: MarketMood = {
  sentiment: "Bullish",
  score: 72,
  confidence: 86,
  updated: "12 minutes ago",    headline:
      "Momentum favours large-cap financials and capital goods as foreign institutional flows turn positive.",
  drivers: [
    { label: "FII net flows", value: "+₹2,410 Cr", direction: "up" },
    { label: "India VIX", value: "12.4 · −4.1%", direction: "down" },
    { label: "Advance / decline", value: "1,842 : 762", direction: "up" },
    { label: "Nifty RSI (14D)", value: "61.2", direction: "up" },
  ],
};

export const deskNotes: DeskNote[] = [
  {
    id: 1,
    title: "Rotate, don't chase",
    body: "Three of six holdings score above 75 on conviction; financials offer the strongest risk-reward.",
    tag: "Portfolio",
  },
  {
    id: 2,
    title: "NexaGrid leads the cycle",
    body: "A 22x subscription with long-only anchors should support a firm listing unless the index corrects more than 2%.",
    tag: "IPO",
  },
  {
    id: 3,
    title: "Stagger mid-cap SIPs",
    body: "Mid-cap valuations sit at 34x earnings; split fresh inflows across six months rather than committing at once.",
    tag: "SIP",
  },
];

export const notifications = [
  {
    id: 1,
    title: "NexaGrid Energy closes in 3 days",
    body: "AI score raised to 9.1 after anchor book disclosure.",
    time: "8 minutes ago",
    tone: "gold" as const,
  },
  {
    id: 2,
    title: "Tata Motors moved to SELL",
    body: "JLR margin guidance flagged as stretched by the AI review.",
    time: "42 minutes ago",
    tone: "negative" as const,
  },
  {
    id: 3,
    title: "Mid-cap SIPs flagged WAIT",
    body: "Valuation guardrail triggered on HDFC Mid-Cap Opportunities.",
    time: "2 hours ago",
    tone: "ai" as const,
  },
  {
    id: 4,
    title: "Scraper run completed",
    body: "6 IPO records and 3 GMP revisions pulled from the exchange.",
    time: "3 hours ago",
    tone: "signal" as const,
  },
];

export const demoCredentials = [
  {
    label: "Administrator",
    email: "arun@stockpilot.io",
    password: "admin123",
    role: "admin" as UserRole,
  },
  {
    label: "Analyst",
    email: "priya@stockpilot.io",
    password: "user123",
    role: "user" as UserRole,
  },
];

/** Demo-only password map. Real auth moves to Supabase in Phase 2. */
export const demoPasswords: Record<string, string> = {
  "arun@stockpilot.io": "admin123",
  "priya@stockpilot.io": "user123",
  "rohan@stockpilot.io": "user123",
  "meera@stockpilot.io": "user123",
  "vikram@stockpilot.io": "user123",
};
