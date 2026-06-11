import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-(--border-strong) shadow-inner transition-colors outline-none focus-visible:border-(--border-strong) focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-(--text-primary) data-[state=checked]:bg-(--text-primary)",
        className
      )}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-(--text-muted) ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-(--bg-primary) data-[state=unchecked]:translate-x-0.5"
        )} />
    </SwitchPrimitive.Root>
  );
}

export { Switch }
