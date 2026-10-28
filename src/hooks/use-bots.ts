import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";

const BOTS_KEY = ["bots"] as const;

export interface Bot {
  id: string;
  name: string;
  token: string;
  chatId: string;
  createdAt: string;
}

interface BotRow {
  id: string;
  name: string;
  telegram_bot_token: string;
  chat_id: string;
  created_at: string;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function mapBotRow(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    token: row.telegram_bot_token,
    chatId: row.chat_id,
    createdAt: formatDate(row.created_at),
  };
}

export function useBots(enabled: boolean) {
  const query = useQuery({
    queryKey: BOTS_KEY,
    enabled: enabled && isSupabaseConfigured,
    queryFn: async (): Promise<Bot[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);

      const { data, error } = await supabase
        .from("bots")
        .select("id, name, telegram_bot_token, chat_id, created_at")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return ((data ?? []) as BotRow[]).map(mapBotRow);
    },
  });

  return {
    bots: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface SaveBotInput {
  name: string;
  token: string;
  chatId: string;
}

export function useSaveBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveBotInput) => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);

      const { data, error } = await supabase
        .from("bots")
        .insert({
          name: input.name,
          telegram_bot_token: input.token,
          chat_id: input.chatId,
        })
        .select("id, name, telegram_bot_token, chat_id, created_at")
        .single();

      if (error) throw new Error(error.message);
      return mapBotRow(data as BotRow);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOTS_KEY });
    },
  });
}
