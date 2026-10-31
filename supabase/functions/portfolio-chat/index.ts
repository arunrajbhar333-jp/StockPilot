// Supabase Edge Function: portfolio-chat
//
// The in-app "Ask AI" assistant. It answers one question in clear Hinglish, and
// it is deliberately retrieval-first: the Gemini prompt only receives the data
// that actually answers the question.
//   * A question about one stock gets that stock's row(s) — portfolio first,
//     then market_catalog — and NO macro quotes.
//   * A question about an IPO gets that IPO's row.
//   * A question about the overall market gets the live macro snapshot.
//   * Anything else gets the caller's holdings.
//   * A question about a stock that is in neither portfolio nor catalog gets an
//     empty context plus an explicit "data not available" instruction.
// Live Nifty/crude quotes are fetched only for the overall-market case; feeding
// them into every prompt was what made unrelated answers read like a macro
// script.
//
// Request:
//   {
//     "message": string,                     // 1..2000 chars
//     "history"?: [{ "role": "user" | "assistant", "text": string }],
//     "userId"?: string                      // service-role callers only
//   }
//
// Response:
//   { "reply": string, "holdings": number }
//
// Deploy:
//   supabase functions deploy portfolio-chat
//
// Secret (Project Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY   (without it the function returns a clear error rather
//                     than a made-up answer)
// Optional: GEMINI_MODEL (default gemini-2.5-flash)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Shared with the web app: a throttled Gemini call is reported with this
// sentinel so the widget can show a friendly toast instead of a failure.
const RATE_LIMIT_CODE = "RATE_LIMIT";
const RATE_LIMIT_MESSAGE =
  "AI limit reached. Please wait a minute or try tomorrow.";

/** Gemini answers 429, or 400/403 carrying RESOURCE_EXHAUSTED, when throttled. */
function isRateLimit(status: number, detail: string): boolean {
  return (
    status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota exceeded/i.test(detail)
  );
}

const MAX_MESSAGE_LENGTH = 2000;
// Hard cap on the conversation we send back to Gemini: the last 6 turns only,
// each turn trimmed to 400 characters below. Older context is dropped so the
// prompt can never grow without bound.
const MAX_HISTORY = 6;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function number(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface HoldingRow {
  stock_name: string;
  symbol: string | null;
  quantity: number | string | null;
  buy_price: number | string | null;
  current_price: number | string | null;
  ai_verdict: string | null;
  ai_reasoning: string | null;
  confidence: number | string | null;
  ai_action: string | null;
  ai_urgent: boolean | null;
  ai_timeline: string | null;
  ai_breakdown: unknown;
  last_analyzed_at: string | null;
}

/** The shape the catalog query returns. The supabase-js types can drift, so
 *  the Edge Function normalizes whatever the database sends into this shape
 *  before passing it to Gemini.
 */
interface CatalogRow {
  symbol: string | null;
  stock_name: string | null;
  current_price: number | string | null;
  ai_verdict: string | null;
  ai_reasoning: string | null;
}/** Every column ipoLines() renders, so an IPO answer always carries the full
 *  brief: name, board, window, price band, lot, GMP, subscription, score and
 *  verdict.
 */
const IPO_FULL_COLUMNS =
  "id, company_name, type, sector, price_band_low, price_band_high, lot_size, " +
  "issue_size, gmp, gmp_pct, subscription, open_date, close_date, status, " +
  "ai_score, verdict, thesis";

/** Fallback for a project whose migration predates one of those columns. */
const IPO_MINIMAL_COLUMNS =
  "id, company_name, type, gmp, subscription, ai_score, verdict, status";

interface IpoRow {
  id: string | null;
  company_name: string | null;
  type: string | null;
  sector: string | null;
  price_band_low: number | string | null;
  price_band_high: number | string | null;
  lot_size: number | string | null;
  issue_size: string | null;
  gmp: number | string | null;
  gmp_pct: number | string | null;
  subscription: number | string | null;
  open_date: string | null;
  close_date: string | null;
  status: string | null;
  ai_score: number | string | null;
  verdict: string | null;
  thesis: string | null;
}

interface Turn {
  role?: unknown;
  text?: unknown;
}

interface Quote {
  price: number;
  changePct: number;
}

const QUOTE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

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

async function marketSnapshot(): Promise<string> {
  const [crude, sp500, nifty, usdinr] = await Promise.all([
    fetchQuote("CL=F"),
    fetchQuote("^GSPC"),
    fetchQuote("^NSEI"),
    fetchQuote("USDINR=X"),
  ]);

  const lines: string[] = [];
  if (crude) {
    lines.push(
      `Crude oil (WTI): USD ${crude.price.toFixed(2)}/bbl (${crude.changePct >= 0 ? "+" : ""}${crude.changePct.toFixed(2)}%)`,
    );
  }
  if (sp500) {
    lines.push(
      `S&P 500: ${sp500.price.toFixed(0)} (${sp500.changePct >= 0 ? "+" : ""}${sp500.changePct.toFixed(2)}%)`,
    );
  }
  if (nifty) {
    lines.push(
      `Nifty 50: ${nifty.price.toFixed(0)} (${nifty.changePct >= 0 ? "+" : ""}${nifty.changePct.toFixed(2)}%)`,
    );
  }
  if (usdinr) lines.push(`USD/INR: ${usdinr.price.toFixed(2)}`);

  return lines.length
    ? lines.map((line) => `- ${line}`).join("\n")
    : "- No live quotes available right now; say so rather than guessing.";
}

function pillarLines(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const parts: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const label = (entry as { label?: unknown }).label;
    const text = (entry as { value?: unknown }).value;
    if (typeof label !== "string" || typeof text !== "string") continue;
    parts.push(`${label}: ${text.slice(0, 200)}`);
  }
  return parts.join(" · ");
}

