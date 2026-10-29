import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import {
  mapIpoRow,
  mapMarketIndexRow,
  mapPortfolioRow,
  mapSipRow,
  type IpoRow,
  type MarketIndexRow,
  type PortfolioRow,
  type SipRow,
} from "@/lib/mappers";
import { formatRelativeTime } from "@/lib/format";
import { readFunctionError } from "@/hooks/use-profiles";
import type {
  DeskBriefingItem,
  Holding,
  Ipo,
  MarketBriefing,
  MarketIndex,
  MarketMood,
  SipFund,
} from "@/types/domain";

const IPO_KEY = ["ipos"] as const;
const SIPS_KEY = ["sips"] as const;
const MARKET_INDICES_KEY = ["market_indices"] as const;
const MARKET_MOOD_KEY = ["market_mood"] as const;

/** Rows written by scraper/scraper.py, in the order the dashboard shows them. */
const MARKET_INDEX_IDS = ["nifty50", "sensex", "banknifty"];
const MARKET_INDEX_ORDER = new Map(
  MARKET_INDEX_IDS.map((id, index) => [id, index]),
);

export function useIpos() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: IPO_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<Ipo[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);
      const { data, error } = await supabase
        .from("ipos")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return ((data ?? []) as IpoRow[]).map(mapIpoRow);
    },
  });

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`ipos-live-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipos" },
        () => {
          void queryClient.invalidateQueries({ queryKey: IPO_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    ipos: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function usePortfolio(userId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["portfolio", userId] as const, [userId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(supabase && userId),
    queryFn: async (): Promise<Holding[]> => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from("portfolio")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      return ((data ?? []) as PortfolioRow[]).map(mapPortfolioRow);
    },
  });

  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(
        `portfolio-live-${userId}-${Math.random().toString(36).slice(2)}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portfolio",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: ["portfolio", userId],
          });
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient, userId]);

  return {
    holdings: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useMarketIndices() {
  const query = useQuery({
    queryKey: MARKET_INDICES_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<MarketIndex[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);
      const { data, error } = await supabase
        .from("market_indices")
        .select("*")
        .in("id", MARKET_INDEX_IDS);

      if (error) throw new Error(error.message);
      return ((data ?? []) as MarketIndexRow[])
        .map(mapMarketIndexRow)
        .sort(
          (a, b) =>
            (MARKET_INDEX_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (MARKET_INDEX_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
    },
    // The scraper refreshes the snapshot every 15 minutes; poll gently so a
    // dashboard left open picks up the latest sync without a reload.
    refetchInterval: 5 * 60_000,
  });

  return {
    indices: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    configured: isSupabaseConfigured,
  };
}

interface MoodPayload {
  mood?: {
    sentiment?: unknown;
    score?: unknown;
    confidence?: unknown;
    headline?: unknown;
    drivers?: unknown;
    generatedAt?: unknown;
  };
  briefing?: unknown;
  error?: string;
}

const SENTIMENTS: MarketMood["sentiment"][] = ["Bullish", "Bearish", "Neutral"];

function clampPercent(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function parseDrivers(value: unknown): MarketMood["drivers"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.value !== "string") {
      return [];
    }
    return [
      {
        label: record.label.slice(0, 40),
        value: record.value.slice(0, 24),
        direction:
          record.direction === "up" || record.direction === "down"
            ? record.direction
            : "flat",
      },
    ];
  });
}

function parseBriefing(value: unknown): DeskBriefingItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (
        typeof record.tag !== "string" ||
        typeof record.title !== "string" ||
        typeof record.body !== "string"
      ) {
        return [];
      }
      return [
        {
          tag: record.tag.slice(0, 24),
          title: record.title.slice(0, 60),
          body: record.body.slice(0, 240),
        },
      ];
    })
    .slice(0, 3);
}

/**
 * Market sentiment and desk briefing from the market-mood Edge Function. The
 * function reads `market_indices` itself and calls Gemini, so the dashboard
 * renders model output rather than copy written in this repo.
 */
export function useMarketMood() {
  const query = useQuery({
    queryKey: MARKET_MOOD_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<MarketBriefing> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);

      const { data, error } = await supabase.functions.invoke("market-mood");
      if (error) throw new Error(await readFunctionError(error, "market-mood"));

      const payload = (data ?? {}) as MoodPayload;
      if (payload.error) throw new Error(payload.error);

      const source = payload.mood;
      if (!source) throw new Error("The market-mood function returned no analysis.");

      const sentiment =
        typeof source.sentiment === "string" &&
        SENTIMENTS.includes(source.sentiment as MarketMood["sentiment"])
          ? (source.sentiment as MarketMood["sentiment"])
          : null;
      if (!sentiment) {
        throw new Error(
          "The market-mood function returned an unreadable sentiment.",
        );
      }
      if (typeof source.headline !== "string" || !source.headline.trim()) {
        throw new Error("The market-mood function returned an empty market read.");
      }

      const briefing = parseBriefing(payload.briefing);
      if (briefing.length === 0) {
        throw new Error("The market-mood function returned no briefing items.");
      }

      const generatedAt =
        typeof source.generatedAt === "string" && source.generatedAt
          ? source.generatedAt
          : new Date().toISOString();

      return {
        mood: {
          sentiment,
          score: clampPercent(source.score, 50),
          confidence: clampPercent(source.confidence, 50),
          headline: source.headline.trim(),
          drivers: parseDrivers(source.drivers),
          updated: formatRelativeTime(generatedAt),
        },
        briefing,
        generatedAt,
      };
    },
    // One Gemini call per refresh window keeps cost predictable while a
    // dashboard left open still picks up the next 15-minute sync.
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const analysis = query.data ?? null;

  return {
    mood: analysis?.mood ?? null,
    briefing: analysis?.briefing ?? [],
    generatedAt: analysis?.generatedAt ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    configured: isSupabaseConfigured,
  };
}

export function useSips() {
  const query = useQuery({
    queryKey: SIPS_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<SipFund[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);
      const { data, error } = await supabase
        .from("sips")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      return ((data ?? []) as SipRow[]).map(mapSipRow);
    },
  });

  return {
    sips: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
