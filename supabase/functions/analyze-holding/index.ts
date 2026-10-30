// Supabase Edge Function: analyze-holding
//
// Generates a STRONG BUY / BUY / HOLD / SELL / STRONG SELL call for one
// portfolio position with the Gemini API and stores the result on the row.
//
// Two callers are supported:
//   1. A signed-in member, who may only analyse their own holding. Missing key
//      or a Gemini failure stores a clearly-labelled placeholder verdict.
//   2. The market-sync scraper, which sends the service role key instead of a
//      user token so it can refresh any holding. In that mode no placeholder is
//      written: a missing key or failed call returns an error and the previous
//      verdict is kept.
//
// Deploy:
//   supabase functions deploy analyze-holding
//
// Secret (Project Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY = your Google AI Studio key
// Optional:
//   GEMINI_MODEL = gemini-2.5-flash   (default)
//
// Without GEMINI_API_KEY the function returns a deterministic placeholder call
// so the portfolio flow keeps working end to end.

import { createClient } from "npm:@supabase/supabase-js@2";

const VERDICTS = [
  "STRONG BUY",
  "BUY",
  "HOLD",
  "SELL",
  "STRONG SELL",
] as const;

type Verdict = (typeof VERDICTS)[number];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isVerdict(value: unknown): value is Verdict {
  return (
    typeof value === "string" && (VERDICTS as readonly string[]).includes(value)
  );
}

/** Length-constant comparison for the service role key. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

interface HoldingRow {
  id: string;
  user_id: string;
  stock_name: string;
  symbol: string | null;
  sector: string | null;
  quantity: number | string | null;
  buy_price: number | string | null;
  current_price: number | string | null;
  purchase_date: string | null;
}

function number(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hash(text: string): number {
  let value = 0;
  for (const character of text.toUpperCase()) {
    value = (value * 31 + character.charCodeAt(0)) % 997;
  }
  return value;
}

const PLACEHOLDER_REASONS: Record<Verdict, string> = {
  "STRONG BUY":
    "Price is holding above its 50-day average with rising delivery volumes and the sector is outperforming. Add on dips while the trend stays intact.",
  BUY: "Earnings growth is running ahead of the sector average and the valuation is still reasonable. Accumulate gradually rather than in one lot.",
  HOLD: "Fundamentals are stable but momentum has flattened, so there is no edge in adding here. Stay invested and revisit after the next quarterly print.",
  SELL: "Revenue growth has slowed for two quarters and the stock is underperforming its sector. Trim the position and redeploy into higher-conviction ideas.",
  "STRONG SELL":
    "Market sentiment is weak and the stock broke its 200-day support on heavy volume. Exit to avoid further losses.",
};

interface Analysis {
  verdict: Verdict;
  reasoning: string;
  confidence: number;
  source: "gemini" | "mock";
  /** Plain instruction behind the verdict. */
  action: Action;
  /** True when the call says act today — drives the red banner. */
  isUrgent: boolean;
  /** Review horizon for a HOLD / BUY, e.g. "3-6 Months". */
  timeline: string;
  /** The six pillars, in order. Empty for placeholder calls. */
  breakdown: Pillar[];
}

function actionFor(verdict: Verdict): Action {
  if (verdict === "STRONG BUY" || verdict === "BUY") return "BUY";
  if (verdict === "SELL" || verdict === "STRONG SELL") return "SELL";
  return "HOLD";
}

function timelineFor(action: Action): string {
  if (action === "HOLD") return "3-6 Months";
  if (action === "BUY") return "6-12 Months";
  return "";
}

type Action = "BUY" | "HOLD" | "SELL";

/** One row of the six-pillar breakdown, stored as JSON on the holding. */
interface Pillar {
  label: string;
  value: string;
}

function isAction(value: unknown): value is Action {
  return value === "BUY" || value === "HOLD" || value === "SELL";
}

function parseBreakdown(value: unknown): Pillar[] {
  if (!Array.isArray(value)) return [];

  const pillars: Pillar[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const label = (entry as { label?: unknown }).label;
    const text = (entry as { value?: unknown }).value;
    if (typeof label !== "string" || typeof text !== "string") continue;
    const cleanLabel = label.trim().slice(0, 60);
    const cleanValue = text.trim().replace(/\s+/g, " ").slice(0, 260);
    if (!cleanLabel || !cleanValue) continue;
    pillars.push({ label: cleanLabel, value: cleanValue });
    if (pillars.length === 8) break;
  }
  return pillars;
}

