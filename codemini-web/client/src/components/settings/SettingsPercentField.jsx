import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SettingsPercentField({
  id,
  value,
  onChange,
  min = 1,
  max = 100,
  placeholder,
  disabled = false,
  className,
}) {
  const numeric = Number(value);
  const sliderValue = Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : min;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        type="range"
        min={min}
        max={max}
        value={sliderValue}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-1.5 w-full cursor-pointer accent-[var(--input-shell-accent)]"
        aria-label={id}
      />
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-24"
      />
    </div>
  );
}