/** One line per holding, with the stored analysis attached. */
function portfolioLines(rows: HoldingRow[]): string[] {
  if (!rows.length) return ["(No holdings recorded yet.)"];

  return rows.map((row) => {
    const quantity = number(row.quantity);
    const buyPrice = number(row.buy_price);
    const price = number(row.current_price);
    const invested = buyPrice * quantity;
    const pnlPct =
      invested > 0 && buyPrice > 0
        ? ((price - buyPrice) / buyPrice) * 100
        : null;
    const urgency = row.ai_urgent ? " | URGENT" : "";
    const timeline = row.ai_timeline ? ` | timeline: ${row.ai_timeline}` : "";
    const action = row.ai_action ? ` | action: ${row.ai_action}` : "";
    const pillars = pillarLines(row.ai_breakdown);

    return [
      `- ${row.stock_name} (${row.symbol ?? "symbol n/a"})`,
      `  qty ${quantity} · avg INR ${buyPrice.toFixed(2)} · ltp INR ${price.toFixed(2)}` +
        (pnlPct === null ? "" : ` · P&L ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`),
      `  verdict: ${row.ai_verdict ?? "not analysed"}${action}${urgency}${timeline} · confidence ${number(row.confidence)}%`,
      row.ai_reasoning ? `  why: ${row.ai_reasoning.slice(0, 240)}` : "",
      pillars ? `  pillars: ${pillars.slice(0, 700)}` : "",
      row.last_analyzed_at
        ? `  analysed at: ${row.last_analyzed_at}`
        : "  analysed at: never",
    ]
      .filter(Boolean)
      .join("\n");
  });
}

/** One line per market-catalog stock so the assistant can answer about names the
 *  user does not hold.
 */