/** A market_catalog row: a watchlist candidate with no position behind it. */
interface CatalogRow {
  id: string;
  symbol: string;
  stock_name: string;
  sector: string | null;
  current_price: number | string | null;
}

// ---------------------------------------------------------------------------
// Live context: crude, global indices and best-effort fundamentals
// ---------------------------------------------------------------------------

interface Quote {
  price: number;
  changePct: number;
}

interface MarketContext {
  /** WTI crude, USD/bbl — the input that decides import-heavy margins. */
  crude: Quote | null;
  sp500: Quote | null;
  nifty: Quote | null;
  usdinr: Quote | null;
}

interface Fundamentals {
  sector: string | null;
  industry: string | null;
  debtToEquity: string | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  marketCap: string | null;
  summary: string | null;
}

const QUOTE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

/** One Yahoo chart quote. Every call is best-effort: a blocked market feed
 *  must never take the whole analysis down. */
async function fetchQuote(symbol: string): Promise<Quote | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
      { headers: QUOTE_HEADERS, signal: controller.signal },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
        }>;
      };
    };
    const meta = payload.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    const previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (!Number.isFinite(price) || price <= 0) return null;

    const changePct =
      Number.isFinite(previous) && previous > 0
        ? ((price - previous) / previous) * 100
        : 0;

    return { price, changePct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMarketContext(): Promise<MarketContext> {
  const [crude, sp500, nifty, usdinr] = await Promise.all([
    fetchQuote("CL=F"),
    fetchQuote("^GSPC"),
    fetchQuote("^NSEI"),
    fetchQuote("USDINR=X"),
  ]);
  return { crude, sp500, nifty, usdinr };
}

function statValue(value: unknown): number | null {
  if (value && typeof value === "object" && "raw" in value) {
    const raw = Number((value as { raw: unknown }).raw);
    return Number.isFinite(raw) ? raw : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: unknown): string | null {
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw: unknown }).raw;
    if (raw !== null && raw !== undefined && String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Company fundamentals for the prompt. Yahoo's quoteSummary needs no key but
 *  does refuse some datacenter IPs, so every path returns null instead of
 *  throwing — the analyst simply writes "Data unavailable" in that pillar. */
async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  const modules = "defaultKeyStatistics,financialData,assetProfile";

  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
        { headers: QUOTE_HEADERS },
      );
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        quoteSummary?: {
          result?: Array<{
            assetProfile?: {
              sector?: string;
              industry?: string;
              longBusinessSummary?: string;
            };
            defaultKeyStatistics?: {
              marketCap?: unknown;
              profitMargins?: unknown;
            };
            financialData?: {
              debtToEquity?: unknown;
              operatingMargins?: unknown;
              returnOnEquity?: unknown;
              revenueGrowth?: unknown;
              marketCap?: unknown;
            };
          }>;
          error?: unknown;
        };
      };

      const result = payload.quoteSummary?.result?.[0];
      if (!result || payload.quoteSummary?.error) continue;

      const profile = result.assetProfile ?? {};
      const stats = result.defaultKeyStatistics ?? {};
      const financial = result.financialData ?? {};
      const debt = statValue(financial.debtToEquity);
      const margins = statValue(stats.profitMargins);
      const operating = statValue(financial.operatingMargins);
      const roe = statValue(financial.returnOnEquity);
      const growth = statValue(financial.revenueGrowth);
      const marketCap =
        textValue(financial.marketCap) ?? textValue(stats.marketCap);

      return {
        sector: profile.sector ?? null,
        industry: profile.industry ?? null,
        // Yahoo quotes this as a percentage of equity (45.2 ≈ 0.45x).
        debtToEquity:
          debt === null ? null : `${(debt / 100).toFixed(2)}x (${debt.toFixed(1)}% reported)`,
        profitMargins: margins === null ? null : margins * 100,
        operatingMargins: operating === null ? null : operating * 100,
        returnOnEquity: roe === null ? null : roe * 100,
        revenueGrowth: growth === null ? null : growth * 100,
        marketCap,
        summary: profile.longBusinessSummary
          ? profile.longBusinessSummary.slice(0, 700)
          : null,
      };
    } catch {
      // Try the mirror host, then give up quietly.
    }
  }

  return null;
}

