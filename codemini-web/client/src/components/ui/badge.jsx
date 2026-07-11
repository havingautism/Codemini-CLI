import * as React from "react"
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border-0 bg-(--badge-bg) px-2 py-0.5 text-xs font-medium text-(--text-secondary) shadow-[inset_0_0_0_1px_var(--badge-edge)] whitespace-nowrap transition-[color,background-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--control-border-hover)] aria-invalid:text-(--accent-red) aria-invalid:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-red)_24%,transparent)] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-(--selected-bg) text-(--text-primary) [a&]:hover:bg-(--bg-active)",
        secondary:
          "bg-(--badge-bg) text-(--text-secondary) [a&]:hover:bg-(--bg-hover)",
        destructive:
          "bg-(--accent-red-bg) text-(--accent-red) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-red)_18%,transparent)] [a&]:hover:bg-[color-mix(in_srgb,var(--accent-red)_14%,var(--accent-red-bg))]",
        outline:
          "bg-transparent text-(--text-secondary) shadow-[inset_0_0_0_1px_var(--badge-edge)] [a&]:hover:bg-(--bg-hover) [a&]:hover:text-(--text-primary)",
        ghost: "bg-transparent shadow-none [a&]:hover:bg-(--bg-hover) [a&]:hover:text-(--text-primary)",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props} />
  );
}

export { Badge, badgeVariants }
