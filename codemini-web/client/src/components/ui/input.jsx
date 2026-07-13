import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-(--control-border) bg-(--control-bg) px-3 py-1 text-[13px] text-(--text-primary) shadow-[var(--control-shadow)] transition-[border-color,background-color,box-shadow] outline-none placeholder:text-(--text-muted) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-(--control-border-hover) hover:bg-(--bg-primary) focus-visible:border-(--control-border-hover) focus-visible:bg-(--bg-primary) focus-visible:shadow-[inset_0_0_0_1px_var(--control-border-hover)] aria-invalid:border-(--accent-red) aria-invalid:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-red)_24%,transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