function contextLines(context: MarketContext): string[] {
  const lines: string[] = ["", "Live market context (latest quote available):"];

  if (context.crude) {
    lines.push(
      `- Crude oil (WTI): USD ${context.crude.price.toFixed(2)}/bbl, ${context.crude.changePct >= 0 ? "+" : ""}${context.crude.changePct.toFixed(2)}% on the day`,
    );
  }
  if (context.sp500) {
    lines.push(
      `- S&P 500: ${context.sp500.price.toFixed(0)}, ${context.sp500.changePct >= 0 ? "+" : ""}${context.sp500.changePct.toFixed(2)}%`,
    );
  }
  if (context.nifty) {
    lines.push(
      `- Nifty 50: ${context.nifty.price.toFixed(0)}, ${context.nifty.changePct >= 0 ? "+" : ""}${context.nifty.changePct.toFixed(2)}%`,
    );
  }
  if (context.usdinr) {
    lines.push(`- USD/INR: ${context.usdinr.price.toFixed(2)}`);
  }
  if (lines.length === 1) {
    lines.push("- No live quotes could be fetched; reason from the stored data only.");
  }

  return lines;
}

function fundamentalsLines(fundamentals: Fundamentals | null): string[] {
  if (!fundamentals) {
    return [
      "",
      "Company fundamentals: unavailable for this fetch — say \"Data unavailable\" in that pillar instead of guessing.",
    ];
  }

  const lines = ["", "Company fundamentals (as reported by the market data feed):"];
  if (fundamentals.sector || fundamentals.industry) {
    lines.push(`- Sector: ${fundamentals.sector ?? "—"} / ${fundamentals.industry ?? "—"}`);
  }
  if (fundamentals.debtToEquity) lines.push(`- Debt-to-equity: ${fundamentals.debtToEquity}`);
  if (fundamentals.profitMargins !== null) {
    lines.push(`- Net profit margin: ${fundamentals.profitMargins.toFixed(1)}%`);
  }
  if (fundamentals.operatingMargins !== null) {
    lines.push(`- Operating margin: ${fundamentals.operatingMargins.toFixed(1)}%`);
  }
  if (fundamentals.returnOnEquity !== null) {
    lines.push(`- Return on equity: ${fundamentals.returnOnEquity.toFixed(1)}%`);
  }
  if (fundamentals.revenueGrowth !== null) {
    lines.push(`- Revenue growth (YoY): ${fundamentals.revenueGrowth.toFixed(1)}%`);
  }
  if (fundamentals.marketCap) lines.push(`- Market cap: INR ${fundamentals.marketCap}`);
  if (fundamentals.summary) {
    lines.push(`- Business: ${fundamentals.summary}`);
  }
  lines.push(
    "- Company age: not in this feed — state it only if the business summary makes it clear, otherwise write \"Data unavailable\".",
  );
  return lines;
}

/** The six-pillar brief, identical for holdings and watchlist stocks. */
function analysisBrief(): string[] {
  return [
    "",
    "Analyse it across exactly these six pillars, in this order:",
    "1. Company Fundamentals — company age, debt-to-equity, profit margins, competitive position.",
    "2. India Macro-Economy — Indian GDP growth, inflation, infrastructure spending and recent government policy, and how each lands on this company.",
    "3. Crude Oil & Commodities — how crude oil and other relevant commodities are moving this company's costs and margins.",
    "4. Global Sentiment (US/China) — how the US and Chinese economies and their stock markets are affecting this sector.",
    "5. Recent News — company-specific or India-specific news that changes the picture.",
    "6. Final Verdict — one clear call: STRONG BUY, BUY, HOLD, SELL or STRONG SELL.",
    "",
    "Write reasoning and every breakdown value in clear, simple Hinglish (Roman script), the way a knowledgeable friend would explain it — keep tickers, ratios and percentages in English. Be specific about numbers and direction, never hedge, and if a data point is missing write \"Data unavailable\" rather than inventing it.",
    "",
    "Return the JSON exactly as specified: verdict, confidence (0-100), action (BUY, HOLD or SELL — must match the verdict), is_urgent (true only when the member should act today, i.e. a SELL), timeline (for HOLD give a horizon such as \"3-6 Months\", for BUY \"6-12 Months\", for SELL leave it empty), a one or two sentence Hinglish reasoning, and breakdown — an array of exactly six {label, value} objects in the pillar order above, with short labels: \"Company Fundamentals\", \"India Macro\", \"Crude Oil\", \"Global (US/China)\", \"Recent News\", \"Final Verdict\".",
  ];
}

