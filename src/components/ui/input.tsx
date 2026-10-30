import * as React from "react"

import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

/** bg-white border-slate-300 text-slate-900, blue focus ring — light mode only. */
const lightInput =
  "border-slate-300 bg-white text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-blue-500/40"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const { theme } = useTheme()

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        theme === "light" && lightInput,
        className
      )}
      {...props}
    />
  )
}

export { Input }
