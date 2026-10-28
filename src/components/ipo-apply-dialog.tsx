import { CalendarDays, Layers, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AiScore, IpoTypeBadge, VerdictBadge } from "@/components/signals";
import type { Ipo } from "@/data/mockData";
import { formatInr } from "@/lib/format";

export function IpoApplyDialog({
  ipo,
  onOpenChange,
}: {
  ipo: Ipo | null;
  onOpenChange: (open: boolean) => void;
}) {
  const minimum = ipo ? ipo.lotSize * ipo.priceBand[1] : 0;

  return (
    <Dialog open={ipo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
        {ipo ? (
          <>
            <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
              <div className="flex items-start justify-between gap-3 pr-6">
                <div>
                  <div className="flex items-center gap-2">
                    <DialogTitle className="font-display text-base">
                      {ipo.company}
                    </DialogTitle>
                    <IpoTypeBadge type={ipo.type} />
                  </div>
                  <DialogDescription className="mt-1 text-[11px]">
                    {ipo.sector} · {ipo.status} · Closes {ipo.closeDate}
                  </DialogDescription>
                </div>
                <VerdictBadge verdict={ipo.verdict} />
              </div>
            </DialogHeader>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    <Wallet className="size-3" /> Price band
                  </p>
                  <p className="num mt-1.5 text-[13px] font-medium">
                    ₹{ipo.priceBand[0]} – ₹{ipo.priceBand[1]}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    <Layers className="size-3" /> Lot size
                  </p>
                  <p className="num mt-1.5 text-[13px] font-medium">
                    {ipo.lotSize.toLocaleString("en-IN")} shares
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    <CalendarDays className="size-3" /> Window
                  </p>
                  <p className="num mt-1.5 text-[13px] font-medium">
                    {ipo.openDate} – {ipo.closeDate}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    <Sparkles className="size-3" /> GMP
                  </p>
                  <p className="num mt-1.5 text-[13px] font-medium text-primary">
                    +₹{ipo.gmp} · {ipo.gmpPct.toFixed(1)}%
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-ai/20 bg-[linear-gradient(140deg,oklch(0.72_0.145_292/0.12),transparent_70%)] p-3.5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] text-ai uppercase">
                    <Sparkles className="size-3" /> AI underwriting note
                  </p>
                  <AiScore score={ipo.aiScore} />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {ipo.thesis}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/25 px-3.5 py-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    Minimum investment (1 lot)
                  </p>
                  <p className="num mt-0.5 text-base font-medium">
                    {formatInr(minimum)}
                  </p>
                </div>
                <p className="num text-right text-[10px] text-muted-foreground">
                  Issue size
                  <span className="mt-0.5 block text-[11px] text-foreground">
                    {ipo.issueSize}
                  </span>
                </p>
              </div>
            </div>

            <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  toast.success(`Application drafted for ${ipo.company}`, {
                    description:
                      "Phase 1 simulation. No order was sent to the exchange.",
                  });
                  onOpenChange(false);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Confirm application
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
