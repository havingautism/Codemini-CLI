import * as React from "react"
import { variants } from "@/lib/variants";
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = variants(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,opacity] outline-none cursor-pointer focus-visible:shadow-[inset_0_0_0_1px_var(--control-border-hover)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-(--text-primary) text-(--bg-primary) shadow-[0_4px_14px_color-mix(in_srgb,var(--text-primary)_16%,transparent)] hover:opacity-[0.86] active:scale-[0.98]",
        destructive: "bg-(--accent-red-bg) text-(--accent-red) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-red)_18%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-red)_16%,var(--accent-red-bg))]",
        outline: "border-0 bg-(--badge-bg) shadow-[0_1px_2px_color-mix(in_srgb,black_5%,transparent)] hover:bg-(--bg-hover) hover:text-(--text-primary) hover:shadow-[0_1px_3px_color-mix(in_srgb,black_10%,transparent)]",
        secondary: "bg-(--badge-bg) text-(--text-primary) shadow-[inset_0_0_0_1px_var(--badge-edge)] hover:bg-(--bg-hover)",
        ghost: "bg-(--badge-bg) text-(--text-secondary) shadow-[0_1px_2px_color-mix(in_srgb,black_5%,transparent)] hover:bg-(--bg-hover) hover:text-(--text-primary) hover:shadow-[0_1px_3px_color-mix(in_srgb,black_10%,transparent)] active:scale-[0.97]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5 text-[13px] has-[>svg]:px-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-3 text-[13px] has-[>svg]:px-2",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({ className, variant = "default", size = "default", asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