function catalogLines(rows: CatalogRow[]): string[] {
  if (!rows.length) return ["(No market catalog rows returned.)"];

  return rows.map((row) => {
    const price = number(row.current_price);

    return [
      `- ${row.stock_name ?? row.symbol ?? "unknown"} (${row.symbol ?? "symbol n/a"})`,
      `  price INR ${price.toFixed(2)}`,
      `  verdict: ${row.ai_verdict ?? "not analysed"}`,
      row.ai_reasoning ? `  why: ${row.ai_reasoning.slice(0, 240)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
}

/** One line per IPO: the complete underwriting brief, never a summary.
 *  Fields the fallback columns did not return are simply omitted.
 */
function ipoLines(rows: IpoRow[]): string[] {
  if (!rows.length) return ["(No live/upcoming IPOs returned.)"];

  return rows.map((row) => {
    const low = number(row.price_band_low);
    const high = number(row.price_band_high);
    const lotSize = number(row.lot_size);
    const gmp = number(row.gmp);
    const subscription = number(row.subscription);
    const score = number(row.ai_score);
    const name = row.company_name || `ipo-${row.id ?? "unknown"}`;
    const type = row.type || "IPO";

    const band =
      low > 0 && high > 0
        ? `INR ${low.toFixed(2)}-INR ${high.toFixed(2)}/share`
        : "price band not published";
    const lot =
      lotSize > 0
        ? `${lotSize} shares (1 lot = INR ${
            high > 0 ? (lotSize * high).toFixed(0) : "?"
          })`
        : "lot size not published";
    const gmpLine =
      row.gmp_pct !== null && row.gmp_pct !== undefined
        ? `INR ${gmp.toFixed(0)} (${number(row.gmp_pct).toFixed(1)}% over the upper band)`
        : gmp > 0
          ? `INR ${gmp.toFixed(0)}`
          : "not quoted";
    const subscriptionLine =
      subscription > 0
        ? `${subscription.toFixed(2)}x`
        : "not reported yet (book not open or not published)";

    const lines = [
      `- ${name} (${type}${row.sector ? ` · ${row.sector}` : ""})`,
      `  window: ${row.open_date ?? "unknown"} -> ${row.close_date ?? "unknown"} (status: ${row.status ?? "unknown"})`,
      `  price band: ${band} · lot: ${lot}`,
      row.issue_size ? `  issue size: ${row.issue_size}` : "",
      `  gmp: ${gmpLine}`,
      `  subscription: ${subscriptionLine}`,
      `  ai_score: ${score.toFixed(1)}/10 · verdict: ${row.verdict ?? "not analysed"}`,      row.thesis ? `  underwriting note: ${row.thesis.slice(0, 300)}` : "",
    ] ;

    return lines.filter(Boolean).join("\n");
  });
}

/**
 * Reads IPO rows. Tries the full column set first and silently falls back to
 * the minimal one, because a project whose migration predates `lot_size` (say)
 * must still get an answer rather than a 400 from PostgREST. When `needle` is
 * given the rows are matched by name in SQL — that lookup decides the answer's
 * scope, so it is not re-filtered in JS.
 */
async function readIpos(
  admin: ReturnType<typeof createClient>,
  limit: number,
  needle?: string,
): Promise<IpoRow[]> {
  const run = async (columns: string): Promise<IpoRow[]> => {
    const query = admin.from("ipos").select(columns);
    if (needle) query.or(`company_name.ilike.%${needle}%`);

    const { data, error } = await query
      .order("ai_score", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as IpoRow[];
  };

  try {
    return await run(IPO_FULL_COLUMNS);
  } catch (error) {
    console.warn(
      `[portfolio-chat] full IPO select failed (${
        error instanceof Error ? error.message : String(error)
      }); retrying with minimal columns.`,
    );
    return await run(IPO_MINIMAL_COLUMNS);
  }
}

// ---------------------------------------------------------------------------
// Question routing
// ---------------------------------------------------------------------------

/**
 * Filler + instrument-neutral vocabulary. Removed before we try to read a stock
 * name out of the question, so "Should I buy Aarti Industries?" yields the
 * candidate "Aarti Industries" and a macro question yields nothing at all.
 */
const STOP_WORDS = new Set([
  "a", "about", "advice", "an", "analyse", "analysis", "analyze", "and",
  "any", "are", "as", "ask", "at", "bank", "be", "been", "bhai", "bro",
  "budget", "but", "buy", "buying", "can", "chahiye", "could", "cpi",
  "crude", "current", "dii", "do", "does", "dollar", "economy", "fii",
  "for", "from", "give", "global", "hai", "hain", "hold", "holding",
  "how", "i", "if", "in", "index", "indices", "inflation", "invest",
  "investing", "is", "it", "its", "ka", "kaisa", "kaise", "kare", "karein",
  "karna", "karu", "karun", "ke", "ki", "ko", "kuch", "kya", "long",
  "macro", "market", "markets", "me", "mein", "mera", "mere", "mujhe", "my",
  "nifty", "now", "of", "oil", "on", "opinion", "or", "our", "please",
  "portfolio", "price", "rakhna", "rakhun", "repo", "rbi", "sahi", "scrip",
  "sell", "selling", "sensex", "share", "shares", "short", "should", "stock",
  "stocks", "target", "the", "this", "to", "today", "us", "verdict", "view",
  "was", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your",
]);

/** Explicit overall-market questions are the only ones that get macro quotes. */
const MACRO_QUESTION =
  /\b(nifty|sensex|bank\s?nifty|crude|brent|wti|oil|usd|dollar|rupee|inr|inflation|cpi|rbi|repo|fed|global|macro|economy|economic|budget|market|markets|index|indices|fii|dii)\b/i;

/** Signals that the question is about a fresh issue rather than a holding. */
const IPO_INTENT =
  /\b(ipo|initial public offering|sme|mainboard|apply|applied|application|subscription|gmp|grey market|listing gains|lot size|price band)\b/i;

/** Signals that the member is asking for a call on a named instrument. */
const STOCK_INTENT =
  /\b(buy|buying|sell|selling|hold|holding|analyz\w*|analys\w*|target|verdict|invest\w*|entry|exit|kharid\w*|bech\w*|rakh\w*)\b/i;

function key(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value: string): string[] {
  return value
    .replace(/[^A-Za-z0-9&-\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Tags and corporate suffixes that are never part of a company name. Stripped
 *  before matching, so "NexaGrid Energy (SME) IPO" reads as "NexaGrid Energy"
 *  and "Yes Bank Ltd" as "Yes Bank". Pairs with the STOP_WORDS list above,
 *  which already carries "price", "analyze", "should", "buy", "hold", "sell".
 */
const NAME_NOISE = new Set([
  "ipo",
  "sme",
  "mainboard",
  "ltd",
  "limited",
  "plc",
  "pvt",
  "llp",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
  "issue",
  "price",
  "pricing",
  "detail",
  "details",
  "review",
  "apply",
  "application",
  "tag",
]);

/** True for filler and name-noise words: either one ends a candidate name. */
function isNameNoise(word: string): boolean {
  const lowered = word.toLowerCase();
  return STOP_WORDS.has(lowered) || NAME_NOISE.has(lowered);
}

/** Stop words that also sit inside company names — "Yes Bank", "Oil India".
 *  They end a name only when nothing is open yet: "bank nifty" still yields
 *  no candidate, while "... Yes Bank Ltd" keeps its two-word name. */
const NAME_CONTINUATIONS = new Set(["bank", "oil"]);

/** A phrase counts as a company name: at least 4 alphanumeric characters, or a
 *  3-character uppercase ticker like "BSE" / "SBI". Short title-case fragments
 *  ("Yes") left behind by a stop-word split never qualify. */
function isCandidateName(phrase: string): boolean {
  const k = key(phrase);
  if (k.length >= 4) return true;
  return k.length === 3 && phrase === phrase.toUpperCase();
}

/** Company words with tags and suffixes removed: "Yes Bank Ltd" -> "yes bank". */
function nameWords(name: string | null | undefined): string[] {
  return (name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0 && !NAME_NOISE.has(part));
}

/** Consecutive non-filler words, e.g. "Aarti Industries" from a full question. */
function extractMentionedNames(message: string): string[] {
  const groups: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      const phrase = current.join(" ").replace(/\s+/g, " ").trim();
      if (isCandidateName(phrase)) groups.push(phrase);
      current = [];
    }
  };

  // Parenthesised tags carry no name: "(SME)", "(NSE)", "(India)".
  const cleaned = message.replace(/\([^)]*\)/g, " ");

  for (const word of words(cleaned)) {
    // A name can contain a filler word ("Yes Bank Ltd"): keep building it.
    if (current.length > 0 && NAME_CONTINUATIONS.has(word.toLowerCase())) {
      current.push(word);
      if (current.length === 4) flush();
      continue;
    }
    if (isNameNoise(word)) {
      flush();
      continue;
    }
    current.push(word);
    if (current.length === 4) flush();
  }
  flush();

  return groups;
}

/** True when a candidate name reads like a company rather than a stray word. */
function looksLikeStockQuestion(message: string, candidates: string[]): boolean {
  if (STOCK_INTENT.test(message)) return true;

  return candidates.some((candidate) => {
    const parts = candidate.split(" ");
    const allCapitalised = parts.every((part) => /^[A-Z]/.test(part));
    const ticker = parts.length === 1 && /^[A-Z0-9&-]{3,15}$/.test(candidate);
    return ticker || (allCapitalised && parts.some((part) => part.length > 1));
  });
}

/** Does the question name this stock? Matches the symbol or the company name. */
function matchesInstrument(
  message: string,
  symbol: string | null,
  name: string | null,
): boolean {
  const messageKey = key(message);
  if (!messageKey) return false;

  const symbolKey = key(symbol);
  if (symbolKey.length >= 3 && messageKey.includes(symbolKey)) return true;

  const nameKey = key(name);
  if (nameKey.length >= 4 && messageKey.includes(nameKey)) return true;

  // Tags and corporate suffixes stripped, so "Yes Bank Ltd" and
  // "NexaGrid Energy (SME)" match on the bare name.
  const bareKey = nameWords(name).join("");
  if (bareKey.length >= 4 && messageKey.includes(bareKey)) return true;

  // "Aarti Industries" typed as "Aarti Inds" or with a suffix: every meaningful
  // word of the stored name appears somewhere in the question.
  const nameParts = (name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 3);
  if (nameParts.length >= 2 && nameParts.every((part) => messageKey.includes(part))) {
    return true;
  }

  return false;
}

/** Sanitizes a name for use inside a PostgREST `.or()` filter. PostgREST reads
 *  commas, parentheses, dots, quotes and backslashes as filter syntax, so any
 *  name interpolated into that filter is reduced to letters, digits and spaces
 *  first. Removed out of the serve body so the routing harness can reach it
 *  directly for the HGS India / YESBANK regression tests.
 */
function filterValue(raw: string): string {
  return raw.replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim();
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

  let body: { message?: unknown; history?: unknown; userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ error: "Ask a question first." }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json(
      { error: `Questions must stay under ${MAX_MESSAGE_LENGTH} characters.` },
      400,
    );
  }

  const ownerId = systemCaller
    ? typeof body.userId === "string"
      ? body.userId.trim()
      : ""
    : callerId;
  if (!ownerId) {
    return json(
      { error: "A userId is required when calling with the service role key." },
      400,
    );
  }

  const { data: holdings, error: holdingsError } = await admin
    .from("portfolio")
    .select(
      "stock_name, symbol, quantity, buy_price, current_price, ai_verdict, ai_reasoning, confidence, ai_action, ai_urgent, ai_timeline, ai_breakdown, last_analyzed_at",
    )
    .eq("user_id", ownerId)
    .order("created_at", { ascending: true });

  if (holdingsError) {
    return json({ error: `Could not read your portfolio: ${holdingsError.message}` }, 500);
  }

  const rows = (holdings ?? []) as unknown as HoldingRow[];

  // Catalog sample used for name matching; rows the sample misses are fetched
  // individually below when the question names them.
  const { data: catalog, error: catalogError } = await admin
    .from("market_catalog")
    .select("symbol, stock_name, current_price, ai_verdict, ai_reasoning")
    .order("current_price", { ascending: false, nullsFirst: false })
    .limit(100);

  if (catalogError) {
    return json({ error: `Could not read the market catalog: ${catalogError.message}` }, 500);
  }

  const catalogRows = (catalog ?? []) as unknown as CatalogRow[];
  const catalogCount = catalogRows.length;

  // Live/upcoming IPOs: the assistant uses this when the member asks about a
  // fresh issue. readIpos() fetches the full underwriting brief and falls back
  // to the minimal column set if a project's migration predates one of them.
  let ipoRows: IpoRow[] = [];
  try {
    ipoRows = await readIpos(admin, 20);
  } catch (error) {
    return json(
      {
        error: `Could not read the IPOs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      500,
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!apiKey) {
    return json(
      {
        error:
          "GEMINI_API_KEY is not set, so the assistant would only be guessing. Add the key to answer questions.",
      },
      503,
    );
  }
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  const turns = Array.isArray(body.history) ? body.history : [];
  const history = turns
    .slice(-MAX_HISTORY)
    .filter(
      (turn: Turn) =>
        (turn?.role === "user" || turn?.role === "assistant") &&
        typeof turn.text === "string",
    )
    .map((turn: Turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: String(turn.text).slice(0, 400) }],
    }));

  // ---- Retrieval ---------------------------------------------------------
  // Only the data that answers this question reaches the prompt. Macro quotes
  // are fetched last and only for an explicit overall-market question, so a
  // single-stock question can never be answered with index or crude figures.
  const heldMatches = rows.filter((row) =>
    matchesInstrument(message, row.symbol, row.stock_name),
  );
  const catalogMatches = catalogRows.filter(
    (row) =>
      matchesInstrument(message, row.symbol, row.stock_name) &&
      !heldMatches.some(
        (held) =>
          held.symbol && row.symbol && key(held.symbol) === key(row.symbol),
      ),
  );
  let ipoMatches = ipoRows.filter((row) =>
    matchesInstrument(message, null, row.company_name),
  );
  const mentioned = extractMentionedNames(message);

  // The catalog list above is a capped sample. If the question names something
  // it did not include, look that exact name up before calling it missing, so a
  // stock that exists deeper in market_catalog is not reported as untracked.
  let lookedUp: CatalogRow[] = [];
  if (
    heldMatches.length === 0 &&
    catalogMatches.length === 0 &&
    mentioned.length > 0
  ) {
    const needle = filterValue(mentioned[0]);
    if (needle.length >= 3) {
      const { data: found } = await admin
        .from("market_catalog")
        .select("symbol, stock_name, current_price, ai_verdict, ai_reasoning")
        .or(`stock_name.ilike.%${needle}%,symbol.ilike.%${needle}%`)
        .limit(5);

      lookedUp = ((found ?? []) as unknown as CatalogRow[]).filter((row) =>
        matchesInstrument(message, row.symbol, row.stock_name),
      );
    }
  }

  // An IPO question the capped sample missed is looked up by name BEFORE the
  // mode is decided: a portfolio holding with a similar name must never answer
  // a question about a fresh issue. The SQL match is the authority here, so
  // these rows are taken as-is rather than re-filtered in JS.
  const ipoNeedle = filterValue(mentioned[0] ?? "");
  if (
    ipoMatches.length === 0 &&
    IPO_INTENT.test(message) &&
    ipoNeedle.length >= 3
  ) {
    try {
      ipoMatches = await readIpos(admin, 5, ipoNeedle);
    } catch (error) {
      console.warn(
        `[portfolio-chat] IPO name lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  let mode: "ipo" | "instrument" | "macro" | "portfolio" | "unknown";
  let context = "";
  let missing = "";

  // STRICT PRIORITY: an IPO match or an instrument match decides the mode.
  // Portfolio mode is only reached when the question names nothing we track.
  if (ipoMatches.length > 0) {
    mode = "ipo";
    context = ipoMatches.map((row) => ipoLines([row])[0]).join("\n\n");
  } else if (
    heldMatches.length > 0 ||
    catalogMatches.length > 0 ||
    lookedUp.length > 0
  ) {
    mode = "instrument";
    context = [
      ...heldMatches.map((row) => portfolioLines([row])[0]),
      ...catalogMatches.map((row) => catalogLines([row])[0]),
      ...lookedUp.map((row) => catalogLines([row])[0]),
    ].join("\n\n");
  } else if (mentioned.length > 0 && looksLikeStockQuestion(message, mentioned)) {
    // A named instrument that exists nowhere in our data: empty context.
    mode = "unknown";
    missing = mentioned[0].slice(0, 60);
  } else if (IPO_INTENT.test(message)) {
    // An IPO question with no matching row: never fall back to the portfolio
    // or to macro mode — answer with the "not available" instruction instead.
    mode = "unknown";
    missing = ipoNeedle || "that IPO";
  } else if (MACRO_QUESTION.test(message)) {
    mode = "macro";
    context = await marketSnapshot();
  } else {
    mode = "portfolio";
    context = portfolioLines(rows).join("\n\n");
  }

  const instruction =
    mode === "unknown"
      ? [
          `The member asked about "${missing}". It is NOT in their portfolio, NOT in the market catalog and NOT in the IPO list. No data for it exists.`,
          `Start your reply with exactly this sentence, on its own line: "Data for ${missing} is not available in the current market catalog."`,
          `Then add one short sentence saying that ${missing} is not in our tracked universe, so no verdict can be given on it right now. That is the whole reply.`,
          "Do not give a verdict, do not estimate a price, and do not mention Nifty 50, Sensex, crude oil, USD/INR or any other market-wide indicator.",
        ].join("\n")
      : mode === "instrument"
        ? [
            "The member asked about one specific stock. Use only its row(s) in CONTEXT — nothing else may appear in the answer.",
            "Do not substitute any other holding from their portfolio, and do not bring in Nifty 50, Sensex, crude oil, USD/INR, inflation or global cues: they were not asked for and are not in the context.",
            "Answer the exact question asked, then stop.",
          ].join(" ")
        : mode === "ipo"
          ? [
              "The member asked about one IPO. Use only its row in CONTEXT, which carries the company, the board (Mainboard/SME), open and close dates, price band, lot size, GMP, subscription, AI score and verdict.",
              "Answer the exact question asked — and when the member wants a verdict, a rating or a price, give the FULL analysis in 2-4 sentences explaining WHY it is APPLY, WATCH or AVOID: quote the subscription figure and the GMP figure from the CONTEXT and say what they mean for listing gains. Never answer with one line, never omit the reasoning.",
              "No macro commentary and no portfolio stocks.",
            ].join(" ")
          : mode === "macro"
            ? "The member asked about the overall market. Use only the live quotes in CONTEXT, and say a figure is unavailable rather than guessing it."
            : "The member asked about their portfolio. Answer from the holdings in CONTEXT only, and say plainly when the holdings do not cover the question.";

  const prompt = [
    `The member asked: "${message}"`,
    "",
    `Answer mode: ${mode}`,
    instruction,
    "",
    "CONTEXT — the only data you may use. Anything not listed here does not exist for this answer:",
    context.trim() || "(empty — no matching data was found)",
  ].join("\n");

  let reply = "";
  try {
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
                text: [
                  "You are a SEBI-registered fund manager with 20+ years of experience advising an Indian retail investor.",
                  "You have seen multiple market cycles — bull runs, scams, COVID, rate shocks — and your predictions aim for 80-90% accuracy by relying strictly on data, a confluence of macro and micro factors, and risk management.",
                  "You speak strict, professional Hinglish in Roman script and address the member as 'aap'; never use 'tu', 'tum', 'bhai', slang, exclamation marks or over-familiarity.",
                  "STRICT RULES, all mandatory:",
                  "1. Answer ONLY from the CONTEXT in the user message. You have no other knowledge for this answer. If the CONTEXT is empty or does not cover the question, say plainly that the data is not available.",
                  "2. NEVER invent or insert market-wide data: no Nifty 50 or Sensex levels, crude oil or Brent prices, USD/INR, inflation, RBI policy, FII/DII flows or global cues. Use them only when the member explicitly asks about the overall market AND the CONTEXT contains the figure.",
                  "3. If the member asks about a specific stock that is not in the CONTEXT, reply only that the data for that stock is not available in the current market catalog, and that it is not in the tracked universe so you cannot give a verdict. Never give, guess or imply a verdict for a stock you have no data for.",
                  "4. Never repeat a previous reply or reuse its wording. Each answer must respond to the current question directly; if the member repeats a question, restate the answer more compactly, do not replay the same paragraph.",
                  "5. Be direct and brief: 2-4 sentences for a stock or IPO question, at most 5 for a portfolio question. No preamble, no recap of the question.",
                  "6. Quote prices, verdicts, confidence and horizons only as they appear in the CONTEXT. Keep numbers, tickers and ratios in English.",
                  "7. Only when the CONTEXT carries a stored verdict for the instrument the member asked about, end with the decision on its own final line exactly like **FINAL VERDICT: BUY** (or HOLD, SELL, STRONG BUY, STRONG SELL for a stock; APPLY, WATCH, AVOID for an IPO), and write nothing after it. When you have no data, emit no verdict line at all.",
                  "8. Light markdown only: plain sentences and **bold** for the verdict line. No headings, bullet lists, tables or JSON.",
                  "9. Close the body with a one-line reminder that this is research, not investment advice — but only when you actually gave an answer.",
                  "10. On evidence: for a portfolio or stock call, judge on valuation, debt load and macro tailwinds together, never on one number. For an IPO, a high-conviction reading needs a confluence of a high GMP, a strong subscription book and a fundamentally sound company — without all three, keep the tone cautious.",
                  "11. SCOPE: when the CONTEXT contains the stock or IPO the member asked about, answer ONLY about it. Never substitute a holding from their portfolio for the instrument they named, never pad the answer with their other positions, and mention a portfolio stock only when the member explicitly asks for a comparison.",
                  "12. ANSWER THE QUESTION, NOT A SUMMARY: if the member asks for a verdict, a rating or a price, give 2-4 complete sentences that state WHY, using the figures in the CONTEXT — subscription and GMP for an IPO, valuation, debt and macro tailwinds for a stock. A one-line verdict or \"it depends\" is never acceptable.",
                ].join(" "),
              },
            ],
          },
          contents: [
            ...history,
            { role: "user", parts: [{ text: prompt }] },
          ],
          generationConfig: {
            // Low temperature keeps the model on the supplied rows instead of
            // free-associating macro commentary. 500 output tokens is enough
            // for the 2-5 sentence answers we ask for and no more, so a long
            // reply can never run the bill or overflow the widget.
            temperature: 0.2,
            maxOutputTokens: 500,
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `[portfolio-chat] Gemini HTTP ${response.status} for model "${model}": ${detail.slice(0, 500)}`,
      );
      if (isRateLimit(response.status, detail)) {
        // Quota, not a broken assistant: the widget turns this into a toast.
        return json({ error: RATE_LIMIT_CODE, message: RATE_LIMIT_MESSAGE }, 429);
      }
      return json(
        { error: `The assistant is unavailable right now (Gemini ${response.status}).` },
        502,
      );
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    reply =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    if (!reply) {
      return json({ error: "The assistant returned an empty reply." }, 502);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[portfolio-chat] transport failure: ${detail}`);
    return json({ error: `The assistant could not be reached: ${detail}` }, 502);
  }    return json({
    reply,
    holdings: rows.length,
    catalogCount,
    ipoCount: ipoRows.length,
  });
}); // Deploy test - [aaj ki date]
