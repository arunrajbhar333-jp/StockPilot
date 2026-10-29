/**
 * Static reference content.
 *
 * Authentication, IPOs, portfolios, SIPs and index snapshots now come from
 * Supabase. The signed-out spotlight index values, sentiment, the catalogue and
 * desk alerts remain local reference data until the sentiment job is connected.
 */
import type {
  DeskNote,
  MarketIndex,
  MarketMood,
  ModuleKey,
  Stock,
} from "@/types/domain";

export const modules: {
  key: ModuleKey;
  label: string;
  description: string;
}[] = [
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

export const marketMood: MarketMood = {
  sentiment: "Bullish",
  score: 72,
  confidence: 86,
  updated: "12 minutes ago",
  headline:
    "Momentum is broadening as foreign flows turn positive, though volatility stays low and positioning remains selective.",
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
    body: "Stagger fresh capital across a few tranches instead of committing at one price; conviction, not momentum, should size the position.",
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
    title: "Holding moved to SELL",
    body: "The AI review flagged stretched margins and a weakening trend in one open position.",
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

/** Shown on the public sign-in screen before an authenticated IPO query is possible. */
export const loginSpotlight = {
  company: "NexaGrid Energy",
  aiScore: 9.1,
};
