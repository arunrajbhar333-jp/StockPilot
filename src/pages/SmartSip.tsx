import { useMemo, useState } from "react";
import { ArrowUpRight, Calculator, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Sparkline } from "@/components/sparkline";
import { RiskBadge, VerdictBadge } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { sips } from "@/data/mockData";
import { formatInr, formatInrCompact, sipFutureValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const startFunds = sips.filter((fund) => fund.aiVerdict === "START");
const blendCagr =
  startFunds.reduce((total, fund) => total + fund.cagrValue, 0) /
  startFunds.length;

const horizons = [5, 10, 15] as const;

export default function SmartSip() {
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState<number>(10);

  const projection = useMemo(() => {
    const corpus = sipFutureValue(monthly, blendCagr, years);
    const invested = monthly * 12 * years;
    return {
      corpus,
      invested,
      gain: corpus - invested,
      gainPct: ((corpus - invested) / invested) * 100,
    };
  }, [monthly, years]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Systematic investing"
        title="Smart SIP"
        description="Gemini screens the fund universe for cost, drawdown behaviour and rolling returns, then issues a start-or-wait verdict."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
            <Sparkles className="size-3 text-ai" />
            {startFunds.length} of {sips.length} funds cleared to start
          </span>
        }
      />

      <section className="grid gap-3 xl:grid-cols-2">
        {sips.map((fund) => (
          <div
            key={fund.id}
            className="glass lift relative overflow-hidden rounded-2xl p-4 sm:p-5"
          >
            <div className="pointer-events-none absolute -top-20 -right-16 size-44 rounded-full bg-primary/[0.06] blur-3xl" />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  {fund.category}
                </p>
                <h2 className="mt-1 truncate font-display text-[15px] font-semibold text-foreground">
                  {fund.fund}
                </h2>
              </div>
              <VerdictBadge verdict={fund.aiVerdict} />
            </div>

            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <p className="num text-[28px] leading-none font-medium text-foreground">
                  {fund.cagr}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  5-year CAGR · 3-year {fund.threeYear}
                </p>
              </div>
              <Sparkline
                data={fund.spark}
                positive={fund.aiVerdict === "START"}
                className="h-10 w-24"
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-3">
              <div>
                <p className="text-[9px] tracking-wide text-muted-foreground">
                  AUM
                </p>
                <p className="num mt-0.5 text-[11px] text-foreground">
                  {fund.aum}
                </p>
              </div>
              <div>
                <p className="text-[9px] tracking-wide text-muted-foreground">
                  Minimum SIP
                </p>
                <p className="num mt-0.5 text-[11px] text-foreground">
                  ₹{fund.minSip.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-[9px] tracking-wide text-muted-foreground">
                  Risk
                </p>
                <div className="mt-0.5">
                  <RiskBadge risk={fund.risk} />
                </div>
              </div>
            </div>

            <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <TrendingUp className="mt-0.5 size-3 shrink-0 text-primary/70" />
              {fund.reason}
            </p>

            <div className="mt-3.5 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast.success(`SIP draft prepared for ${fund.fund}`, {
                    description:
                      "Phase 1 simulation. No mandate was registered with the asset manager.",
                  })
                }
                className="h-8 flex-1 gap-1 rounded-lg border-primary/25 bg-primary/[0.08] text-[11px] font-medium text-primary hover:bg-primary/15 hover:text-primary sm:flex-none"
              >
                {fund.aiVerdict === "START" ? "Start SIP" : "Set a reminder"}
                <ArrowUpRight className="size-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  toast("Backtest queued", {
                    description: `Running ten-year rolling returns for ${fund.fund} in simulation.`,
                  })
                }
                className="h-8 rounded-lg text-[11px] text-muted-foreground hover:text-foreground"
              >
                Backtest
              </Button>
              <span
                className={cn(
                  "num ml-auto hidden text-[10px] sm:block",
                  fund.aiVerdict === "START" ? "text-signal" : "text-muted-foreground",
                )}
              >
                {fund.aiVerdict === "START" ? "Cleared" : "Stagger entry"}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="glass relative overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute -top-24 left-1/3 size-64 rounded-full bg-primary/[0.07] blur-3xl" />

        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <span className="grid size-6 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04]">
            <Calculator className="size-3 text-primary" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Projection lab</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Model a monthly SIP against the AI-cleared blend.
            </p>
          </div>
          <span className="num ml-auto rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] text-muted-foreground">
            {blendCagr.toFixed(1)}% assumed CAGR
          </span>
        </div>

        <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] tracking-wide text-muted-foreground">
                  Monthly investment
                </p>
                <p className="num mt-1 text-2xl font-medium text-foreground">
                  ₹{monthly.toLocaleString("en-IN")}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                ₹1,000 – ₹50,000
              </p>
            </div>

            <Slider
              value={[monthly]}
              min={1000}
              max={50000}
              step={500}
              onValueChange={(value) => setMonthly(value[0] ?? 1000)}
              className="mt-4"
              aria-label="Monthly SIP amount"
            />

            <div className="mt-5 flex items-center justify-between">
              <p className="text-[10px] tracking-wide text-muted-foreground">
                Horizon
              </p>
              <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-black/25 p-1">
                {horizons.map((horizon) => (
                  <button
                    key={horizon}
                    type="button"
                    onClick={() => setYears(horizon)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                      years === horizon
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {horizon}Y
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-5 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
              <Sparkles className="mt-0.5 size-2.5 shrink-0 text-ai" />
              Blend of {startFunds.map((fund) => fund.fund).join(", ")} at an
              equal weight. Illustrative only.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(150deg,oklch(0.836_0.137_84/0.09),transparent_65%)] p-4 sm:p-5">
            <p className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
              Projected corpus · {years} years
            </p>
            <p className="num mt-2 text-3xl font-medium text-gold-gradient">
              {formatInrCompact(projection.corpus)}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3">
              <div>
                <p className="text-[9px] text-muted-foreground">
                  Total invested
                </p>
                <p className="num mt-0.5 text-[12px] text-foreground">
                  {formatInrCompact(projection.invested)}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">
                  Estimated gains
                </p>
                <p className="num mt-0.5 text-[12px] text-signal">
                  +{formatInrCompact(projection.gain)}
                </p>
              </div>
            </div>

            <div className="mt-3.5">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <span
                  className="rounded-l-full bg-white/20"
                  style={{
                    width: `${(projection.invested / projection.corpus) * 100}%`,
                  }}
                />
                <span
                  className="bg-gradient-to-r from-primary to-signal"
                  style={{ width: `${(1 - projection.invested / projection.corpus) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-white/30" />
                  Invested
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-primary" />
                  Returns · {projection.gainPct.toFixed(0)}%
                </span>
              </div>
            </div>

            <p className="mt-3 border-t border-white/[0.08] pt-2.5 text-[9px] text-muted-foreground/60">
              Assumes a constant {blendCagr.toFixed(1)}% CAGR on {formatInr(monthly)}
              per month for {years} years, with returns reinvested. Mutual fund
              returns are not guaranteed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
