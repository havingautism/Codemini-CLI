"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { variants } from "@/lib/variants"

import { cn } from "@/lib/utils"

const toggleVariants = variants(
  "inline-flex items-center justify-center gap-2 rounded-lg border-0 text-[12px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-(--selected-bg) data-[state=on]:text-(--text-primary) data-[state=on]:shadow-[inset_0_0_0_1px_var(--selected-edge)] hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:shadow-[inset_0_0_0_1px_var(--control-border-hover)] text-(--text-secondary) [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-(--border-default) bg-transparent shadow-xs",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2 text-xs",
        lg: "h-10 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const ToggleGroupContext = React.createContext({
  size: "default",
  variant: "default",
})

function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-0.5",
        className
      )}
      {...props}>
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "min-w-0 flex-1",
        className
      )}
      {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem }
