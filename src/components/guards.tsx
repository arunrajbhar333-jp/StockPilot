import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import type { ModuleKey } from "@/types/domain";
import { useSession } from "@/lib/session";

/** Sends signed-out visitors to the login screen, preserving the intended path. */
export function RequireSession() {
  const { user, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}

/** Blocks a module the signed-in user has not been granted. */
export function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey;
  children: ReactNode;
}) {
  const { canAccess } = useSession();

  if (!canAccess(module)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/** Admin-only route guard. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
