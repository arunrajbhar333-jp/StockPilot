import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLockup } from "@/components/brand";
import { Sparkline } from "@/components/sparkline";
import { ChangePill } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { indices, loginSpotlight, marketMood } from "@/data/referenceData";
import { isSupabaseConfigured, SUPABASE_SETUP_MESSAGE } from "@/lib/supabase";
import { useSession } from "@/lib/session";

function safeReturnTo(value: string | null): string {
  if (
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    value !== "/" &&
    !value.startsWith("/auth")
  ) {
    return value;
  }
  return "/dashboard";
}

const features = [
  {
    icon: BrainCircuit,
    title: "IPO underwriting",
    copy: "Each issue is scored one to ten before the book closes.",
  },
  {
    icon: Target,
    title: "Portfolio verdicts",
    copy: "A buy, hold or sell call per holding, with the reasoning attached.",
  },
  {
    icon: TrendingUp,
    title: "SIP research",
    copy: "Fund shortlists tested across a decade of market cycles.",
  },
];

export default function Login() {
  const { user, login } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const target = safeReturnTo(searchParams.get("returnTo"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      navigate(target, { replace: true });
    }
  }, [user, navigate, target]);

  const signIn = async (nextEmail: string, nextPassword: string) => {
    setPending(true);
    setError(null);
    const result = await login(nextEmail, nextPassword);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    toast.success("Welcome back to StockPilot");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void signIn(email, password);
  };

  const topIpo = loginSpotlight;

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_15%_-10%,oklch(0.836_0.137_84/0.16),transparent_60%),radial-gradient(55%_45%_at_92%_8%,oklch(0.72_0.145_292/0.14),transparent_62%)]" />
      <div className="grid-fade pointer-events-none absolute inset-0 -z-10 opacity-60" />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1240px] items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-16">
        {/* Brand narrative */}
        <section className="min-w-0">
          <BrandLockup />

          <div className="mt-8 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Internal access · Supabase secured
              </span>
            </span>
          </div>

          <h1 className="mt-5 font-display text-[34px] leading-[1.06] font-semibold tracking-tight sm:text-5xl lg:text-[56px]">
            Every market signal.
            <br />
            <span className="text-gold-gradient">One clear verdict.</span>
          </h1>

          <p className="mt-5 max-w-[30rem] text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            StockPilot is our internal research desk for Indian equities and
            initial public offerings. Gemini scores every issue and holding, so
            the team spends its time on decisions rather than data collection.
          </p>

          <div className="mt-8 hidden gap-3 lg:grid lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
                >
                  <span className="grid size-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                    <Icon className="size-4 text-primary" />
                  </span>
                  <p className="mt-3 text-[11px] font-semibold text-foreground">
                    {feature.title}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {feature.copy}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="glass lift mt-6 hidden rounded-2xl p-3 sm:block lg:mt-8">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="eyebrow flex items-center gap-1.5 text-[8px] text-muted-foreground">
                <Sparkles className="size-3 text-ai" />
                Desk snapshot
              </p>
              <p className="num text-[9px] text-muted-foreground/60">
                As of 28 October 2026 · 15:30 IST
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {indices.slice(0, 2).map((index) => (
                <div
                  key={index.id}
                  className="rounded-xl border border-white/[0.06] bg-black/25 p-2.5"
                >
                  <p className="text-[9px] font-medium tracking-wide text-muted-foreground">
                    {index.symbol}
                  </p>
                  <p className="num mt-1 text-[13px] font-medium text-foreground">
                    {index.value.toLocaleString("en-IN")}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <ChangePill changePct={index.changePct} />
                    <Sparkline
                      data={index.spark}
                      positive={index.changePct >= 0}
                      className="h-5 w-10"
                      strokeWidth={1.6}
                    />
                  </div>
                </div>
              ))}
              <div className="rounded-xl border border-primary/15 bg-[linear-gradient(150deg,oklch(0.836_0.137_84/0.14),oklch(1_0_0/0.01))] p-2.5">
                <p className="text-[9px] font-medium tracking-wide text-muted-foreground">
                  AI MARKET MOOD
                </p>
                <p className="mt-1 font-display text-[13px] font-semibold text-primary">
                  {marketMood.sentiment} · {marketMood.score}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-signal to-primary"
                    style={{ width: `${marketMood.score}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[9px] text-muted-foreground">
                  Top issue · {topIpo.company} · {topIpo.aiScore.toFixed(1)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 hidden items-center gap-6 sm:flex">
            {[
              { value: "3,842", label: "issues scored" },
              { value: "72%", label: "verdict hit rate" },
              { value: "1.4M", label: "data points daily" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="num text-lg font-medium text-foreground">
                  {stat.value}
                </p>
                <p className="text-[10px] tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Login */}
        <section className="relative min-w-0">
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_50%_40%,oklch(0.836_0.137_84/0.16),transparent_70%)] blur-2xl" />
          <div className="glass-deep rounded-3xl p-5 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tight sm:text-[22px]">
                  Sign in to StockPilot
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  This workspace is restricted to approved team members. Your
                  role determines which modules load.
                </p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10">
                <Lock className="size-4 text-primary" />
              </span>
            </div>

            {!isSupabaseConfigured ? (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-gold/25 bg-gold/10 px-3 py-2.5"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold" />
                <p className="text-[11px] leading-relaxed text-gold">
                  {SUPABASE_SETUP_MESSAGE}
                </p>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-[11px] font-medium tracking-wide text-muted-foreground"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@stockpilot.io"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={pending}
                    required
                    className="h-11 border-white/10 bg-black/30 pl-9 text-[13px] placeholder:text-muted-foreground/50 focus-visible:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-[11px] font-medium tracking-wide text-muted-foreground"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={pending}
                    required
                    className="h-11 border-white/10 bg-black/30 pr-10 pl-9 text-[13px] placeholder:text-muted-foreground/50 focus-visible:border-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-negative/25 bg-negative/10 px-3 py-2.5"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-negative" />
                  <p className="text-[11px] leading-relaxed text-negative">
                    {error}
                  </p>
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={pending}
                className="h-11 w-full gap-2 rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground shadow-[0_18px_40px_-18px_oklch(0.836_0.137_84/0.8),inset_0_1px_0_rgba(255,255,255,0.35)] transition-all hover:bg-primary/90"
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verifying access
                  </>
                ) : (
                  <>
                    Enter workspace
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-5 flex items-start gap-1.5 border-t border-white/[0.07] pt-4 text-[10px] leading-relaxed text-muted-foreground/70">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-signal" />
              Accounts are provisioned by a workspace administrator. Allowlist
              and module access are enforced by Supabase.
            </p>
          </div>

          <p className="mt-4 text-center text-[10px] text-muted-foreground/50">
            Supabase authentication · Realtime data · Role-based access
          </p>
        </section>
      </div>

      <footer className="relative mx-auto flex w-full max-w-[1240px] flex-col gap-1 border-t border-white/[0.05] px-5 py-4 text-[10px] text-muted-foreground/50 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>© 2026 StockPilot · Internal use only · Not investment advice.</p>
        <p className="num">React · Supabase · Gemini · Telegram integration planned</p>
      </footer>
    </main>
  );
}
