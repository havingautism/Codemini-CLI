import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function SettingsChoiceList({
  value,
  onValueChange,
  options = [],
  disabled = false,
  idPrefix = "settings-choice",
  className,
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange?.(next)}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-stretch gap-1.5",
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const selected = opt.value === value;
        return (
          <ToggleGroupItem
            key={opt.value}
            id={`${idPrefix}-${opt.value}`}
            value={opt.value}
            className={cn(
              "h-auto min-h-[52px] w-full justify-start rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected
                ? "border-[color-mix(in_srgb,var(--input-shell-accent)_40%,transparent)] bg-[var(--input-shell-glow-soft)] text-(--text-primary)"
                : "border-(--border-default) bg-transparent hover:border-(--border-strong) hover:bg-(--bg-hover)",
            )}
          >
            {Icon && (
              <Icon
                data-icon="inline-start"
                size={16}
                weight={selected ? "fill" : "regular"}
                className={cn(
                  "shrink-0",
                  selected ? "text-[var(--input-shell-accent)]" : "text-(--text-muted)",
                )}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{opt.label}</span>
              {opt.description && (
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-(--text-muted)">
                  {opt.description}
                </span>
              )}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
