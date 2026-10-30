// Supabase Edge Function: analyze-ipo
//
// Grades one IPO issue with the Gemini API: a 1–10 AI score, an
// APPLY / WATCH / AVOID verdict, and a one-line underwriting reason. The
// result is written back to public.ipos (ai_score, verdict, thesis).
//
// Callers:
//   - The market-sync scraper, which sends the service role key as a system
//     caller right after it inserts a new issue.
//   - An active administrator, from the app or the dashboard.
// Regular members are rejected: an IPO verdict is shared by every member, so
// only the desk (or the sync job) is allowed to spend Gemini quota on it.
//
// Deploy:
//   supabase functions deploy analyze-ipo
//
// Secret (Project Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY = your Google AI Studio key
// Optional:
//   GEMINI_MODEL = gemini-2.5-flash   (default)
//
// Without GEMINI_API_KEY nothing is written: the row keeps its 0.0 / WATCH
// defaults, which is honest, and the response is { skipped: true }.

import { createClient } from "npm:@supabase/supabase-js@2";

const VERDICTS = ["APPLY", "WATCH", "AVOID"] as const;

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

interface IpoRow {
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
  subscription: number | string | null;
  open_date: string | null;
  close_date: string | null;
  status: string | null;
}

function number(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return `INR ${value.toFixed(2)}`;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function buildPrompt(ipo: IpoRow): string {
  const low = number(ipo.price_band_low);
  const high = number(ipo.price_band_high);
  const lotSize = number(ipo.lot_size);
  const gmp = number(ipo.gmp);
  const gmpPct = number(ipo.gmp_pct);
  const subscription = number(ipo.subscription);

  const today = new Date();
  const closeDate = ipo.close_date ? new Date(ipo.close_date) : null;
  const daysToClose = closeDate ? daysBetween(today, closeDate) : null;

  const lines = [
    `Issue: ${ipo.company_name}`,
    `Board: ${ipo.type ?? "not set"}`,
    `Sector: ${ipo.sector ?? "not set"}`,
    low > 0 && high > 0
      ? `Price band: ${money(low)} to ${money(high)} per share`
      : "Price band: not published",
    lotSize > 0 && high > 0
      ? `Lot size: ${lotSize} shares (minimum investment ${money(lotSize * high)})`
      : `Lot size: ${lotSize > 0 ? lotSize : "not published"}`,
    `Issue size: ${ipo.issue_size ?? "not published"}`,
    ipo.gmp_pct !== null && ipo.gmp_pct !== undefined
      ? `Grey market premium: ${money(gmp)} (${gmpPct.toFixed(1)}% over the upper band)`
      : gmp > 0
        ? `Grey market premium: ${money(gmp)}`
        : "Grey market premium: none quoted",
    subscription > 0
      ? `Subscription: ${subscription.toFixed(2)}x the offer`
      : "Subscription: not reported yet, the book has not opened or the exchange has not published demand.",
    `Bidding window: ${ipo.open_date ?? "unknown"} to ${ipo.close_date ?? "unknown"} (status: ${ipo.status ?? "unknown"})`,
    daysToClose === null
      ? "Days to close: unknown"
      : daysToClose < 0
        ? "Days to close: the issue has already closed, so only the grey market premium and issue structure carry signal."
        : `Days to close: ${daysToClose}`,
    "",
    "Score this issue from 1 to 10 and call it APPLY, WATCH or AVOID for an Indian retail investor applying for listing gains.",
    "Calibrate the score like this: 9-10 exceptional (rich demand or a large premium on a reasonably priced book), 7-8 good, 5-6 mixed or fully priced, 3-4 weak, 1-2 outright avoid.",
    "Judge pricing versus peers, the grey market premium, demand, issue size and float, and the risk of an SME issue with a tiny float.",
    "Never invent data that is not listed above. Treat a missing premium or an unreported subscription as a reason to lower conviction, and say so plainly.",
    "The reason must be a single sentence of at most 200 characters that names the grey market premium and the subscription figure, and ends with the action to take.",
  ];

  return lines.join("\n");
}

function parseGeminiJson(
  text: string,
): { score?: unknown; verdict?: unknown; reasoning?: unknown } | null {
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

interface Analysis {
  aiScore: number;
  verdict: Verdict;
  reasoning: string;
}

async function analyzeWithGemini(
  ipo: IpoRow,
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
              text: "You are a disciplined Indian primary-market analyst who grades IPOs for listing gains. You are decisive, you weigh pricing against demand and the grey market premium, and you never hedge. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: buildPrompt(ipo) }] }],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              score: { type: "NUMBER" },
              verdict: { type: "STRING", enum: [...VERDICTS] },
              reasoning: { type: "STRING" },
            },
            required: ["score", "verdict", "reasoning"],
            propertyOrdering: ["score", "verdict", "reasoning"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    // 400 = bad request/schema, 403 = key rejected, 429 = quota, 404 = model.
    console.error(
      `[analyze-ipo] Gemini HTTP ${response.status} for model "${model}": ${detail.slice(0, 500)}`,
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
      `[analyze-ipo] Gemini returned no text for model "${model}": ${JSON.stringify(payload).slice(0, 500)}`,
    );
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = parseGeminiJson(text);
  if (!parsed || !isVerdict(parsed.verdict)) {
    console.error(
      `[analyze-ipo] unusable Gemini output for model "${model}": ${text.slice(0, 500)}`,
    );
    throw new Error("Gemini did not return a usable IPO verdict.");
  }

  const rawScore = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
  if (!Number.isFinite(rawScore)) {
    throw new Error("Gemini did not return a usable score.");
  }

  const reason =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning.trim().replace(/\s+/g, " ").slice(0, 280)
      : "";

  return {
    // numeric(4,1) column: one decimal, clamped to the 1-10 band.
    aiScore: Math.min(10, Math.max(1, Math.round(rawScore * 10) / 10)),
    verdict: parsed.verdict,
    reasoning: reason,
  };
}

async function handle(req: Request): Promise<Response> {
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

  if (!systemCaller) {
    const {
      data: { user: caller },
      error: callerError,
    } = await admin.auth.getUser(accessToken);

    if (callerError || !caller) {
      return json({ error: "Your session is invalid. Sign in again." }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("status, role")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfileError) {
      return json({ error: "Could not verify your profile." }, 500);
    }
    if (callerProfile?.status === "suspended") {
      return json({ error: "This account is suspended." }, 403);
    }
    if (callerProfile?.role !== "admin") {
      return json(
        { error: "Only an administrator can analyse an IPO issue." },
        403,
      );
    }
  }

  let body: { ipoId?: unknown; ipo_id?: unknown };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  // Both spellings are accepted: the app sends ipoId, the scraper ipo_id.
  const rawId = body.ipoId ?? body.ipo_id;
  const ipoId = typeof rawId === "string" ? rawId.trim() : "";
  if (!ipoId) {
    return json({ error: "An IPO ID is required." }, 400);
  }

  const { data: ipo, error: ipoError } = await admin
    .from("ipos")
    .select(
      "id, company_name, type, sector, price_band_low, price_band_high, lot_size, issue_size, gmp, gmp_pct, subscription, open_date, close_date, status",
    )
    .eq("id", ipoId)
    .maybeSingle();

  if (ipoError) {
    return json({ error: ipoError.message }, 500);
  }
  if (!ipo) {
    return json({ error: "That IPO no longer exists." }, 404);
  }

  const row = ipo as IpoRow;
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";

  if (!apiKey) {
    console.error(
      `[analyze-ipo] GEMINI_API_KEY is not set — leaving ${row.company_name} at its default score.`,
    );
    return json({
      skipped: true,
      reason:
        "GEMINI_API_KEY is not set; the IPO keeps its default 0.0 / WATCH score.",
    });
  }

  console.log(
    `[analyze-ipo] calling Gemini model "${model}" for ${row.company_name} (system caller: ${systemCaller})`,
  );

  let analysis: Analysis;
  try {
    analysis = await analyzeWithGemini(row, apiKey, model);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-ipo] Gemini call failed:", detail);
    return json(
      { error: `IPO analysis failed: ${detail.slice(0, 240)}` },
      502,
    );
  }

  const analyzedAt = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ai_score: analysis.aiScore,
    verdict: analysis.verdict,
  };
  // The tracker renders `thesis` as the "AI underwriting note". Only overwrite
  // it when Gemini actually produced a note, so an empty reply cannot blank an
  // existing thesis.
  if (analysis.reasoning) {
    patch.thesis = analysis.reasoning;
  }

  const { error: updateError } = await admin
    .from("ipos")
    .update(patch)
    .eq("id", row.id);

  if (updateError) {
    return json(
      { error: `The IPO verdict could not be saved: ${updateError.message}` },
      500,
    );
  }

  console.log(
    `[analyze-ipo] ${row.company_name}: ${analysis.verdict} at ${analysis.aiScore}/10`,
  );

  return json({
    ipoId: row.id,
    company: row.company_name,
    aiScore: analysis.aiScore,
    verdict: analysis.verdict,
    reasoning: analysis.reasoning,
    source: "gemini",
    analyzedAt,
  });
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    // Anything unexpected (network, JSON, Supabase) still answers with JSON so
    // the scraper logs a readable reason instead of a bare 500.
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[analyze-ipo] unhandled error:", detail);
    return json({ error: `IPO analysis failed: ${detail.slice(0, 240)}` }, 500);
  }
});
