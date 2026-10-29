// Supabase Edge Function: market-mood
//
// Reads the latest `market_indices` snapshot written by scraper/scraper.py and
// asks Gemini for a sentiment score (0-100), a one-line read of the tape and a
// three-item desk briefing. The dashboard's "AI market mood" card and "Desk
// briefing" card are both rendered from this response, so nothing in either
// widget is authored on the client.
//
// Caller: any signed-in, non-suspended workspace member. The browser sends no
// market payload — the function reads the table itself after verifying the
// bearer token and the caller's profile status.
//
// Deploy:
//   supabase functions deploy market-mood
//
// Secret (Project Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY = your Google AI Studio key
// Optional:
//   GEMINI_MODEL = gemini-2.5-flash   (default)
//
// Every failure is returned as { "error": "..." } with a non-2xx status so the
// dashboard can show the reason instead of inventing a market read.

import { createClient } from "npm:@supabase/supabase-js@2";

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

const SENTIMENTS = ["Bullish", "Bearish", "Neutral"] as const;
type Sentiment = (typeof SENTIMENTS)[number];

const BRIEFING_TAGS = ["Market", "IPO", "Portfolio", "SIP"] as const;
type BriefingTag = (typeof BRIEFING_TAGS)[number];

/** Row ids written by the scraper, in the order the dashboard shows them. */
const INDEX_ORDER = ["nifty50", "sensex", "banknifty"];

interface IndexRow {
  id: string;
  symbol: string;
  name: string;
  value: number | string | null;
  change: number | string | null;
  change_pct: number | string | null;
  day_low: number | string | null;
  day_high: number | string | null;
  updated_at: string | null;
}

