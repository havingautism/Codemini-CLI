import * as React from "react"
import { variants } from "@/lib/variants"

import { cn } from "@/lib/utils"

const alertVariants = variants(
  "relative w-full rounded-md border px-3 py-2 text-[13px] leading-6 [&>svg]:absolute [&>svg]:top-2.5 [&>svg]:left-3 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-(--border-default) bg-(--bg-secondary) text-(--text-primary)",
        destructive:
          "border-[color-mix(in_srgb,var(--destructive)_32%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,var(--bg-primary))] text-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant = "default",
  ...props
}) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props} />
  );
}

function AlertTitle({
  className,
  ...props
}) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium tracking-normal", className)}
      {...props} />
  );
}

function AlertDescription({
  className,
  ...props
}) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-[13px] text-(--text-secondary) [&_p]:leading-6", className)}
      {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
