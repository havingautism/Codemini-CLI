import { Question } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettingsField({
  id,
  label,
  help,
  description,
  children,
  className,
  inline = false,
}) {
  return (
    <Field
      className={cn(
        inline
          ? "flex items-center justify-between gap-3"
          : "flex flex-col gap-2",
        className,
      )}
    >
      <FieldContent className="min-w-0">
        <div className="flex items-center gap-1">
          <FieldLabel
            htmlFor={id}
            className="w-auto text-[13px] font-medium text-(--text-primary)"
          >
            {label}
          </FieldLabel>
          {help && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="close"
                  size="icon-xs"
                  className="shadow-none"
                  aria-label={help}
                >
                  <Question size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="max-w-[300px] leading-relaxed"
              >
                {help}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && (
          <FieldDescription className="mt-0.5">{description}</FieldDescription>
        )}
      </FieldContent>
      <div className="min-w-0">{children}</div>
    </Field>
  );
}
