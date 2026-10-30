import { useState } from "react";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { IpoApplyDialog } from "@/components/ipo-apply-dialog";
import { AiScore, IpoTypeBadge, VerdictBadge } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { useReanalyzeIpo } from "@/hooks/use-ipo-actions";
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
      className="h-6 gap-1 rounded-md px-1.5 text-[10px] font-medium text-ai hover:bg-ai/10 hover:text-ai"
    >
      {reanalyze.isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Sparkles className="size-3" />
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

  return (
    <>
      <div className="w-full overflow-x-auto">
        <Table className="min-w-[520px]">
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
              <TableHead className="pr-4 text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase sm:pr-5">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((ipo) => (
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
                        {ipo.sector} · {ipo.status}
                      </p>
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
                      className={cn(
                        "w-fit px-1.5 py-0.5 text-[9px]",
                        ipo.verdict === "AVOID" && "opacity-80",
                      )}
                    />
                  </div>
                </TableCell>
                <TableCell className="pr-4 text-right sm:pr-5">
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(ipo)}
                      className="h-8 gap-1 rounded-lg border-primary/25 bg-primary/[0.08] px-2.5 text-[11px] font-medium text-primary hover:bg-primary/15 hover:text-primary"
                    >
                      Apply
                      <ArrowUpRight className="size-3" />
                    </Button>
                    {isAdmin && ipo.aiScore === 0 ? (
                      <ReanalyzeButton ipo={ipo} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <IpoApplyDialog ipo={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  );
}
