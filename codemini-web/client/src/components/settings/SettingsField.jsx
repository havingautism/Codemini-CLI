import { Question } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FieldDescription } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function SettingsField({
  id,
  label,
  help,
  description,
  children,
  className,
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label
            htmlFor={id}
            className="text-[13px] font-medium text-(--text-primary)"
          >
            {label}
            {help && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 inline-flex align-[-2px] text-(--text-muted) hover:text-(--text-primary)"
                    aria-label={help}
                  >
                    <Question size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="max-w-[300px] leading-relaxed"
                >
                  {help}
                </TooltipContent>
              </Tooltip>
            )}
          </label>
          {description && (
            <FieldDescription className="mt-0.5">{description}</FieldDescription>
          )}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
