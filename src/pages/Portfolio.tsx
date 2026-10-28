import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { VerdictBadge } from "@/components/signals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolio } from "@/hooks/use-market-data";
import { initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Holding } from "@/types/domain";
import { cn } from "@/lib/utils";

interface Position extends Holding {
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number;
}

const money = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

function buildPositions(holdings: Holding[]): Position[] {
  return holdings.map((holding) => {
    const invested = holding.quantity * holding.avgPrice;
    const current = holding.quantity * holding.ltp;
    const pnl = current - invested;
    return {
      ...holding,
      invested,
      current,
      pnl,
      pnlPct: (pnl / invested) * 100,
    };
  });
}

function PnlText({
  pnl,
  pnlPct,
  className,
}: {
  pnl: number;
  pnlPct: number;
  className?: string;
}) {
  const positive = pnl >= 0;
  return (
    <div className={cn("flex flex-col", className)}>
      <span
        className={cn(
          "num text-[12px] font-medium",
          positive ? "text-signal" : "text-negative",
        )}
      >
        {positive ? "+" : "−"}₹{money.format(Math.abs(pnl))}
      </span>
      <span
        className={cn(
          "num mt-0.5 text-[10px]",
          positive ? "text-signal/70" : "text-negative/70",
        )}
      >
        {positive ? "+" : "−"}
        {Math.abs(pnlPct).toFixed(2)}%
      </span>
    </div>
  );
}

