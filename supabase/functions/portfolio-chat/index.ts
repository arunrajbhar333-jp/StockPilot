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

const MAX_MESSAGE_LENGTH = 2000;
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
}

/** The shape the IPO query returns. Column names differ across migrations, so
 *  the function reads by name and normalizes before passing it to Gemini.
 */
interface IpoRow {
  id: string | null;
  company_name: string | null;
  type: string | null;
  gmp: number | string | null;
  subscription: number | string | null;
  ai_score: number | string | null;
  verdict: string | null;
  status: string | null;
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

/** One line per IPO so the assistant can answer about fresh issues. */
function ipoLines(rows: IpoRow[]): string[] {
  if (!rows.length) return ["(No live/upcoming IPOs returned.)"];

  return rows.map((row) => {
    const gmp = number(row.gmp);
    const subscription = number(row.subscription);
    const score = number(row.ai_score);
    const name =
      row.company_name ||
      `ipo-${row.id ?? "unknown"}`;
    const type = row.type || "IPO";

    return [
      `- ${name} (${type})`,
      `  gmp INR ${gmp.toFixed(0)} · subscription ${subscription.toFixed(1)}x`,
      `  ai_score: ${score.toFixed(1)}/10 · verdict: ${row.verdict ?? "not analysed"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
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

/** Signals that the member is asking for a call on a named instrument. */
const STOCK_INTENT =
  /\b(buy|buying|sell|selling|hold|holding|analyz\w*|analys\w*|target|verdict|invest\w*|entry|exit|kharid\w*|bech\w*|rakh\w*)\b/i;

function key(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value: string): string[] {
  return value
    .replace(/[^A-Za-z0-9&\-\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Consecutive non-filler words, e.g. "Aarti Industries" from a full question. */
function extractMentionedNames(message: string): string[] {
  const groups: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      const phrase = current.join(" ");
      if (key(phrase).length >= 3) groups.push(phrase);
      current = [];
    }
  };

  for (const word of words(message)) {
    if (STOP_WORDS.has(word.toLowerCase())) {
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
  // fresh issue. Column names vary across migrations, so the function picks the
  // available Knockout columns by name.
  const { data: ipos, error: iposError } = await admin
    .from("ipos")
    .select("id, company_name, type, gmp, subscription, ai_score, verdict, status")
    .order("ai_score", { ascending: false, nullsFirst: false })
    .limit(20);

  if (iposError) {
    return json({ error: `Could not read the IPOs: ${iposError.message}` }, 500);
  }

  const ipoRows = (ipos ?? []) as unknown as IpoRow[];

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
  const ipoMatches = ipoRows.filter((row) =>
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
    const needle = mentioned[0].replace(/[%,()*]/g, "").trim();
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

  let mode: "ipo" | "instrument" | "macro" | "portfolio" | "unknown";
  let context = "";
  let missing = "";

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
        ? "The member asked about one specific stock. Use only its row(s) in CONTEXT. Do not bring in Nifty 50, Sensex, crude oil, USD/INR, inflation or global cues: they were not asked for and are not in the context. Answer the exact question asked, then stop."
        : mode === "ipo"
          ? "The member asked about one IPO. Use only its row in CONTEXT. Answer the exact question asked, then stop: no macro commentary."
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
                  "You are StockPilot AI, a senior SEBI-registered equity research analyst advising an Indian retail investor.",
                  "You speak courteous, professional Hinglish in Roman script and address the member as 'aap'; never use 'tu', 'tum', 'bhai', slang or exclamation marks.",
                  "STRICT RULES, all mandatory:",
                  "1. Answer ONLY from the CONTEXT in the user message. You have no other knowledge for this answer. If the CONTEXT is empty or does not cover the question, say plainly that the data is not available.",
                  "2. NEVER invent or insert market-wide data: no Nifty 50 or Sensex levels, crude oil or Brent prices, USD/INR, inflation, RBI policy, FII/DII flows or global cues. Use them only when the member explicitly asks about the overall market AND the CONTEXT contains the figure.",
                  "3. If the member asks about a specific stock that is not in the CONTEXT, reply only that the data for that stock is not available in the current market catalog, and that it is not in the tracked universe so you cannot give a verdict. Never give, guess or imply a verdict for a stock you have no data for.",
                  "4. Never repeat a previous reply or reuse its wording. Each answer must respond to the current question directly; if the member repeats a question, restate the answer more compactly, do not replay the same paragraph.",
                  "5. Be direct and brief: 2-4 sentences for a stock or IPO question, at most 5 for a portfolio question. No preamble, no recap of the question.",
                  "6. Quote prices, verdicts, confidence and horizons only as they appear in the CONTEXT. Keep numbers, tickers and ratios in English.",
                  "7. Only when the CONTEXT carries a stored verdict for the instrument the member asked about, end with the decision on its own final line exactly like **FINAL VERDICT: BUY** (or HOLD, SELL, STRONG BUY, STRONG SELL), and write nothing after it. When you have no data, emit no verdict line at all.",
                  "8. Light markdown only: plain sentences and **bold** for the verdict line. No headings, bullet lists, tables or JSON.",
                  "9. Close the body with a one-line reminder that this is research, not investment advice — but only when you actually gave an answer.",
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
            // free-associating macro commentary.
            temperature: 0.2,
            maxOutputTokens: 400,
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `[portfolio-chat] Gemini HTTP ${response.status} for model "${model}": ${detail.slice(0, 500)}`,
      );
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
}); 
