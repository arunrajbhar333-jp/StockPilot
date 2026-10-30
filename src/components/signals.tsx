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
};

const toneStyles: Record<Tone, string> = {
  positive: "border-signal/25 bg-signal/10 text-signal",
  neutral: "border-gold/25 bg-gold/10 text-gold",
  negative: "border-negative/25 bg-negative/10 text-negative",
  strongPositive:
    "border-signal/45 bg-signal/[0.16] text-signal ring-1 ring-signal/25",
  strongNegative:
    "border-negative/45 bg-negative/[0.16] text-negative ring-1 ring-negative/25",
};

const dotStyles: Record<Tone, string> = {
  positive: "bg-signal",
  neutral: "bg-gold",
  negative: "bg-negative",
  strongPositive: "bg-signal",
  strongNegative: "bg-negative",
};

/**
 * Light-theme badges. BUY / APPLY emerald, SELL / STRONG SELL red, HOLD /
 * WATCH amber, placeholder slate. Dark mode keeps toneStyles above.
 */
const lightToneStyles: Record<Tone, string> = {
  positive: "border-emerald-200 bg-emerald-100 text-emerald-800",
  neutral: "border-amber-200 bg-amber-100 text-amber-800",
  negative: "border-red-200 bg-red-100 text-red-800",
  strongPositive:
    "border-emerald-200 bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  strongNegative:
    "border-red-200 bg-red-100 text-red-800 ring-1 ring-red-300",
};

const lightDotStyles: Record<Tone, string> = {
  positive: "bg-emerald-600",
  neutral: "bg-amber-600",
  negative: "bg-red-600",
  strongPositive: "bg-emerald-700",
  strongNegative: "bg-red-700",
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
  const { theme } = useTheme();
  const light = theme === "light";
  const tone = verdictTone[verdict];

  const strong = tone === "strongPositive" || tone === "strongNegative";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] tracking-[0.12em] whitespace-nowrap",
        strong ? "font-bold" : "font-semibold",
        light ? lightToneStyles[tone] : toneStyles[tone],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          light ? lightDotStyles[tone] : dotStyles[tone],
        )}
      />
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
