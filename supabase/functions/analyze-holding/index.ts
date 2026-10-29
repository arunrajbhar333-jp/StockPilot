// Supabase Edge Function: analyze-holding
//
// Generates a STRONG BUY / BUY / HOLD / SELL / STRONG SELL call for one
// portfolio position with the Gemini API and stores the result on the row.
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
}

function placeholderAnalysis(symbol: string, note: string): Analysis {
  const verdict = VERDICTS[hash(symbol) % VERDICTS.length];
  return {
    verdict,
    reasoning: `${note} ${PLACEHOLDER_REASONS[verdict]}`,
    confidence: 60,
    source: "mock",
  };
}

function buildPrompt(holding: HoldingRow): string {
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
    "",
    "Grade this position for an Indian retail investor. Use STRONG BUY or STRONG SELL only when the evidence is decisive; otherwise use BUY, HOLD or SELL.",
    "Reasoning must be one or two sentences, concrete, and must end with the action to take.",
  ].join("\n");
}

function parseGeminiJson(text: string): { verdict?: unknown; reasoning?: unknown; confidence?: unknown } | null {
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
  holding: HoldingRow,
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
              text: "You are a disciplined Indian equity analyst. You are decisive, cite price action and fundamentals, and never hedge. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: buildPrompt(holding) }] }],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              verdict: { type: "STRING", enum: [...VERDICTS] },
              reasoning: { type: "STRING" },
              confidence: { type: "INTEGER" },
            },
            required: ["verdict", "reasoning", "confidence"],
            propertyOrdering: ["verdict", "reasoning", "confidence"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");

  if (!text) throw new Error("Gemini returned an empty response.");

  const parsed = parseGeminiJson(text);
  if (!parsed || !isVerdict(parsed.verdict)) {
    throw new Error("Gemini did not return a usable verdict.");
  }

  const reasoning =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning.trim().replace(/\s+/g, " ").slice(0, 320)
      : "";
  const confidenceValue =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : Number(parsed.confidence);

  return {
    verdict: parsed.verdict,
    reasoning:
      reasoning || PLACEHOLDER_REASONS[parsed.verdict as Verdict],
    confidence: Number.isFinite(confidenceValue)
      ? Math.min(100, Math.max(0, Math.round(confidenceValue)))
      : 60,
    source: "gemini",
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await admin.auth.getUser(accessToken);

  if (callerError || !caller) {
    return json({ error: "Your session is invalid. Sign in again." }, 401);
  }

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

  let body: { holdingId?: unknown };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const holdingId =
    typeof body.holdingId === "string" ? body.holdingId.trim() : "";
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
  if ((holding as HoldingRow).user_id !== caller.id) {
    return json({ error: "You can only analyse your own holdings." }, 403);
  }

  const row = holding as HoldingRow;
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  let analysis: Analysis;
  if (!apiKey) {
    analysis = placeholderAnalysis(
      row.symbol ?? row.stock_name,
      "PLACEHOLDER — not a Gemini call: GEMINI_API_KEY is not set.",
    );
  } else {
    try {
      analysis = await analyzeWithGemini(row, apiKey, model);
    } catch (error) {
      console.error("[analyze-holding] Gemini call failed:", error);
      analysis = placeholderAnalysis(
        row.symbol ?? row.stock_name,
        "PLACEHOLDER — not a Gemini call: Gemini was unreachable.",
      );
    }
  }

  const analyzedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("portfolio")
    .update({
      ai_verdict: analysis.verdict,
      ai_reasoning: analysis.reasoning,
      ai_source: analysis.source === "gemini" ? "gemini" : "placeholder",
      confidence: analysis.confidence,
      last_analyzed_at: analyzedAt,
    })
    .eq("id", row.id)
    .eq("user_id", caller.id);

  if (updateError) {
    return json({ error: `The verdict could not be saved: ${updateError.message}` }, 500);
  }

  return json({ ...analysis, analyzedAt });
});
