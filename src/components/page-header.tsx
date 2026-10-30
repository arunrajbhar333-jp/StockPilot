import type { ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const { theme } = useTheme();
  const light = theme === "light";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p
            className={cn(
              "eyebrow flex items-center gap-2 text-primary/85",
              light && "text-slate-500",
            )}
          >
            <span className="h-px w-6 bg-primary/40" />
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            "mt-2 font-display text-[26px] leading-tight font-semibold tracking-tight text-foreground sm:text-[30px]",
            light && "text-slate-900",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground",
              light && "text-slate-500",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
