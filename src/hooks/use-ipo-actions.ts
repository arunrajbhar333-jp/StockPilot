import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import { readFunctionError } from "@/lib/function-error";
import type { IpoVerdict } from "@/types/domain";

// Same key useIpos() reads, so the tracker picks up the new score immediately.
const IPO_KEY = ["ipos"] as const;

export interface IpoAnalysis {
  aiScore: number;
  verdict: IpoVerdict;
  reasoning: string;
}

interface AnalyzeIpoPayload {
  aiScore?: unknown;
  verdict?: unknown;
  reasoning?: unknown;
  skipped?: unknown;
  reason?: unknown;
  error?: unknown;
}

/**
 * Scores one issue with the analyze-ipo Edge Function. Only the service role or
 * an administrator may call it; the function answers 403 for anyone else.
 */
export function useReanalyzeIpo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { ipoId: string }): Promise<IpoAnalysis> => {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error(SUPABASE_SETUP_MESSAGE);
      }

      const { data, error } = await supabase.functions.invoke("analyze-ipo", {
        body: { ipoId: input.ipoId },
      });

      if (error) {
        throw new Error(await readFunctionError(error, "analyze-ipo"));
      }

      const payload = (data ?? {}) as AnalyzeIpoPayload;

      if (payload.skipped) {
        throw new Error(
          typeof payload.reason === "string" && payload.reason
            ? payload.reason
            : "The analyzer skipped this issue.",
        );
      }
      if (typeof payload.error === "string" && payload.error) {
        throw new Error(payload.error);
      }

      const score =
        typeof payload.aiScore === "number"
          ? payload.aiScore
          : Number(payload.aiScore);

      if (!Number.isFinite(score) || typeof payload.verdict !== "string") {
        throw new Error("The analyzer returned no verdict.");
      }

      return {
        aiScore: Math.min(10, Math.max(0, score)),
        verdict:
          payload.verdict === "APPLY" || payload.verdict === "AVOID"
            ? payload.verdict
            : "WATCH",
        reasoning:
          typeof payload.reasoning === "string" ? payload.reasoning : "",
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IPO_KEY });
    },
  });
}
