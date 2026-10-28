import { useId } from "react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("size-10", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`gold-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--brand-mark-1)" }} />
          <stop offset="48%" style={{ stopColor: "var(--brand-mark-2)" }} />
          <stop offset="100%" style={{ stopColor: "var(--brand-mark-3)" }} />
        </linearGradient>
        <linearGradient id={`plate-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1C1E29" />
          <stop offset="100%" stopColor="#08090D" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="46"
        height="46"
        rx="13"
        fill={`url(#plate-${uid})`}
        stroke="rgba(255,255,255,0.12)"
      />
      <path
        d="M24 9.5 L34.5 32 L24 26.6 L13.5 32 Z"
        fill={`url(#gold-${uid})`}
      />
      <path
        d="M17.5 37.5 H30.5"
        stroke="var(--signal)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export function BrandLockup({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <BrandMark className={cn("size-10", markClassName)} />
      <div className="leading-none">
        <p className="font-display text-[16px] font-semibold tracking-[0.16em] text-foreground">
          STOCKPILOT
        </p>
        <p className="mt-1.5 text-[8.5px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
          AI Equity &amp; IPO Desk
        </p>
      </div>
    </div>
  );
}