export default function Portfolio() {
  const { user } = useSession();
  const {
    holdings,
    isLoading,
    error,
    refetch,
  } = usePortfolio(user?.id ?? null);
  const positions = useMemo(() => buildPositions(holdings), [holdings]);

  const totals = useMemo(() => {
    const invested = positions.reduce((sum, p) => sum + p.invested, 0);
    const current = positions.reduce((sum, p) => sum + p.current, 0);
    const pnl = current - invested;
    const verdicts = {
      BUY: positions.filter((p) => p.aiVerdict === "BUY").length,
      HOLD: positions.filter((p) => p.aiVerdict === "HOLD").length,
      SELL: positions.filter((p) => p.aiVerdict === "SELL").length,
    };
    return {
      invested,
      current,
      pnl,
      pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
      verdicts,
    };
  }, [positions]);

  const best = useMemo(
    () => [...positions].sort((a, b) => b.pnlPct - a.pnlPct)[0],
    [positions],
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Holdings · ${positions.length} position${positions.length === 1 ? "" : "s"}`}
        title="My portfolio"
        description="Each position carries a current AI verdict and the reasoning behind it. Verdicts refresh after the market closes."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
            <Sparkles className="size-3 text-ai" />
            AI review · latest close
          </span>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="glass lift rounded-2xl p-4">
          <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Total invested
          </p>
          <p className="num mt-2.5 text-xl font-medium">
            ₹{money.format(totals.invested)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Across {positions.length} holding{positions.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="glass lift rounded-2xl p-4">
          <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Current value
          </p>
          <p className="num mt-2.5 text-xl font-medium">
            ₹{money.format(totals.current)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Marked to last traded price
          </p>
        </div>
        <div className="glass lift rounded-2xl p-4">
          <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Unrealised P&amp;L
          </p>
          <p
            className={cn(
              "num mt-2.5 text-xl font-medium",
              totals.pnl >= 0 ? "text-signal" : "text-negative",
            )}
          >
            {totals.pnl >= 0 ? "+" : "−"}₹
            {money.format(Math.abs(totals.pnl))}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            <span
              className={cn(
                "num",
                totals.pnl >= 0 ? "text-signal" : "text-negative",
              )}
            >
              {totals.pnl >= 0 ? "+" : "−"}
              {Math.abs(totals.pnlPct).toFixed(2)}%
            </span>{" "}
            on open positions
          </p>
        </div>
        <div className="glass lift rounded-2xl p-4">
          <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            AI conviction
          </p>
          <div className="mt-2.5 flex items-baseline gap-2">
            <p className="num text-xl font-medium">
              {totals.verdicts.BUY}
              <span className="text-sm text-muted-foreground">
                /{positions.length}
              </span>
            </p>
            <span className="text-[10px] text-signal">rated buy</span>
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <span
              className="bg-signal"
              style={{
                width: `${positions.length ? (totals.verdicts.BUY / positions.length) * 100 : 0}%`,
              }}
            />
            <span
              className="bg-gold"
              style={{
                width: `${positions.length ? (totals.verdicts.HOLD / positions.length) * 100 : 0}%`,
              }}
            />
            <span
              className="bg-negative"
              style={{
                width: `${positions.length ? (totals.verdicts.SELL / positions.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </section>

      {best ? (
      <section className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="pointer-events-none absolute -top-20 -right-10 size-48 rounded-full bg-ai/[0.07] blur-3xl" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-ai/25 bg-ai/10">
              <Sparkles className="size-3.5 text-ai" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-foreground">
                AI portfolio review
              </p>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                Financials offer the strongest risk-reward this week.{" "}
                {best.stock} leads the book at{" "}
                <span className="num text-signal">
                  +{best.pnlPct.toFixed(1)}%
                </span>
                , while Tata Motors remains the only sell after JLR margin
                guidance. Hold existing positions and stage any new capital.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-xl border border-white/[0.06] bg-black/25 px-3.5 py-2.5 sm:ml-auto">
            {(
              [
                ["BUY", totals.verdicts.BUY, "text-signal"],
                ["HOLD", totals.verdicts.HOLD, "text-gold"],
                ["SELL", totals.verdicts.SELL, "text-negative"],
              ] as const
            ).map(([label, count, tone]) => (
              <div key={label} className="text-center">
                <p className={cn("num text-sm font-medium", tone)}>{count}</p>
                <p className="text-[9px] tracking-wide text-muted-foreground">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      ) : null}

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Holdings</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Long-term equity at average cost basis
            </p>
          </div>
          <span className="num hidden text-[10px] text-muted-foreground sm:block">
            P&amp;L excludes brokerage and taxes
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
            Loading holdings from Supabase…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-5">
            <p className="text-[11px] text-negative">{error.message}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : positions.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11px] leading-relaxed text-muted-foreground sm:px-5">
            No holdings yet. Positions added to your Supabase account will appear
            here.
          </p>
        ) : (
          <>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                {["Stock", "Qty", "Avg cost", "LTP", "P&L", "AI verdict"].map(
                  (heading) => (
                    <TableHead
                      key={heading}
                      className={cn(
                        "text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase",
                        heading === "Qty" && "text-right",
                        heading === "Avg cost" && "text-right",
                        heading === "LTP" && "text-right",
                        heading === "P&L" && "text-right",
                      )}
                    >
                      {heading}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow
                  key={position.id}
                  className="border-white/[0.05] hover:bg-white/[0.03]"
                >
                  <TableCell className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-muted-foreground">
                        {initials(position.stock)}
                      </span>
                      <div>
                        <p className="text-[12px] font-medium text-foreground">
                          {position.stock}
                        </p>
                        <p className="num text-[10px] text-muted-foreground">
                          {position.symbol} · {position.sector}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="num text-right text-[12px] text-muted-foreground">
                    {position.quantity}
                  </TableCell>
                  <TableCell className="num text-right text-[12px] text-muted-foreground">
                    ₹{position.avgPrice.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="num text-right text-[12px] text-foreground">
                    ₹{position.ltp.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right">
                    <PnlText pnl={position.pnl} pnlPct={position.pnlPct} />
                  </TableCell>
                  <TableCell className="max-w-[300px] pr-5">
                    <div className="flex items-start gap-2">
                      <VerdictBadge verdict={position.aiVerdict} />
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        {position.reason}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile-first position cards */}
        <div className="divide-y divide-white/[0.05] md:hidden">
          {positions.map((position) => {
            const positive = position.pnl >= 0;
            return (
              <div key={position.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-muted-foreground">
                      {initials(position.stock)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {position.stock}
                      </p>
                      <p className="num text-[10px] text-muted-foreground">
                        {position.quantity} sh · avg ₹
                        {position.avgPrice.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                  <VerdictBadge verdict={position.aiVerdict} />
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[9px] tracking-wide text-muted-foreground uppercase">
                      Current value
                    </p>
                    <p className="num mt-0.5 text-[13px] text-foreground">
                      ₹{money.format(position.current)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "num flex items-center justify-end gap-0.5 text-[12px] font-medium",
                        positive ? "text-signal" : "text-negative",
                      )}
                    >
                      {positive ? (
                        <ArrowUpRight className="size-3" />
                      ) : (
                        <ArrowDownRight className="size-3" />
                      )}
                      ₹{money.format(Math.abs(position.pnl))}
                    </p>
                    <p
                      className={cn(
                        "num text-[10px]",
                        positive ? "text-signal/70" : "text-negative/70",
                      )}
                    >
                      {positive ? "+" : "−"}
                      {Math.abs(position.pnlPct).toFixed(2)}%
                    </p>
                  </div>
                </div>

                <p className="mt-2.5 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  {position.reason}
                </p>
              </div>
            );
          })}
        </div>
          </>
        )}

        <div className="border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:px-5">
          AI verdicts combine price action, fundamentals and sector momentum.
          Not investment advice.
        </div>
      </section>
    </div>
  );
}
