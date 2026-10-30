import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import { readFunctionError } from "@/lib/function-error";
import type { IpoVerdict } from "@/types/domain";

// Same key useIpos() reads, so the tracker picks up the new score immediately.
const IPO_KEY = ["ipos"] as const;

// Gemini free tiers allow only a handful of requests per minute, so the bulk
// pass paces itself instead of firing every call at once.
const BETWEEN_CALLS_MS = 1_000;

export interface IpoAnalysis {
  aiScore: number;
  verdict: IpoVerdict;
  reasoning: string;
}

export interface BulkAnalyzeResult {
  total: number;
  analyzed: number;
  failed: number;
  failedCompanies: string[];
}

interface AnalyzeIpoPayload {
  aiScore?: unknown;
  verdict?: unknown;
  reasoning?: unknown;
  skipped?: unknown;
  reason?: unknown;
  error?: unknown;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Scores one issue with the analyze-ipo Edge Function. Only the service role or
 * an administrator may call it; the function answers 403 for anyone else.
 */
async function requestIpoAnalysis(ipoId: string): Promise<IpoAnalysis> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(SUPABASE_SETUP_MESSAGE);
  }

  const { data, error } = await supabase.functions.invoke("analyze-ipo", {
    body: { ipoId },
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
    typeof payload.aiScore === "number" ? payload.aiScore : Number(payload.aiScore);

  if (!Number.isFinite(score) || typeof payload.verdict !== "string") {
    throw new Error("The analyzer returned no verdict.");
  }

  return {
    aiScore: Math.min(10, Math.max(0, score)),
    verdict:
      payload.verdict === "APPLY" || payload.verdict === "AVOID"
        ? payload.verdict
        : "WATCH",
    reasoning: typeof payload.reasoning === "string" ? payload.reasoning : "",
  };
}

/** Scores a single issue, e.g. from the row-level Re-analyze button. */
export function useReanalyzeIpo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ipoId: string }) => requestIpoAnalysis(input.ipoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IPO_KEY });
    },
  });
}

/**
 * Scores every pending issue one after another, refreshing the table after each
 * success so the tracker fills in as the run progresses. A failure is logged and
 * skipped; the caller reports the tally when the run settles.
 */
export function useReanalyzeAllIpos() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(
    null,
  );

  const mutation = useMutation({
    mutationFn: async (
      targets: { id: string; company: string }[],
    ): Promise<BulkAnalyzeResult> => {
      const failedCompanies: string[] = [];
      let analyzed = 0;

      setProgress({ current: 0, total: targets.length });
      try {
        for (const [index, ipo] of targets.entries()) {
          setProgress({ current: index + 1, total: targets.length });
          try {
            await requestIpoAnalysis(ipo.id);
            analyzed += 1;
            void queryClient.invalidateQueries({ queryKey: IPO_KEY });
          } catch (error) {
            failedCompanies.push(ipo.company);
            console.error(
              `[analyze-ipo] ${ipo.company} (${ipo.id}) failed:`,
              error instanceof Error ? error.message : error,
            );
          }

          if (index < targets.length - 1) await sleep(BETWEEN_CALLS_MS);
        }
      } finally {
        setProgress(null);
      }

      return {
        total: targets.length,
        analyzed,
        failed: failedCompanies.length,
        failedCompanies,
      };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: IPO_KEY });
    },
  });

  return { ...mutation, progress };
}
