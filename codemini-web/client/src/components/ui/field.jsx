import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

function FieldGroup({ className, ...props }) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex flex-col gap-4", className)}
      {...props} />
  );
}

function FieldSet({ className, ...props }) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("flex flex-col gap-4", className)}
      {...props} />
  );
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "text-[13px] font-semibold uppercase tracking-[0.3px] text-(--text-secondary)",
        className
      )}
      {...props} />
  );
}

function Field({ className, ...props }) {
  return (
    <div
      data-slot="field"
      className={cn(
        "group/field flex w-full gap-3 data-[disabled=true]:opacity-50",
        className
      )}
      {...props} />
  );
}

function FieldContent({ className, ...props }) {
  return (
    <div
      data-slot="field-content"
      className={cn("group/field-content flex flex-1 flex-col gap-1.5", className)}
      {...props} />
  );
}

function FieldLabel({ className, ...props }) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "w-32 shrink-0 text-[13px] font-normal text-(--text-muted)",
        className
      )}
      {...props} />
  );
}

function FieldTitle({ className, ...props }) {
  return (
    <Label
      data-slot="field-title"
      className={cn("text-[12px] text-(--text-muted)", className)}
      {...props} />
  );
}

function FieldDescription({ className, ...props }) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-[12px] leading-5 text-(--text-muted)", className)}
      {...props} />
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
}
