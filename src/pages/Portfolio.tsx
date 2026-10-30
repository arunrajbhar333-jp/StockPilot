import { Fragment, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useChatStore } from "@/store/use-chat-store";
import { toast } from "sonner";
import { AddStockDialog } from "@/components/add-stock-dialog";
import { PageHeader } from "@/components/page-header";
import { VerdictBadge, isSellVerdict } from "@/components/signals";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolio } from "@/hooks/use-market-data";
import { useDeleteHolding } from "@/hooks/use-portfolio-actions";
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

function DeleteHoldingButton({
  stock,
  onClick,
}: {
  stock: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={`Delete ${stock}`}
      title={`Delete ${stock}`}
      className="size-7 shrink-0 rounded-md text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-negative/15 hover:text-negative"
    >
      <Trash2 className="size-3.5 shrink-0 text-red-500" strokeWidth={1.5} />
    </Button>
  );
}

/**
 * Portfolio-wide status line. Red the moment anything is a SELL or flagged
 * urgent, green only when every position is HOLD or better.
 */
function AlertBanner({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return null;

  const flagged = positions.find(
    (position) => isSellVerdict(position.aiVerdict) || position.urgent,
  );

  if (flagged) {
    const reason =
      flagged.reason.trim() ||
      "AI analysis ke hisaab se position abhi weak hai — exit consider karo.";
    return (
      <div
        role="alert"
        className="rounded-xl border border-negative/45 bg-negative/[0.10] px-4 py-3"
      >
        <p className="text-[12px] leading-relaxed font-semibold text-negative">
          ⚠️ ALERT: Sell {flagged.stock} today!
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-foreground">
          Reason: {reason}
        </p>
      </div>
    );
  }

  const timeline =
    positions.find(
      (position) => position.action === "HOLD" && position.timeline,
    )?.timeline ??
    positions.find((position) => position.timeline)?.timeline ??
    "3-6 Months";

  return (
    <div
      role="status"
      className="rounded-xl border border-signal/45 bg-signal/[0.08] px-4 py-3"
    >
      <p className="text-[12px] leading-relaxed font-semibold text-signal">
        ✅ All clear. Hold your positions.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-foreground">
        Timeline: {timeline}
      </p>
    </div>
  );
}

function ExpandButton({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-expanded={expanded}
      className="group h-6 gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground transition-all duration-200 hover:text-foreground"
    >
      {expanded ? (
        <ChevronUp
          className="size-3 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
          strokeWidth={1.5}
        />
      ) : (
        <ChevronDown
          className="size-3 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
          strokeWidth={1.5}
        />
      )}
      {expanded ? "Close" : "Expand"}
    </Button>
  );
}

/** The six pillars as a clean grid: fundamentals, India macro, crude, global,
 *  news and the final verdict, in the order the analyst produced them. */
function BreakdownGrid({ position }: { position: Position }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow text-[9px] text-muted-foreground/70">
          Deep analysis · {position.stock}
        </p>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-baseline gap-1 text-[10px] text-foreground">
            <span className="font-semibold">{position.aiVerdict}</span>
            {position.timeline ? (
              <span className="text-muted-foreground">
                ({position.timeline})
              </span>
            ) : null}
          </span>
          <span className="num text-[10px] text-muted-foreground">
            {position.confidence}% confidence
          </span>
        </div>
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {position.breakdown.map((pillar) => (
          <div
            key={pillar.label}
            className="rounded-lg border border-white/[0.07] bg-black/25 p-2.5"
          >
            <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {pillar.label}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground">
              {pillar.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/70">
        {position.reason}
      </p>
    </div>
  );
}

export default function Portfolio() {
  const { user } = useSession();
  const { holdings, isLoading, error, refetch } = usePortfolio(
    user?.id ?? null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Position | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const deleteHolding = useDeleteHolding();
  const { openChat } = useChatStore();
  const positions = useMemo(() => buildPositions(holdings), [holdings]);

  const totals = useMemo(() => {
    const invested = positions.reduce((sum, p) => sum + p.invested, 0);
    const current = positions.reduce((sum, p) => sum + p.current, 0);
    const pnl = current - invested;
    const verdicts = {
      BUY: positions.filter(
        (p) => p.aiVerdict === "BUY" || p.aiVerdict === "STRONG BUY",
      ).length,
      HOLD: positions.filter((p) => p.aiVerdict === "HOLD").length,
      SELL: positions.filter(
        (p) => p.aiVerdict === "SELL" || p.aiVerdict === "STRONG SELL",
      ).length,
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

  const placeholderCount = positions.filter(
    (position) => position.aiSource === "placeholder",
  ).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Holdings · ${positions.length} position${positions.length === 1 ? "" : "s"}`}
        title="My portfolio"
        description="Each position carries a graded AI verdict and the reasoning behind it. Add a holding to have it rated from strong buy to strong sell."
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
              <Sparkles
                className="size-3 shrink-0 text-amber-500"
                strokeWidth={1.5}
              />
              AI review · latest close
            </span>
            <Button
              onClick={() => setAddOpen(true)}
              size="sm"
              className="primary-glow-sm h-9 gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-3.5" />
              Add stock
            </Button>
          </>
        }
      />

      <AlertBanner positions={positions} />

      {placeholderCount > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/[0.08] px-3.5 py-2.5"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-gold" />
          <p className="text-[11px] leading-relaxed text-foreground">
            <span className="font-semibold">Placeholder analysis.</span>{" "}
            {placeholderCount} of {positions.length} verdict
            {placeholderCount === 1 ? " was" : "s were"} generated without
            Gemini, so {placeholderCount === 1 ? "it is" : "they are"} not{" "}
            {placeholderCount === 1 ? "a real AI call" : "real AI calls"}.
            Connect{" "}
            <span className="font-mono text-[10px]">GEMINI_API_KEY</span> to the{" "}
            <span className="font-mono text-[10px]">analyze-holding</span>{" "}
            function to get live verdicts.
          </p>
        </div>
      ) : null}

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
            {totals.pnl >= 0 ? "+" : "−"}₹{money.format(Math.abs(totals.pnl))}
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
                <Sparkles
                  className="size-3.5 shrink-0 text-amber-500"
                  strokeWidth={1.5}
                />
              </span>
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  AI portfolio review
                </p>
                <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                  {positions.length} position{positions.length === 1 ? "" : "s"}{" "}
                  reviewed: {totals.verdicts.BUY} rated buy,{" "}
                  {totals.verdicts.HOLD} hold and {totals.verdicts.SELL} sell.{" "}
                  {best.stock} leads the book at{" "}
                  <span
                    className={cn(
                      "num",
                      best.pnlPct >= 0 ? "text-signal" : "text-negative",
                    )}
                  >
                    {best.pnlPct >= 0 ? "+" : "−"}
                    {Math.abs(best.pnlPct).toFixed(1)}%
                  </span>
                  . Verdicts weigh price action, fundamentals and sector
                  momentum; treat them as research input, not advice.
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
            No holdings yet. Use{" "}
            <span className="text-foreground">Add stock</span> to record your
            first position and get an AI verdict.
          </p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    {[
                      "Stock",
                      "Qty",
                      "Avg cost",
                      "LTP",
                      "P&L",
                      "AI verdict",
                    ].map((heading) => (
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
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((position) => (
                    <Fragment key={position.id}>
                      <TableRow
                        className={cn(
                          "border-white/[0.05] hover:bg-white/[0.03]",
                          isSellVerdict(position.aiVerdict) &&
                            "bg-negative/[0.05] hover:bg-negative/[0.08]",
                        )}
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
                          <PnlText
                            pnl={position.pnl}
                            pnlPct={position.pnlPct}
                          />
                        </TableCell>
                        <TableCell className="max-w-[360px] pr-5">
                          <div className="flex flex-wrap items-start gap-2">
                            <span className="inline-flex items-baseline gap-1">
                              <VerdictBadge verdict={position.aiVerdict} />
                              {position.timeline ? (
                                <span className="text-[10px] text-muted-foreground">
                                  ({position.timeline})
                                </span>
                              ) : null}
                            </span>
                            {position.breakdown.length > 0 ? (
                              <ExpandButton
                                expanded={expandedId === position.id}
                                onClick={() =>
                                  setExpandedId(
                                    expandedId === position.id
                                      ? null
                                      : position.id,
                                  )
                                }
                              />
                            ) : null}
                            <DeleteHoldingButton
                              stock={position.stock}
                              onClick={() => setPendingDelete(position)}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                openChat(
                                  `Analyze ${position.stock} (${position.symbol}). Should I buy/hold/sell this? Give me the final verdict.`,
                                )
                              }
                              className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                              title="Ask AI about this stock"
                            >
                              <Bot className="w-4 h-4" />
                            </button>
                            {position.aiSource === "placeholder" ? (
                              <span className="inline-flex items-center gap-1 rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-gold uppercase">
                                <TriangleAlert className="size-2.5" />
                                Placeholder
                              </span>
                            ) : null}
                            <p className="text-[10px] leading-relaxed text-muted-foreground">
                              {position.reason}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedId === position.id ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={6}
                            className="bg-black/20 px-4 py-4 sm:px-5"
                          >
                            <BreakdownGrid position={position} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile-first position cards */}
            <div className="divide-y divide-white/[0.05] md:hidden">
              {positions.map((position) => {
                const positive = position.pnl >= 0;
                return (
                  <div
                    key={position.id}
                    className={cn(
                      "p-4",
                      isSellVerdict(position.aiVerdict) && "bg-negative/[0.05]",
                    )}
                  >
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
                      </div>                        <div className="flex shrink-0 items-center gap-1.5">
                        <span className="inline-flex items-baseline gap-1">
                          <VerdictBadge verdict={position.aiVerdict} />
                          {position.timeline ? (
                            <span className="text-[9px] text-muted-foreground">
                              ({position.timeline})
                            </span>
                          ) : null}
                        </span>
                        <DeleteHoldingButton
                          stock={position.stock}
                          onClick={() => setPendingDelete(position)}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            openChat(
                              `Analyze ${position.stock} (${position.symbol}). Should I buy/hold/sell this? Give me the final verdict.`,
                            )
                          }
                          className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          title="Ask AI about this stock"
                        >
                          <Bot className="w-4 h-4" />
                        </button>
                      </div>
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
                      {position.aiSource === "placeholder" ? (
                        <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold tracking-wide text-gold uppercase">
                          <TriangleAlert className="size-2.5" />
                          Placeholder AI call
                        </span>
                      ) : null}
                      {position.reason}
                    </p>

                    {position.breakdown.length > 0 ? (
                      <>
                        <button
                          type="button"
                          aria-expanded={expandedId === position.id}
                          onClick={() =>
                            setExpandedId(
                              expandedId === position.id ? null : position.id,
                            )
                          }
                          className="group mt-2.5 inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-all duration-200 hover:text-foreground"
                        >
                          {expandedId === position.id ? (
                            <ChevronUp
                              className="size-3 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
                              strokeWidth={1.5}
                            />
                          ) : (
                            <ChevronDown
                              className="size-3 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
                              strokeWidth={1.5}
                            />
                          )}
                          {expandedId === position.id
                            ? "Close analysis"
                            : "Expand analysis"}
                        </button>
                        {expandedId === position.id ? (
                          <div className="mt-3">
                            <BreakdownGrid position={position} />
                          </div>
                        ) : null}
                      </>
                    ) : null}
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

      <AddStockDialog open={addOpen} onOpenChange={setAddOpen} />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteHolding.isPending) {
            setPendingDelete(null);
            deleteHolding.reset();
          }
        }}
      >
        <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 font-display text-base">
              <Trash2 className="size-4 text-negative" />
              Delete {pendingDelete?.stock ?? "holding"}?
            </DialogTitle>
            <DialogDescription className="mt-1 text-[11px] leading-relaxed">
              {pendingDelete
                ? `${pendingDelete.quantity} share${
                    pendingDelete.quantity === 1 ? "" : "s"
                  } at ₹${pendingDelete.avgPrice.toLocaleString(
                    "en-IN",
                  )}, its stored AI verdict and the reasoning will be removed from your portfolio in Supabase. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            {pendingDelete ? (
              <div className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2.5">
                <p className="text-[9px] tracking-wide text-muted-foreground uppercase">
                  Being removed
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <VerdictBadge verdict={pendingDelete.aiVerdict} />
                  <p className="text-[12px] text-foreground">
                    {pendingDelete.stock}
                  </p>
                  <p className="num ml-auto text-[11px] text-muted-foreground">
                    {pendingDelete.symbol}
                  </p>
                </div>
              </div>
            ) : null}

            {deleteHolding.isError ? (
              <p className="rounded-lg border border-negative/25 bg-negative/10 px-3 py-2 text-[10px] leading-relaxed text-negative">
                {deleteHolding.error.message}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleteHolding.isPending}
              onClick={() => {
                setPendingDelete(null);
                deleteHolding.reset();
              }}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deleteHolding.isPending || !user}
              onClick={() => {
                if (!pendingDelete || !user) return;
                const stock = pendingDelete.stock;
                deleteHolding.mutate(
                  { holdingId: pendingDelete.id, userId: user.id },
                  {
                    onSuccess: () => {
                      toast.success(`${stock} removed from your portfolio`, {
                        description:
                          "The row and its AI verdict were deleted from Supabase.",
                      });
                      setPendingDelete(null);
                      deleteHolding.reset();
                    },
                  },
                );
              }}
              className="bg-negative text-white hover:bg-negative/90"
            >
              {deleteHolding.isPending ? "Deleting…" : "Delete stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
