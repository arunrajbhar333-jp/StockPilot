import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type {
  HoldingVerdict,
  IpoVerdict,
  SipVerdict,
} from "@/types/domain";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type AnyVerdict = IpoVerdict | HoldingVerdict | SipVerdict;
type Tone =
  | "positive"
  | "neutral"
  | "negative"
  | "strongPositive"
  | "strongNegative";

const verdictTone: Record<AnyVerdict, Tone> = {
  APPLY: "positive",
  "STRONG BUY": "strongPositive",
  BUY: "positive",
  START: "positive",
  WATCH: "neutral",
  HOLD: "neutral",
  WAIT: "neutral",
  AVOID: "negative",
  SELL: "negative",
  "STRONG SELL": "strongNegative",
};/**
 * Verdict badges are solid, bold colour blocks in both themes: a call is the
 * single most important thing on the row, so it has to read as a stamp rather
 * than a tinted note. BUY / APPLY emerald, SELL / AVOID red, HOLD amber.
 */
const toneStyles: Record<Tone, string> = {
  positive: "border-emerald-500 bg-emerald-500 text-white",
  neutral: "border-amber-400 bg-amber-400 text-amber-950",
  negative: "border-red-500 bg-red-500 text-white",
  strongPositive:
    "border-emerald-600 bg-emerald-600 text-white ring-1 ring-emerald-300/70",
  strongNegative:
    "border-red-600 bg-red-600 text-white ring-1 ring-red-300/70",
};

/** True for the two strongest negative calls, used to tint whole rows. */
export function isSellVerdict(verdict: HoldingVerdict): boolean {
  return verdict === "SELL" || verdict === "STRONG SELL";
}

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: AnyVerdict;
  className?: string;
}) {
  const tone = verdictTone[verdict];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold tracking-[0.12em] uppercase whitespace-nowrap shadow-sm",
        toneStyles[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {verdict}
    </span>
  );
}

export function AiScore({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const bar =
    score >= 7.5 ? "bg-signal" : score >= 6 ? "bg-gold" : "bg-negative";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="num text-[13px] font-medium text-foreground">
        {score.toFixed(1)}
      </span>
      <span className="-ml-1 text-[10px] text-muted-foreground">/10</span>
      <div className="h-1 w-9 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full", bar)}
          style={{ width: `${Math.min(100, score * 10)}%` }}
        />
      </div>
    </div>
  );
}

export function IpoTypeBadge({ type }: { type: "SME" | "Mainboard" }) {
  const { theme } = useTheme();
  const light = theme === "light";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        type === "SME"
          ? light
            ? "border-violet-200 bg-violet-100 text-violet-800"
            : "border-ai/25 bg-ai/10 text-ai"
          : light
            ? "border-slate-200 bg-slate-100 text-slate-600"
            : "border-white/10 bg-white/[0.04] text-muted-foreground",
      )}
    >
      {type}
    </span>
  );
}

export function ChangePill({
  changePct,
  className,
}: {
  changePct: number;
  className?: string;
}) {
  const { theme } = useTheme();
  const light = theme === "light";
  const positive = changePct >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        positive
          ? light
            ? "bg-emerald-100 text-emerald-800"
            : "bg-signal/10 text-signal"
          : light
            ? "bg-red-100 text-red-800"
            : "bg-negative/10 text-negative",
        className,
      )}
    >
      <Icon className="size-3" />
      <span className="num">
        {positive ? "+" : ""}
        {changePct.toFixed(2)}%
      </span>
    </span>
  );
}

export function RiskBadge({ risk }: { risk: "Low" | "Moderate" | "High" }) {
  const { theme } = useTheme();
  const light = theme === "light";
  const tone: Tone =
    risk === "Low" ? "positive" : risk === "Moderate" ? "neutral" : "negative";

  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
        risk === "Low" &&
          (light ? "bg-emerald-100 text-emerald-800" : "bg-signal/10 text-signal"),
        risk === "Moderate" &&
          (light
            ? "bg-slate-100 text-slate-600"
            : "bg-white/[0.06] text-muted-foreground"),
        risk === "High" &&
          tone === "negative" &&
          (light ? "bg-red-100 text-red-800" : "bg-negative/10 text-negative"),
      )}
    >
      {risk} risk
    </span>
  );
}
