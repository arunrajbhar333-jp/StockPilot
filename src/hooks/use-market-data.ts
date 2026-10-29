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
import type { Holding, Ipo, MarketIndex, SipFund } from "@/types/domain";

const IPO_KEY = ["ipos"] as const;
const SIPS_KEY = ["sips"] as const;
const MARKET_INDICES_KEY = ["market_indices"] as const;

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
