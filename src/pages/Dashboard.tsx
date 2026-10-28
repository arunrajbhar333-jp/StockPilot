import { useId } from "react";
import { Link } from "react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Minus,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Sparkline } from "@/components/sparkline";
import { ChangePill, VerdictBadge } from "@/components/signals";
import { IpoTable } from "@/components/ipo-table";
import { Button } from "@/components/ui/button";
import {
  deskNotes,
  indices,
  ipos,
  marketMood,
  sips,
  type MarketIndex,
  type MarketMood,
} from "@/data/mockData";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

function IndexCard({ index }: { index: MarketIndex }) {
  const positive = index.changePct >= 0;

  return (
    <div className="glass lift group relative overflow-hidden rounded-2xl p-4 sm:p-5">
      <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-primary/[0.05] blur-2xl" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-foreground">
            {index.symbol}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {index.name}
          </p>
        </div>
        <ChangePill changePct={index.changePct} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="num text-[22px] leading-none font-medium text-foreground sm:text-2xl">
            {index.value.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p
            className={cn(
              "num mt-1.5 text-[11px]",
              positive ? "text-signal" : "text-negative",
            )}
          >
            {positive ? "+" : "−"}
            {Math.abs(index.change).toFixed(2)} today
          </p>
        </div>
        <Sparkline
          data={index.spark}
          positive={positive}
          className="h-9 w-20 sm:h-10 sm:w-24"
        />
      </div>

      <div className="mt-3.5 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[10px] text-muted-foreground">
        <span>
          Low{" "}
          <span className="num text-foreground/80">
            {index.dayLow.toLocaleString("en-IN")}
          </span>
        </span>
        <span>
          High{" "}
          <span className="num text-foreground/80">
            {index.dayHigh.toLocaleString("en-IN")}
          </span>
        </span>
      </div>
    </div>
  );
}

function MoodRing({ score }: { score: number }) {
  const uid = useId().replace(/:/g, "");
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative grid size-[132px] shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90">
        <defs>
          <linearGradient id={`mood-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#63E2A6" />
            <stop offset="55%" stopColor="#E3B34B" />
            <stop offset="100%" stopColor="#F8E0A0" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="7"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={`url(#mood-${uid})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
        />
      </svg>
      <div className="text-center">
        <p className="num text-[30px] leading-none font-semibold text-foreground">
          {score}
        </p>
        <p className="mt-1 text-[8px] tracking-[0.18em] text-muted-foreground uppercase">
          mood score
        </p>
      </div>
    </div>
  );
}

function MoodDriverIcon({
  direction,
}: {
  direction: MarketMood["drivers"][number]["direction"];
}) {
  if (direction === "up") {
    return <ArrowUpRight className="size-3 text-signal" />;
  }
  if (direction === "down") {
    return <ArrowDownRight className="size-3 text-negative" />;
  }
  return <Minus className="size-3 text-muted-foreground" />;
}

export default function Dashboard() {
  const { user, canAccess } = useSession();
  const firstName = user?.name.split(" ")[0] ?? "Investor";

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="NSE · BSE · Market intelligence"
        title={`${greeting}, ${firstName}`}
        description={`${dateLabel} · The desk reads a ${marketMood.sentiment.toLowerCase()} tape at ${marketMood.confidence}% model confidence.`}
        actions={
          <>
            <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground sm:inline-flex">
              <span className="size-1.5 rounded-full bg-primary" />
              Phase 1 · Simulated data
            </span>
            <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground lg:inline-flex">
              <Sparkles className="size-3 text-ai" />
              Synced 12 minutes ago
            </span>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg border-white/[0.08] bg-white/[0.03] text-[11px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              <Link to="/catalog">
                <Search className="size-3.5" />
                Browse catalog
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {indices.map((index) => (
          <IndexCard key={index.id} index={index} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="glass lift relative overflow-hidden rounded-2xl p-4 sm:p-5 xl:col-span-2">
          <div className="pointer-events-none absolute -top-24 -left-16 size-56 rounded-full bg-primary/[0.08] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-6 place-items-center rounded-md border border-ai/25 bg-ai/10">
                  <Sparkles className="size-3 text-ai" />
                </span>
                AI market mood
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Flows, breadth and volatility fused into a single reading.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] text-muted-foreground">
              Gemini · {marketMood.updated}
            </span>
          </div>

          <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
            <MoodRing score={marketMood.score} />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="font-display text-2xl font-semibold text-foreground">
                  {marketMood.sentiment}
                </p>
                <span className="rounded border border-signal/25 bg-signal/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-signal uppercase">
                  Risk-on
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                {marketMood.headline}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {marketMood.drivers.map((driver) => (
                  <div
                    key={driver.label}
                    className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2"
                  >
                    <p className="text-[9px] tracking-wide text-muted-foreground">
                      {driver.label}
                    </p>
                    <p className="num mt-1 flex items-center gap-1 text-[11px] text-foreground">
                      {driver.value}
                      <MoodDriverIcon direction={driver.direction} />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-white/[0.06] pt-3.5">
            <p className="text-[10px] whitespace-nowrap text-muted-foreground">
              Model confidence
            </p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-ai via-primary to-signal"
                style={{ width: `${marketMood.confidence}%` }}
              />
            </div>
            <p className="num text-[10px] text-foreground">
              {marketMood.confidence}%
            </p>
          </div>
        </div>

        <div className="glass lift rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Desk briefing</h2>
            <span className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
              AI notes
            </span>
          </div>

          <div className="mt-3 divide-y divide-white/[0.06]">
            {deskNotes.map((note) => (
              <div key={note.id} className="py-3 first:pt-1 last:pb-1">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] tracking-wide text-muted-foreground">
                    {note.tag}
                  </span>
                  <p className="text-[11px] font-medium text-foreground">
                    {note.title}
                  </p>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {note.body}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-3 text-[9px] text-muted-foreground/70">
            <Sparkles className="size-2.5 text-ai" />
            Generated by Gemini · refreshed 12 min ago
          </p>
        </div>
      </section>

      {canAccess("ipo") && (
        <section className="glass relative overflow-hidden rounded-2xl">
          <div className="flex flex-col gap-2.5 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Live IPO tracker</h2>
                <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                  {ipos.length} issues
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                GMP, subscription and AI scores refresh every fifteen minutes.
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="w-fit gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Link to="/ipo">
                View all issues
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          <div className="pb-1">
            <IpoTable data={ipos.slice(0, 4)} />
          </div>

          <div className="flex flex-col gap-1 border-t border-white/[0.06] px-4 py-2.5 text-[9px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p>
              Verdicts are generated by Gemini and are not a subscription
              recommendation.
            </p>
            <p className="num">Scraper run · 28 October 2026 · 15:18 IST</p>
          </div>
        </section>
      )}

      {canAccess("sip") && (
        <section>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Smart SIP</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Three funds the desk would accumulate at current valuations.
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="w-fit gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Link to="/sip">
                Open SIP lab
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sips.slice(0, 3).map((fund) => (
              <div
                key={fund.id}
                className="glass lift rounded-2xl p-4 sm:p-[18px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                      {fund.category}
                    </p>
                    <p className="mt-1 truncate text-[13px] font-medium text-foreground">
                      {fund.fund}
                    </p>
                  </div>
                  <VerdictBadge verdict={fund.aiVerdict} />
                </div>

                <div className="mt-4 flex items-end justify-between gap-2">
                  <div>
                    <p className="num text-[24px] leading-none font-medium text-foreground">
                      {fund.cagr}
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      5-year CAGR · 3-year {fund.threeYear}
                    </p>
                  </div>
                  <Sparkline
                    data={fund.spark}
                    positive={fund.aiVerdict === "START"}
                    className="h-8 w-16"
                  />
                </div>

                <p className="mt-3 line-clamp-2 min-h-[32px] text-[11px] leading-relaxed text-muted-foreground">
                  {fund.reason}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    Minimum SIP{" "}
                    <span className="num text-foreground/80">
                      ₹{fund.minSip.toLocaleString("en-IN")}
                    </span>
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      toast.success(`SIP draft prepared for ${fund.fund}`, {
                        description:
                          "Phase 1 simulation. No mandate was registered with the asset manager.",
                      })
                    }
                    className="h-7 gap-1 px-2 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
                  >
                    {fund.aiVerdict === "START" ? "Start SIP" : "Review"}
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
