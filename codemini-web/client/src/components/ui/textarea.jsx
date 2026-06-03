import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-(--border-default) bg-(--bg-input) px-3 py-2 text-[13px] leading-5 text-(--text-primary) shadow-none transition-colors outline-none placeholder:text-(--text-muted) focus-visible:border-(--border-strong) focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props} />
  );
}

export { Textarea }