function buildCatalogPrompt(
  stock: CatalogRow,
  context: MarketContext,
  fundamentals: Fundamentals | null,
): string {
  const price = number(stock.current_price);

  return [
    `Stock: ${stock.stock_name} (${stock.symbol})`,
    `Sector: ${stock.sector ?? "not set"}`,
    price > 0
      ? `Last traded price: INR ${price.toFixed(2)}`
      : "Live market price: unavailable.",
    "Position: none — this is a watchlist candidate, not a holding, so there is no P&L to weigh.",
    ...contextLines(context),
    ...fundamentalsLines(fundamentals),
    "",
    "Grade it for an Indian retail investor deciding whether to buy today. Use STRONG BUY or STRONG SELL only when the evidence is decisive; otherwise use BUY, HOLD or SELL.",
    ...analysisBrief(),
  ].join("\n");
}

function placeholderAnalysis(symbol: string, note: string): Analysis {
  const verdict = VERDICTS[hash(symbol) % VERDICTS.length];
  const action = actionFor(verdict);
  return {
    verdict,
    reasoning: `${note} ${PLACEHOLDER_REASONS[verdict]}`,
    confidence: 60,
    source: "mock",
    action,
    // A stand-in call must never claim urgency, and it carries no pillars:
    // the UI hides the breakdown when the array is empty.
    isUrgent: false,
    timeline: action === "SELL" ? "" : timelineFor(action),
    breakdown: [],
  };
}

function buildPrompt(
  holding: HoldingRow,
  context: MarketContext,
  fundamentals: Fundamentals | null,
): string {
  const quantity = number(holding.quantity);
  const buyPrice = number(holding.buy_price);
  const currentPrice = number(holding.current_price);
  const invested = buyPrice * quantity;
  const pnlPct =
    invested > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;

  // The row is marked at cost until a market feed updates current_price. Sending
  // "0.00% P&L" would look like a flat, fully informed position, so say so.
  const hasLivePrice =
    currentPrice > 0 && Math.abs(currentPrice - buyPrice) > 0.005;

  const heldDays = holding.purchase_date
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(holding.purchase_date).getTime()) / 86_400_000,
        ),
      )
    : null;

  return [
    `Stock: ${holding.stock_name} (${holding.symbol ?? "symbol not set"})`,
    `Sector: ${holding.sector ?? "not set"}`,
    `Quantity: ${quantity}`,
    `Average buy price: INR ${buyPrice.toFixed(2)}`,
    ...(hasLivePrice
      ? [
          `Last traded price: INR ${currentPrice.toFixed(2)}`,
          `Unrealised P&L: ${pnlPct.toFixed(2)}%`,
        ]
      : [
          "Live market price: unavailable. The stored price still equals the purchase price, so no meaningful P&L exists.",
          "Do not compute, estimate or mention a P&L, and never claim a support or resistance break.",
          "Open the reasoning by stating that live price data is unavailable, then judge the position on business quality, sector backdrop and valuation. If that evidence is not enough for a firm call, return HOLD.",
        ]),
    heldDays === null ? "Holding period: unknown" : `Holding period: ${heldDays} days`,
    ...contextLines(context),
    ...fundamentalsLines(fundamentals),
    "",
    "Grade this position for an Indian retail investor. Use STRONG BUY or STRONG SELL only when the evidence is decisive; otherwise use BUY, HOLD or SELL.",
    ...analysisBrief(),
  ].join("\n");
}

function parseGeminiJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function analyzeWithGemini(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<Analysis> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are a Chief Economist and Fund Manager advising a retail investor in India. You weigh company fundamentals against India's macro economy, crude oil, global markets and the latest news before committing to one call. You are decisive, you cite numbers, you never hedge, and you answer in clear Hinglish (Roman script) while keeping tickers, ratios and percentages in English. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              verdict: { type: "STRING", enum: [...VERDICTS] },
              confidence: { type: "INTEGER" },
              action: { type: "STRING", enum: ["BUY", "HOLD", "SELL"] },
              is_urgent: { type: "BOOLEAN" },
              timeline: { type: "STRING" },
              reasoning: { type: "STRING" },
              breakdown: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    value: { type: "STRING" },
                  },
                  required: ["label", "value"],
                  propertyOrdering: ["label", "value"],
                },
              },
            },
            required: [
              "verdict",
              "confidence",
              "action",
              "is_urgent",
              "timeline",
              "reasoning",
              "breakdown",
            ],
            propertyOrdering: [
              "verdict",
              "confidence",
              "action",
              "is_urgent",
              "timeline",
              "reasoning",
              "breakdown",
            ],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    // 400 = bad request/schema, 403 = key rejected, 429 = quota, 404 = model.
    console.error(
      `[analyze-holding] Gemini HTTP ${response.status} for model "${model}": ${detail.slice(0, 500)}`,
    );
    throw new Error(`Gemini returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");

  if (!text) {
    console.error(
      `[analyze-holding] Gemini returned no text for model "${model}": ${JSON.stringify(payload).slice(0, 500)}`,
    );
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = parseGeminiJson(text);
  if (!parsed || !isVerdict(parsed.verdict)) {
    console.error(
      `[analyze-holding] unusable Gemini output for model "${model}": ${text.slice(0, 500)}`,
    );
    throw new Error("Gemini did not return a usable verdict.");
  }

  const verdict = parsed.verdict as Verdict;
  const reasoning =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning.trim().replace(/\s+/g, " ").slice(0, 320)
      : "";
  const confidenceValue =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : Number(parsed.confidence);

  // The model can disagree with itself (verdict HOLD, action SELL). The verdict
  // is the canonical rating, so a mismatched action falls back to it, and a SELL
  // is always urgent — the member is being told to exit.
  const action = isAction(parsed.action) ? parsed.action : actionFor(verdict);
  const timelineRaw =
    typeof parsed.timeline === "string"
      ? parsed.timeline.trim().replace(/\s+/g, " ").slice(0, 40)
      : "";
  const isUrgent =
    (typeof parsed.is_urgent === "boolean" && parsed.is_urgent) ||
    action === "SELL";

  return {
    verdict,
    reasoning:
      reasoning || PLACEHOLDER_REASONS[verdict],
    confidence: Number.isFinite(confidenceValue)
      ? Math.min(100, Math.max(0, Math.round(confidenceValue)))
      : 60,
    source: "gemini",
    action,
    isUrgent,
    timeline: timelineRaw || timelineFor(action),
    breakdown: parseBreakdown(parsed.breakdown),
  };
}

/** Columns written for either table; both carry the same analysis shape. */
function analysisColumns(analysis: Analysis, analyzedAt: string) {
  return {
    ai_verdict: analysis.verdict,
    ai_reasoning: analysis.reasoning,
    ai_source: analysis.source === "gemini" ? "gemini" : "placeholder",
    confidence: analysis.confidence,
    ai_action: analysis.action,
    ai_urgent: analysis.isUrgent,
    ai_timeline: analysis.timeline || null,
    ai_breakdown: analysis.breakdown,
    last_analyzed_at: analyzedAt,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "The Edge Function is missing its Supabase secrets." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Missing bearer token." }, 401);
  }
  const accessToken = authorization.slice("Bearer ".length);
  const systemCaller = safeEqual(accessToken, serviceRoleKey);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let callerId: string | null = null;

  if (!systemCaller) {
    const {
      data: { user: caller },
      error: callerError,
    } = await admin.auth.getUser(accessToken);

    if (callerError || !caller) {
      return json({ error: "Your session is invalid. Sign in again." }, 401);
    }
    callerId = caller.id;

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("status")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfileError) {
      return json({ error: "Could not verify your profile." }, 500);
    }
    if (callerProfile?.status === "suspended") {
      return json({ error: "This account is suspended." }, 403);
    }
  }

  let body: { holdingId?: unknown; stockId?: unknown };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const holdingId =
    typeof body.holdingId === "string" ? body.holdingId.trim() : "";
  const stockId = typeof body.stockId === "string" ? body.stockId.trim() : "";

  if (holdingId && stockId) {
    return json({ error: "Send holdingId or stockId, not both." }, 400);
  }
  if (!holdingId && !stockId) {
    return json({ error: "A holding ID or stock ID is required." }, 400);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  // Crude, US/India indices and USD/INR go into every prompt. Best-effort: a
  // dead quote feed returns nulls and the pillars simply report it.
  const context = await fetchMarketContext();

  // ---- market_catalog branch ------------------------------------------------
  // The scraper scores watchlist stocks here so a new STRONG BUY can reach the
  // Telegram stream. Same Gemini call, no position behind the verdict.
  if (stockId) {
    if (!systemCaller) {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", callerId ?? "")
        .maybeSingle();
      if (callerProfile?.role !== "admin") {
        return json({ error: "Only administrators can analyse the catalogue." }, 403);
      }
    }

    const { data: stock, error: stockError } = await admin
      .from("market_catalog")
      .select("id, symbol, stock_name, sector, current_price")
      .eq("id", stockId)
      .maybeSingle();

    if (stockError) {
      return json({ error: stockError.message }, 500);
    }
    if (!stock) {
      return json({ error: "That catalogue stock no longer exists." }, 404);
    }

    const catalogRow = stock as CatalogRow;
    const catalogFundamentals = await fetchFundamentals(catalogRow.symbol);
    let catalogAnalysis: Analysis;

    if (!apiKey) {
      if (systemCaller) {
        return json({
          skipped: true,
          reason: "GEMINI_API_KEY is not set; the previous verdict was kept.",
        });
      }
      catalogAnalysis = placeholderAnalysis(
        catalogRow.symbol,
        "PLACEHOLDER — not a Gemini call: GEMINI_API_KEY is not set.",
      );
    } else {
      try {
        catalogAnalysis = await analyzeWithGemini(
          buildCatalogPrompt(catalogRow, context, catalogFundamentals),
          apiKey,
          model,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[analyze-holding] Gemini call failed for ${catalogRow.symbol}: ${detail}`,
        );
        if (systemCaller) {
          return json(
            { error: "Gemini analysis failed; the previous verdict was kept." },
            502,
          );
        }
        catalogAnalysis = placeholderAnalysis(
          catalogRow.symbol,
          `PLACEHOLDER — not a Gemini call: ${detail.slice(0, 240)}`,
        );
      }
    }

    const catalogAnalyzedAt = new Date().toISOString();
    const { error: catalogUpdateError } = await admin
      .from("market_catalog")
      .update(analysisColumns(catalogAnalysis, catalogAnalyzedAt))
      .eq("id", catalogRow.id);

    if (catalogUpdateError) {
      return json(
        { error: `The verdict could not be saved: ${catalogUpdateError.message}` },
        500,
      );
    }

    return json({ ...catalogAnalysis, analyzedAt: catalogAnalyzedAt });
  }

  // ---- portfolio branch -----------------------------------------------------
  if (!holdingId) {
    return json({ error: "A holding ID is required." }, 400);
  }

  const { data: holding, error: holdingError } = await admin
    .from("portfolio")
    .select(
      "id, user_id, stock_name, symbol, sector, quantity, buy_price, current_price, purchase_date",
    )
    .eq("id", holdingId)
    .maybeSingle();

  if (holdingError) {
    return json({ error: holdingError.message }, 500);
  }
  if (!holding) {
    return json({ error: "That holding no longer exists." }, 404);
  }
  if (!systemCaller && (holding as HoldingRow).user_id !== callerId) {
    return json({ error: "You can only analyse your own holdings." }, 403);
  }

  const row = holding as HoldingRow;
  const holdingFundamentals = row.symbol
    ? await fetchFundamentals(row.symbol)
    : null;

  let analysis: Analysis;
  if (!apiKey) {
    console.error(
      `[analyze-holding] GEMINI_API_KEY is not set — storing a placeholder verdict for holding ${row.id}.`,
    );
    if (systemCaller) {
      return json({
        skipped: true,
        reason: "GEMINI_API_KEY is not set; the previous verdict was kept.",
      });
    }
    analysis = placeholderAnalysis(
      row.symbol ?? row.stock_name,
      "PLACEHOLDER — not a Gemini call: GEMINI_API_KEY is not set.",
    );
  } else {
    console.log(
      `[analyze-holding] calling Gemini model "${model}" for ${row.symbol ?? row.stock_name} (key present, system caller: ${systemCaller})`,
    );
    try {
      analysis = await analyzeWithGemini(
        buildPrompt(row, context, holdingFundamentals),
        apiKey,
        model,
      );
      console.log(
        `[analyze-holding] Gemini verdict for ${row.symbol ?? row.stock_name}: ${analysis.verdict}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[analyze-holding] Gemini call failed:", detail);
      if (systemCaller) {
        // Never replace a real verdict with a placeholder during a bulk sync.
        return json(
          { error: "Gemini analysis failed; the previous verdict was kept." },
          502,
        );
      }
      // Store the real reason so the UI shows the HTTP status instead of a
      // generic "key missing" message. Full details are in the logs above.
      analysis = placeholderAnalysis(
        row.symbol ?? row.stock_name,
        `PLACEHOLDER — not a Gemini call: ${detail.slice(0, 240)}`,
      );
    }
  }

  const analyzedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("portfolio")
    .update(analysisColumns(analysis, analyzedAt))
    .eq("id", row.id);

  if (updateError) {
    return json({ error: `The verdict could not be saved: ${updateError.message}` }, 500);
  }

  return json({ ...analysis, analyzedAt });
});
