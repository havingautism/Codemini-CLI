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
        "flex w-full items-stretch rounded-lg border border-(--border-default) bg-(--bg-subtle) p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          id={`${idPrefix}-${opt.value}`}
          value={opt.value}
          className={cn(
            "h-8 flex-1 rounded-md border-0 text-[12px] font-medium transition-shadow",
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
