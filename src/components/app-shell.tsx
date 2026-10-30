import { useState } from "react";
import {
  Bell,
  ChevronRight,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  PieChart,
  Repeat2,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { BrandLockup, BrandMark } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { notifications } from "@/data/referenceData";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const navItems = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    module: null,
    adminOnly: false,
  },
  {
    to: "/catalog",
    label: "Market Catalog",
    icon: LineChart,
    module: null,
    adminOnly: false,
  },
  {
    to: "/ipo",
    label: "IPO Tracker",
    icon: Rocket,
    module: "ipo",
    adminOnly: false,
  },
  {
    to: "/portfolio",
    label: "My Portfolio",
    icon: PieChart,
    module: "portfolio",
    adminOnly: false,
  },
  {
    to: "/sip",
    label: "Smart SIP",
    icon: Repeat2,
    module: "sip",
    adminOnly: false,
  },
  {
    to: "/admin",
    label: "Admin Panel",
    icon: ShieldCheck,
    module: null,
    adminOnly: true,
  },
] as const;

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/catalog": "Market Catalog",
  "/ipo": "IPO Tracker",
  "/portfolio": "My Portfolio",
  "/sip": "Smart SIP",
  "/admin": "Admin Panel",
};

const toneDots = {
  gold: "bg-primary",
  signal: "bg-signal",
  ai: "bg-ai",
  negative: "bg-negative",
};

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isAdmin, canAccess, logout } = useSession();
  const { theme } = useTheme();
  const light = theme === "light";
  const navigate = useNavigate();

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.module) return canAccess(item.module);
    return true;
  });
  const workspaceItems = visibleItems.filter((item) => !item.adminOnly);
  const controlItems = visibleItems.filter((item) => item.adminOnly);

  const handleSignOut = async () => {
    await logout();
    onNavigate?.();
    toast.success("Signed out of StockPilot");
    navigate("/");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-5 pt-6 pb-2">
        <div className="brand-aurora pointer-events-none absolute inset-x-0 top-0 h-24" />
        <Link to="/dashboard" onClick={onNavigate} className="relative inline-flex">
          <BrandLockup />
        </Link>
      </div>

      <nav className="mt-7 flex-1 overflow-y-auto px-3 pb-4">
        <p className="eyebrow px-3 text-[9px] text-muted-foreground/60">
          Workspace
        </p>
        <div className="mt-2.5 space-y-1">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-all duration-300",
                    isActive
                      ? light
                        ? "border-blue-100 bg-blue-50 font-medium text-blue-700"
                        : "border-primary/20 bg-gradient-to-r from-primary/[0.14] via-primary/[0.05] to-transparent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
                      : light
                        ? "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                        : "border-transparent text-muted-foreground hover:border-white/5 hover:bg-white/[0.04] hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span className="absolute top-1/2 left-0 h-5 w-[2px] -translate-y-1/2 rounded-r bg-primary" />
                    ) : null}
                    <Icon
                      className={cn(
                        "size-[18px] shrink-0 transition-colors",
                        isActive
                          ? "text-primary"
                          : light
                            ? "text-slate-500 group-hover:text-slate-900"
                            : "text-muted-foreground/70 group-hover:text-foreground",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.to === "/ipo" ? (
                      <span className="ml-auto rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        6 live
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        {controlItems.length > 0 && (
          <>
            <p className="eyebrow mt-7 px-3 text-[9px] text-muted-foreground/60">
              Control
            </p>
            <div className="mt-2.5 space-y-1">
              {controlItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-all duration-300",
                        isActive
                          ? light
                            ? "border-blue-100 bg-blue-50 font-medium text-blue-700"
                            : "border-primary/20 bg-gradient-to-r from-primary/[0.14] via-primary/[0.05] to-transparent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
                          : light
                            ? "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                            : "border-transparent text-muted-foreground hover:border-white/5 hover:bg-white/[0.04] hover:text-foreground",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <span className="absolute top-1/2 left-0 h-5 w-[2px] -translate-y-1/2 rounded-r bg-primary" />
                        ) : null}
                        <Icon
                          className={cn(
                            "size-[18px] shrink-0",
                            isActive
                              ? "text-primary"
                              : light
                                ? "text-slate-500 group-hover:text-slate-900"
                                : "text-muted-foreground/70 group-hover:text-foreground",
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        <span
                          className={cn(
                            "ml-auto rounded border px-1 py-0.5 text-[8px] font-semibold tracking-[0.14em] text-muted-foreground",
                            light ? "border-slate-200" : "border-white/10",
                          )}
                        >
                          ADMIN
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </>
        )}

        <div className="engine-tint mt-7 rounded-xl border border-white/[0.07] p-3.5">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-[9px] text-muted-foreground">
              Gemini engine
            </p>
            <Sparkles className="size-3.5 text-ai" />
          </div>
          <p className="mt-2 flex items-center gap-2 text-[11px] font-medium text-foreground">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
            </span>
            Realtime connected
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            IPO, portfolio and SIP sync live
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[86%] rounded-full bg-gradient-to-r from-ai to-primary" />
          </div>
        </div>
      </nav>

      <div className="mt-auto border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 font-display text-[11px] font-semibold text-primary">
            {user ? initials(user.name) : "—"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {user?.name ?? "Guest"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {user?.role === "admin" ? "Administrator" : "Member"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
            className={`ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground ${light ? "hover:bg-slate-100" : "hover:bg-white/5"}`}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MarketStatusPill() {
  const { theme } = useTheme();

  return (
    <div
      className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 sm:flex ${theme === "light" ? "border-slate-200 bg-white text-slate-600 shadow-sm" : "border-white/[0.08] bg-white/[0.03]"}`}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
      </span>
      <span className="text-[11px] font-medium text-foreground">
        NSE Open
      </span>
      <span className="num text-[10px] text-muted-foreground">15:30 IST</span>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className={`grid size-9 place-items-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground ${theme === "light" ? "border-slate-300 bg-white" : "border-white/[0.07] bg-white/[0.03] hover:border-white/15"}`}
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}

function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid size-9 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-muted-foreground transition-colors hover:border-white/15 hover:text-foreground"
        >
          <Bell className="size-4" />
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[320px] border-white/10 bg-popover/95 p-0 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
          <p className="text-xs font-medium">Alerts</p>
          <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
            4 new
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {notifications.map((item) => (
            <div
              key={item.id}
              className="flex gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  toneDots[item.tone],
                )}
              />
              <div className="min-w-0">
                <p className="text-xs leading-snug font-medium text-foreground">
                  {item.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  {item.time}
                </p>
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu() {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await logout();
    toast.success("Signed out of StockPilot");
    navigate("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/10 font-display text-[11px] font-semibold text-primary transition-colors hover:border-primary/50"
        >
          {user ? initials(user.name) : "—"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 border-white/10 bg-popover/95 backdrop-blur-xl"
      >
        <DropdownMenuLabel className="pb-1">
          <p className="text-xs font-medium text-foreground">{user?.name}</p>
          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
            {user?.email}
          </p>
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <span className="inline-flex rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-primary uppercase">
            {user?.role} account
          </span>
        </div>
        <DropdownMenuSeparator className="bg-white/[0.07]" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="gap-2 text-xs text-muted-foreground focus:text-foreground"
        >
          <LogOut className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme } = useTheme();
  const light = theme === "light";
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Workspace";

  return (
    <div className={light ? "relative min-h-dvh bg-slate-50" : "relative min-h-dvh"}>
      <aside
        className={
          light
            ? "fixed inset-y-0 left-0 z-40 hidden w-[272px] border-r border-slate-200 bg-white lg:flex lg:flex-col"
            : "fixed inset-y-0 left-0 z-40 hidden w-[272px] border-r border-white/[0.06] bg-background/85 backdrop-blur-2xl lg:flex lg:flex-col"
        }
      >
        <SidebarContent />
      </aside>

      <div className="lg:pl-[272px]">
        <header
          className={
            light
              ? "sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8"
              : "sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-background/60 px-4 backdrop-blur-xl sm:px-6 lg:px-8"
          }
        >
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className={`grid size-9 place-items-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground lg:hidden ${light ? "border-slate-300 bg-white" : "border-white/[0.08] bg-white/[0.03]"}`}
          >
            <Menu className="size-4" />
          </button>

          <Link to="/dashboard" className="lg:hidden">
            <BrandMark className="size-8" />
          </Link>

          <div className="hidden h-7 w-px bg-white/[0.08] lg:block" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase">
              <span className="hidden sm:inline">StockPilot</span>
              <ChevronRight className="hidden size-3 sm:inline" />
              <span className="text-muted-foreground">{title}</span>
            </div>
            <p className="truncate text-[13px] font-medium text-foreground sm:hidden">
              {title}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <MarketStatusPill />
            <ThemeToggle />
            <NotificationsMenu />
            <AccountMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8">
          <Outlet />
        </main>

        <footer className="mx-auto flex w-full max-w-[1440px] flex-col gap-1.5 border-t border-white/[0.05] px-4 py-5 text-[10px] text-muted-foreground/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            Supabase Auth · Realtime portfolio · Internal use only · Not
            investment advice.
          </p>
          <p className="num">Scraper: idle · Gemini: active · v0.2.0</p>
        </footer>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[284px] gap-0 border-white/[0.07] bg-background p-0 backdrop-blur-2xl sm:max-w-[284px]"
        >
          <SheetTitle className="sr-only">StockPilot navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Workspace and admin navigation
          </SheetDescription>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
