import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function SettingsSegmentedControl({
  value,
  onValueChange,
  options = [],
  disabled = false,
  idPrefix = "settings-segmented",
  className,
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange?.(next)}
      disabled={disabled}
      className={cn(
        "settings-segmented flex w-full items-stretch rounded-xl border border-(--border-default) bg-(--bg-subtle) p-1",
        className,
      )}
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          id={`${idPrefix}-${opt.value}`}
          value={opt.value}
          className={cn(
            "settings-segmented-item h-8 flex-1 rounded-lg border-0 text-[12px] font-medium transition-[background-color,color]",
            "data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:shadow-sm",
            "data-[state=off]:text-muted-foreground",
          )}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
