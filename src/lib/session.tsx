import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isSupabaseConfigured,
  SUPABASE_SETUP_MESSAGE,
  supabase,
} from "@/lib/supabase";
import { mapProfileRow, type ProfileRow } from "@/lib/mappers";
import type { ModuleKey, WorkspaceUser } from "@/types/domain";

type LoginResult = { ok: true } | { ok: false; error: string };

interface SessionValue {
  user: WorkspaceUser | null;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  canAccess: (module: ModuleKey) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

function humanizeAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts. Try again in a moment.";
  }
  return message;
}

async function loadProfile(
  userId: string,
): Promise<{ ok: true; user: WorkspaceUser } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: SUPABASE_SETUP_MESSAGE };

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: `Your profile could not be loaded: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      error:
        "No profile is linked to this account. Ask an administrator to provision access.",
    };
  }

  const user = mapProfileRow(data as ProfileRow);
  if (user.status === "suspended") {
    return {
      ok: false,
      error: "This account is suspended. Contact a workspace administrator.",
    };
  }

  return { ok: true, user };
}

/** Supabase email/password session with the profile row attached. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let active = true;
    const syncProfile = async (userId: string) => {
      const result = await loadProfile(userId);
      if (!active) return;

      if (!result.ok) {
        setUser(null);
        await supabase?.auth.signOut();
      } else {
        setUser(result.user);
      }
      setIsLoading(false);
    };

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (!data.session?.user) {
          setIsLoading(false);
          return;
        }
        await syncProfile(data.session.user.id);
      } catch (error) {
        console.error("[session] initialisation failed:", error);
        if (active) setIsLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;

      if (!session?.user) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Defer client calls out of the auth callback to avoid blocking it.
      window.setTimeout(() => {
        if (active) void syncProfile(session.user.id);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      if (!supabase) {
        return { ok: false, error: SUPABASE_SETUP_MESSAGE };
      }

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          return { ok: false, error: humanizeAuthError(error.message) };
        }
        if (!data.user) {
          return {
            ok: false,
            error: "Sign-in succeeded but no user was returned. Try again.",
          };
        }

        const result = await loadProfile(data.user.id);
        if (!result.ok) {
          await supabase.auth.signOut();
          return { ok: false, error: result.error };
        }

        setUser(result.user);
        setIsLoading(false);
        void supabase
          .rpc("touch_last_active")
          .then(({ error: touchError }) => {
            if (touchError) {
              console.warn(
                "[session] last_active update skipped:",
                touchError.message,
              );
            }
          });
        return { ok: true };
      } catch (error) {
        console.error("[session] sign-in failed:", error);
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to reach Supabase. Check your connection and try again.",
        };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("[session] sign-out failed:", error);
    } finally {
      setUser(null);
    }
  }, []);

  const canAccess = useCallback(
    (module: ModuleKey) => {
      if (!user) return false;
      return user.role === "admin" || user.permissions.includes(module);
    },
    [user],
  );

  const value = useMemo<SessionValue>(
    () => ({
      user,
      isAdmin: user?.role === "admin",
      isLoading,
      login,
      logout,
      canAccess,
    }),
    [user, isLoading, login, logout, canAccess],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return context;
}
