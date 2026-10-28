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
          <stop offset="0%" stopColor="#F8E0A0" />
          <stop offset="48%" stopColor="#E3B34B" />
          <stop offset="100%" stopColor="#A9741C" />
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
        d="M14.5 34.5 L24 12.5 L33.5 34.5"
        fill="none"
        stroke={`url(#gold-${uid})`}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 27.6 H28.6"
        stroke={`url(#gold-${uid})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="35.5" cy="13.5" r="2.6" fill="#63E2A6" />
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
        <p className="font-display text-[17px] font-semibold tracking-[0.22em] text-foreground">
          AURUM
        </p>
        <p className="mt-1.5 text-[9px] font-medium tracking-[0.28em] text-muted-foreground uppercase">
          AI Market Terminal
        </p>
      </div>
    </div>
  );
}
