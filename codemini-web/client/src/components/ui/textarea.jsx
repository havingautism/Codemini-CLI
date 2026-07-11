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
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-(--control-border) bg-(--control-bg) px-3 py-2 text-[13px] leading-5 text-(--text-primary) shadow-[var(--control-shadow)] transition-[border-color,background-color,box-shadow] outline-none placeholder:text-(--text-muted) hover:border-(--control-border-hover) hover:bg-(--bg-primary) focus-visible:border-(--control-border-hover) focus-visible:bg-(--bg-primary) focus-visible:shadow-[inset_0_0_0_1px_var(--control-border-hover)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-(--accent-red) aria-invalid:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-red)_24%,transparent)]",
        className
      )}
      {...props} />
  );
}

export { Textarea }
