import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-(--border-default) bg-transparent px-3 py-1 text-[13px] transition-colors outline-none placeholder:text-(--text-muted) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-(--text-secondary) focus-visible:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Input }
