// Supabase Edge Function: portfolio-chat
//
// The in-app "Ask AI" assistant. It loads three context sets before asking
// Gemini to answer one question in clear Hinglish:
//   1. The caller's portfolio holdings (with stored AI analysis).
//   2. The general market catalog (top 20 listings).
//   3. Live/upcoming IPOs.
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

  // General market context: top 20 stocks from the live/upcoming catalog so the
  // assistant can answer about names the user does not hold.
  const { data: catalog, error: catalogError } = await admin
    .from("market_catalog")
    .select("symbol, stock_name, current_price, ai_verdict, ai_reasoning")
    .order("current_price", { ascending: false, nullsFirst: false })
    .limit(20);

  if (catalogError) {
    return json({ error: `Could not read the market catalog: ${catalogError.message}` }, 500);
  }

  const catalogRows = (catalog ?? []) as unknown as CatalogRow[];

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

  const snapshot = await marketSnapshot();
  const prompt = [
    `A member has asked: "${message}"`,
    "",
    "You are StockPilot AI. You have access to the user's portfolio, the general market catalog, and live IPOs. If the user asks about a stock not in their portfolio, look it up in the market_catalog data. If they ask about an IPO, look it up in the ipos data. Do NOT say you don't have data if it is provided below.",
    "",
    "Their portfolio (fresh from Supabase):",
    ...portfolioLines(rows),
    "",
    "Market catalog (top 20):",
    ...catalogLines(catalogRows),
    "",
    "Live IPOs:",
    ...ipoLines(ipoRows),
    "",
    "Live market context:",
    snapshot,
    "",
    "Answer in clear Hinglish (Roman script), 3-6 short sentences, the way a knowledgeable friend would: name the stock or IPO they asked about, tie the answer to India's macro or crude or global cues where that actually matters, give the action (BUY / HOLD / SELL), and finish with the stored verdict in the form (Verdict: HOLD). If a horizon matters, say how long to hold (jaise 3-6 mahine). Keep numbers, tickers and ratios in English. Never invent a price or a news event: if the data is not in the prompt, say the data nahi hai. Close with a one-line reminder that this is research, not investment advice.",
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
                text: "You are StockPilot's in-app AI assistant for an Indian retail investor. You know their portfolio and its stored AI verdicts, and you speak fluent Hinglish. You are direct, you never hedge with maybes, and you never claim data you were not given. Reply with plain text only — no markdown, no JSON.",
              },
            ],
          },
          contents: [
            ...history,
            { role: "user", parts: [{ text: prompt }] },
          ],
          generationConfig: {
            temperature: 0.6,
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
  }

  return json({
    reply,
    holdings: rows.length,
    catalogCount: catalogRows.length,
    ipoCount: ipoRows.length,
  });
});
