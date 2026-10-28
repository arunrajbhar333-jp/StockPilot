import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  demoPasswords,
  users as mockUsers,
  type ModuleKey,
  type User,
} from "@/data/mockData";

const STORAGE_KEY = "aurum.session.userId";

type LoginResult = { ok: true } | { ok: false; error: string };

interface SessionValue {
  user: User | null;
  isAdmin: boolean;
  login: (email: string, password: string) => LoginResult;
  logout: () => void;
  canAccess: (module: ModuleKey) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

function readStoredUser(): User | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return mockUsers.find((candidate) => candidate.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Phase 1 auth: an allowlist check against the mock user table, persisted in
 * localStorage. Replaced by Supabase email + password auth in Phase 2.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser());

  const login = useCallback((email: string, password: string): LoginResult => {
    const normalized = email.trim().toLowerCase();
    const account = mockUsers.find(
      (candidate) => candidate.email.toLowerCase() === normalized,
    );

    if (!account) {
      return {
        ok: false,
        error: "That email is not on the allowlist. Ask an admin for access.",
      };
    }
    if (account.status === "suspended") {
      return {
        ok: false,
        error: "This account is suspended. Contact your workspace admin.",
      };
    }
    if (demoPasswords[account.email] !== password) {
      return { ok: false, error: "Incorrect password for this account." };
    }

    setUser(account);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(account.id));
    } catch {
      /* storage unavailable — session stays in memory */
    }
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
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
      login,
      logout,
      canAccess,
    }),
    [user, login, logout, canAccess],
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
