import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import { parseHoldingVerdict } from "@/lib/mappers";
import type { HoldingVerdict } from "@/types/domain";

const PORTFOLIO_KEY = ["portfolio"] as const;

export interface AddHoldingInput {
  userId: string;
  /** Symbol or company name as typed by the user. */
  stockName: string;
  symbol: string;
  quantity: number;
  buyPrice: number;
  /** ISO date: YYYY-MM-DD */
  purchaseDate: string;
}

export interface HoldingAnalysis {
  verdict: HoldingVerdict;
  reasoning: string;
  /** "gemini" only when the Edge Function reached the live model. */
  source: "gemini" | "mock";
}

const MOCK_ANALYSES: HoldingAnalysis[] = [
  {
    verdict: "STRONG BUY",
    reasoning:
      "Price is holding above its 50-day average with rising delivery volumes and the sector is outperforming. Add on dips while the trend stays intact.",
    source: "mock",
  },
  {
    verdict: "BUY",
    reasoning:
      "Earnings growth is running ahead of the sector average and the valuation is still reasonable. Accumulate gradually rather than in one lot.",
    source: "mock",
  },
  {
    verdict: "HOLD",
    reasoning:
      "Fundamentals are stable but momentum has flattened, so there is no edge in adding here. Stay invested and revisit after the next quarterly print.",
    source: "mock",
  },
  {
    verdict: "SELL",
    reasoning:
      "Revenue growth has slowed for two quarters and the stock is underperforming its sector. Trim the position and redeploy into higher-conviction ideas.",
    source: "mock",
  },
  {
    verdict: "STRONG SELL",
    reasoning:
      "Market sentiment is weak and the stock broke its 200-day support on heavy volume. Exit to avoid further losses.",
    source: "mock",
  },
];

const MOCK_NOTE =
  "PLACEHOLDER — not a Gemini call: the analyzer is unreachable or no API key is connected.";

/** Stable pseudo-analysis so the same symbol keeps the same placeholder call. */
function localFallback(symbol: string): HoldingAnalysis {
  let hash = 0;
  for (const character of symbol.toUpperCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }
  const picked = MOCK_ANALYSES[hash % MOCK_ANALYSES.length];
  return { ...picked, reasoning: `${MOCK_NOTE} ${picked.reasoning}` };
}

interface AnalyzePayload {
  verdict?: unknown;
  reasoning?: unknown;
  source?: unknown;
  error?: unknown;
}

async function runAnalysis(
  holdingId: string,
  userId: string,
  symbol: string,
): Promise<HoldingAnalysis> {
  if (!supabase) return localFallback(symbol);

  try {
    const { data, error } = await supabase.functions.invoke(
      "analyze-holding",
      { body: { holdingId } },
    );

    const payload = (data ?? {}) as AnalyzePayload;
    if (
      !error &&
      typeof payload.reasoning === "string" &&
      payload.reasoning.trim()
    ) {
      return {
        verdict: parseHoldingVerdict(
          typeof payload.verdict === "string" ? payload.verdict : null,
        ),
        reasoning: payload.reasoning.trim(),
        source: payload.source === "gemini" ? "gemini" : "mock",
      };
    }
  } catch {
    /* Function not deployed or offline — fall through to the placeholder. */
  }

  // The Edge Function is not available yet. RLS lets the owner write their own
  // row, so persist the placeholder call straight from the client.
  const fallback = localFallback(symbol);
  const { error: updateError } = await supabase
    .from("portfolio")
    .update({
      ai_verdict: fallback.verdict,
      ai_reasoning: fallback.reasoning,
      ai_source: "placeholder",
      last_analyzed_at: new Date().toISOString(),
      confidence: 60,
    })
    .eq("id", holdingId)
    .eq("user_id", userId);

  if (updateError) {
    console.warn("[portfolio] placeholder verdict not saved:", updateError.message);
  }

  return fallback;
}

export function useAddHolding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AddHoldingInput,
    ): Promise<{ analysis: HoldingAnalysis }> => {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error(SUPABASE_SETUP_MESSAGE);
      }

      const { data, error } = await supabase
        .from("portfolio")
        .insert({
          user_id: input.userId,
          stock_name: input.stockName,
          symbol: input.symbol,
          quantity: input.quantity,
          buy_price: input.buyPrice,
          // Marked at cost until a market price feed lands; avoids a fake loss.
          current_price: input.buyPrice,
          purchase_date: input.purchaseDate,
          ai_verdict: "HOLD",
          ai_reasoning: "AI analysis is running for this position.",
          ai_source: null,
          last_analyzed_at: null,
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      const analysis = await runAnalysis(
        (data as { id: string }).id,
        input.userId,
        input.symbol,
      );

      return { analysis };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PORTFOLIO_KEY });
    },
  });
}