function number(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function signed(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Evidence tiles: one per index, derived from the snapshot, never invented. */
function buildDrivers(rows: IndexRow[]) {
  return rows.map((row) => {
    const pct = number(row.change_pct);
    return {
      label: row.symbol,
      value: `${signed(pct)}%`,
      direction: pct > 0.02 ? "up" : pct < -0.02 ? "down" : "flat",
    };
  });
}

function buildPrompt(rows: IndexRow[]): string {
  const lines = rows.map((row) => {
    const value = number(row.value);
    const change = number(row.change);
    const pct = number(row.change_pct);
    const low = row.day_low === null || row.day_low === undefined ? value : number(row.day_low);
    const high = row.day_high === null || row.day_high === undefined ? value : number(row.day_high);
    const written = row.updated_at ? Date.parse(row.updated_at) : Number.NaN;
    const ageMinutes = Number.isNaN(written)
      ? null
      : Math.max(0, Math.round((Date.now() - written) / 60_000));

    return [
      `${row.symbol} — ${row.name}`,
      `  last ${value.toFixed(2)} (change ${signed(change)}, ${signed(pct)}%)`,
      `  derived previous close ${(value - change).toFixed(2)}, day range ${low.toFixed(2)}–${high.toFixed(2)}`,
      ageMinutes === null
        ? "  snapshot age unknown"
        : `  snapshot written ${ageMinutes} minutes ago`,
    ].join("\n");
  });

  return [
    "Latest index snapshot from the market sync (NSE/BSE index points, delayed by up to 15 minutes):",
    "",
    ...lines,
    "",
    "Return a JSON object with:",
    "1. sentiment — Bullish, Bearish or Neutral for this session.",
    "2. score — integer 0-100 greed/fear style reading, where 50 is balanced. Derive it from the sign and size of the moves and from where the last value sits inside the day range.",
    "3. confidence — integer 0-100 for how much evidence this snapshot carries. Three indices from one session is thin evidence, so stay below 80 unless the moves are decisive.",
    "4. headline — one sentence, at most 160 characters, describing the tape shown above.",
    "5. briefing — exactly three items in the shape {tag, title, body} for the desk notes column: tag is one of Market, IPO, Portfolio, SIP; title is at most 40 characters in sentence case with no trailing period; body is at most 180 characters carrying one concrete, actionable observation for an internal Indian equity desk.",
    "",
    "Rules: use only the numbers printed above. Never invent FII flows, VIX, RSI, advance/decline counts, earnings, IPO subscription figures or index levels. If the snapshot is too thin for a strong call, lower the confidence instead of guessing.",
  ].join("\n");
}

interface MoodAnalysis {
  sentiment: Sentiment;
  score: number;
  confidence: number;
  headline: string;
  briefing: { tag: BriefingTag; title: string; body: string }[];
}

function parseGeminiJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

async function generateMood(
  rows: IndexRow[],
  apiKey: string,
  model: string,
): Promise<MoodAnalysis> {
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
              text: "You are the market desk analyst at StockPilot, an internal Indian equities, IPO and SIP desk. You are factual, restrained and specific. You never invent data that was not supplied. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: buildPrompt(rows) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              sentiment: { type: "STRING", enum: [...SENTIMENTS] },
              score: { type: "INTEGER" },
              confidence: { type: "INTEGER" },
              headline: { type: "STRING" },
              briefing: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    tag: { type: "STRING", enum: [...BRIEFING_TAGS] },
                    title: { type: "STRING" },
                    body: { type: "STRING" },
                  },
                  required: ["tag", "title", "body"],
                  propertyOrdering: ["tag", "title", "body"],
                },
              },
            },
            required: ["sentiment", "score", "confidence", "headline", "briefing"],
            propertyOrdering: [
              "sentiment",
              "score",
              "confidence",
              "headline",
              "briefing",
            ],
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
  if (!parsed) throw new Error("Gemini did not return parseable JSON.");

  const sentiment =
    typeof parsed.sentiment === "string" &&
    (SENTIMENTS as readonly string[]).includes(parsed.sentiment)
      ? (parsed.sentiment as Sentiment)
      : null;
  const headline =
    typeof parsed.headline === "string"
      ? parsed.headline.trim().replace(/\s+/g, " ").slice(0, 180)
      : "";

  if (!sentiment) throw new Error("Gemini did not return a usable sentiment.");
  if (!headline) throw new Error("Gemini did not return a headline.");

  const rawBriefing = Array.isArray(parsed.briefing) ? parsed.briefing : [];
  const briefing = rawBriefing
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const tag =
        typeof record.tag === "string" &&
        (BRIEFING_TAGS as readonly string[]).includes(record.tag)
          ? (record.tag as BriefingTag)
          : null;
      const title =
        typeof record.title === "string"
          ? record.title.trim().replace(/\s+/g, " ").slice(0, 60)
          : "";
      const body =
        typeof record.body === "string"
          ? record.body.trim().replace(/\s+/g, " ").slice(0, 220)
          : "";
      return tag && title && body ? { tag, title, body } : null;
    })
    .filter((item): item is MoodAnalysis["briefing"][number] => item !== null)
    .slice(0, 3);

  if (briefing.length === 0) {
    throw new Error("Gemini did not return usable briefing items.");
  }

  return {
    sentiment,
    score: clampPercent(Number(parsed.score)),
    confidence: clampPercent(Number(parsed.confidence)),
    headline,
    briefing,
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

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("status")
    .eq("id", caller.id)
    .maybeSingle();

  if (profileError) {
    return json({ error: "Could not verify your profile." }, 500);
  }
  if (!profile) {
    return json({ error: "Your account has no workspace profile." }, 403);
  }
  if (profile.status === "suspended") {
    return json({ error: "This account is suspended." }, 403);
  }

  const { data, error } = await admin
    .from("market_indices")
    .select(
      "id, symbol, name, value, change, change_pct, day_low, day_high, updated_at",
    )
    .in("id", INDEX_ORDER);

  if (error) {
    return json({ error: error.message }, 500);
  }

  const rows = ((data ?? []) as IndexRow[]).sort(
    (a, b) => INDEX_ORDER.indexOf(a.id) - INDEX_ORDER.indexOf(b.id),
  );

  if (rows.length === 0) {
    return json(
      {
        error:
          "No index snapshot has been written yet. Run the market sync before asking Gemini to read the tape.",
      },
      404,
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  if (!apiKey) {
    return json(
      {
        error:
          "GEMINI_API_KEY is not set, so the market mood cannot be generated. Add it under Edge Functions → Secrets.",
      },
      503,
    );
  }

  let analysis: MoodAnalysis;
  try {
    analysis = await generateMood(rows, apiKey, model);
  } catch (error) {
    console.error("[market-mood] Gemini call failed:", error);
    return json(
      { error: "Gemini did not return a usable market read. Try again shortly." },
      502,
    );
  }

  const generatedAt = new Date().toISOString();

  return json({
    mood: {
      sentiment: analysis.sentiment,
      score: analysis.score,
      confidence: analysis.confidence,
      headline: analysis.headline,
      drivers: buildDrivers(rows),
      generatedAt,
    },
    briefing: analysis.briefing,
    generatedAt,
  });
});
