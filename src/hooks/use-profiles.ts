import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import { mapProfileRow, type ProfileRow } from "@/lib/mappers";
import type { ModuleKey, WorkspaceUser } from "@/types/domain";

const PROFILES_KEY = ["profiles"] as const;

async function readFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error) return body.error;
      } catch {
        /* fall through to the generic message */
      }
    }
  }
  if (error instanceof Error && error.message) {
    if (error.message.toLowerCase().includes("failed to send a request")) {
      return "The admin-create-user function is not deployed. Deploy it with `supabase functions deploy admin-create-user`.";
    }
    return error.message;
  }
  return "Unable to create the user. Check the Edge Function deployment and try again.";
}

export function useProfiles(enabled: boolean) {
  const query = useQuery({
    queryKey: PROFILES_KEY,
    enabled: enabled && isSupabaseConfigured,
    queryFn: async (): Promise<WorkspaceUser[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      return ((data ?? []) as ProfileRow[]).map(mapProfileRow);
    },
  });

  return {
    users: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
  permissions: ModuleKey[];
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);

      const { data, error } = await supabase.functions.invoke(
        "admin-create-user",
        {
          body: {
            full_name: input.fullName,
            email: input.email,
            password: input.password,
            permissions: input.permissions,
          },
        },
      );

      if (error) throw new Error(await readFunctionError(error));

      const payload = data as { error?: string; userId?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      return payload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}
