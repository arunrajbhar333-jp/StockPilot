import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import {
  mapIpoRow,
  mapPortfolioRow,
  mapSipRow,
  type IpoRow,
  type PortfolioRow,
  type SipRow,
} from "@/lib/mappers";
import type { Holding, Ipo, SipFund } from "@/types/domain";

const IPO_KEY = ["ipos"] as const;
const SIPS_KEY = ["sips"] as const;

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
