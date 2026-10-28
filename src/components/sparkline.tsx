import { useId } from "react";
import { cn } from "@/lib/utils";

export function Sparkline({
  data,
  positive = true,
  className,
  strokeWidth = 2,
}: {
  data: number[];
  positive?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const width = 120;
  const height = 40;
  const pad = 3;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

  const points = data.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(width - pad).toFixed(1)},${height - pad} L${pad},${height - pad} Z`;
  const color = positive ? "var(--signal)" : "var(--negative)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-10 w-28 overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${uid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1][0]}
          cy={points[points.length - 1][1]}
          r="2.4"
          fill={color}
        />
      )}
    </svg>
  );
}
