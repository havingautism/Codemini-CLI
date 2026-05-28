import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-(--border-default) bg-[color-mix(in_srgb,var(--bg-input)_88%,var(--text-muted)_12%)] px-3 py-1 text-[13px] text-(--text-primary) transition-colors outline-none placeholder:text-(--text-muted) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:bg-[color-mix(in_srgb,var(--bg-input)_76%,var(--text-muted)_24%)] focus-visible:border-(--text-secondary) focus-visible:bg-(--bg-input) focus-visible:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Input }
