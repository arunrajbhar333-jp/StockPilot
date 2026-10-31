import { useState } from "react";
import { ArrowUpRight, Bot, Loader2, Sparkles } from "lucide-react";
import { useChatStore } from "@/store/use-chat-store";
import { toast } from "sonner";
import { IpoApplyDialog } from "@/components/ipo-apply-dialog";
import { AiScore, IpoTypeBadge, VerdictBadge } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { useReanalyzeIpo } from "@/hooks/use-ipo-actions";
import { getIpoSchedule, useNow, type IpoSchedule } from "@/lib/ipo-schedule";
import { useSession } from "@/lib/session";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Ipo } from "@/types/domain";
import { cn } from "@/lib/utils";

const statusTone: Record<IpoSchedule["tone"], string> = {
  open: "border-signal/40 bg-signal/10 text-signal",
  closing: "border-negative/40 bg-negative/10 text-negative",
  upcoming: "border-border bg-muted/40 text-muted-foreground",
  closed: "border-border bg-muted/20 text-muted-foreground/80",
};

/** Dynamic window badge: opens / open now / closing today / closed. */
function IpoStatusBadge({ schedule }: { schedule: IpoSchedule }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[9px] font-medium whitespace-nowrap",
        statusTone[schedule.tone],
      )}
    >
      {schedule.badge}
    </span>
  );
}

/** Admin-only manual trigger for an issue that is still sitting at 0.0. */
function ReanalyzeButton({ ipo }: { ipo: Ipo }) {
  const reanalyze = useReanalyzeIpo();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={reanalyze.isPending}
      onClick={() =>
        reanalyze.mutate(
          { ipoId: ipo.id },
          {
            onSuccess: (analysis) =>
              toast.success(
                `${ipo.company}: ${analysis.verdict} at ${analysis.aiScore.toFixed(1)}/10`,
                { description: analysis.reasoning },
              ),
            onError: (mutationError) =>
              toast.error(`Could not score ${ipo.company}`, {
                description: mutationError.message,
              }),
          },
        )
      }
      className="group h-6 gap-1 rounded-md px-1.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
    >
      {reanalyze.isPending ? (
        <Loader2 className="size-3 shrink-0 animate-spin" strokeWidth={1.5} />
      ) : (
        <Sparkles
          className="size-3 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
          strokeWidth={1.5}
        />
      )}
      {reanalyze.isPending ? "Scoring…" : "Re-analyze"}
    </Button>
  );
}

export function IpoTable({
  data,
  detailed = false,
}: {
  data: Ipo[];
  detailed?: boolean;
}) {
  const [selected, setSelected] = useState<Ipo | null>(null);
  const { isAdmin } = useSession();
  const { openChat } = useChatStore();
  const now = useNow();

  return (
    <>
      <div className="w-full overflow-x-auto">
        <Table className={detailed ? "min-w-[820px]" : "min-w-[600px]"}>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              <TableHead className="pl-4 text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase sm:pl-5">
                Company
              </TableHead>
              <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                Type
              </TableHead>
              {detailed ? (
                <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                  Price band
                </TableHead>
              ) : null}
              <TableHead className="text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                GMP
              </TableHead>
              {detailed ? (
                <TableHead className="text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                  Subscribed
                </TableHead>
              ) : null}
              <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                AI score
              </TableHead>
              <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                Status
              </TableHead>
              <TableHead className="pr-4 text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase sm:pr-5">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((ipo) => {
              const schedule = getIpoSchedule(ipo, now);

              return (
                <TableRow
                  key={ipo.id}
                  className={cn(
                    "border-white/[0.05] transition-colors hover:bg-white/[0.03]",
                    // 7.0 and up is an APPLY: tint the row and mark its left edge
                    // green so the strongest issues read first at a glance.
                    ipo.aiScore >= 7 &&
                      "bg-signal/[0.05] shadow-[inset_3px_0_0_0_var(--color-signal)] hover:bg-signal/[0.08]",
                  )}
                >
                  <TableCell className="py-3 pl-4 sm:pl-5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-muted-foreground">
                        {ipo.company
                          .split(" ")
                          .map((word) => word[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {ipo.company}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {ipo.sector}
                        </p>
                        {detailed ? (
                          <div className="mt-1 space-y-0.5">
                            <p className="truncate text-[10px] text-muted-foreground/80">
                              Opens:{" "}
                              <span className="num text-foreground/70">
                                {schedule.opens ?? "TBA"}
                              </span>
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground/80">
                              Closes:{" "}
                              <span className="num text-foreground/70">
                                {schedule.closes ?? "TBA"}
                              </span>
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <IpoTypeBadge type={ipo.type} />
                  </TableCell>
                  {detailed ? (
                    <TableCell className="num text-[12px] text-muted-foreground">
                      ₹{ipo.priceBand[0]}–{ipo.priceBand[1]}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <p className="num text-[12px] font-medium text-primary">
                      +₹{ipo.gmp}
                    </p>
                    <p className="num mt-0.5 text-[10px] text-muted-foreground">
                      {ipo.gmpPct.toFixed(1)}%
                    </p>
                  </TableCell>
                  {detailed ? (
                    <TableCell className="num text-right text-[12px] text-foreground/80">
                      {ipo.subscription.toFixed(1)}x
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <AiScore score={ipo.aiScore} />
                      <VerdictBadge
                        verdict={ipo.verdict}
                        className="w-fit px-1.5 py-0.5 text-[9px]"
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <IpoStatusBadge schedule={schedule} />
                  </TableCell>
                  <TableCell className="pr-4 text-right sm:pr-5">
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!schedule.canApply}
                        onClick={() => setSelected(ipo)}
                      className={cn(
                        "group h-8 gap-1 rounded-lg px-2.5 text-[11px] font-medium whitespace-nowrap",
                        schedule.canApply
                          ? "border-primary/25 bg-primary/[0.08] text-primary hover:bg-primary/15 hover:text-primary"
                          : "border-border bg-muted/30 text-muted-foreground",
                      )}
                    >
                      {schedule.applyLabel}
                      {schedule.canApply ? (
                        <ArrowUpRight
                          className="size-3 shrink-0 text-emerald-500 transition-transform duration-200 group-hover:-translate-y-0.5"
                          strokeWidth={1.5}
                        />
                      ) : null}
                      </Button>
                      {isAdmin && ipo.aiScore === 0 ? (
                        <ReanalyzeButton ipo={ipo} />
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          openChat(
                            `Analyze ${ipo.company} (${ipo.type}). Should I buy/hold/sell this? Give me the final verdict.`,
                          )
                        }
                        className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        title="Ask AI about this IPO"
                      >
                        <Bot className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <IpoApplyDialog
        ipo={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
