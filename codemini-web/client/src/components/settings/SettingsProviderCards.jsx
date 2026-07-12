import { cn } from "@/lib/utils";

export function SettingsProviderCards({
  value,
  onValueChange,
  options = [],
  disabled = false,
  idPrefix = "settings-provider",
  className,
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        options.length <= 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3",
        className,
      )}
      role="radiogroup"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            id={`${idPrefix}-${opt.value}`}
            disabled={disabled}
            onClick={() => onValueChange?.(opt.value)}
            aria-pressed={selected}
            className={cn(
              "settings-provider-card flex min-h-[72px] flex-col items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-ring bg-accent text-accent-foreground shadow-sm"
                : "border-(--border-default) bg-transparent hover:border-(--border-strong) hover:bg-(--bg-hover)",
            )}
          >
            {opt.logo && (
              <img
                src={opt.logo}
                alt=""
                width={18}
                height={18}
                className="shrink-0 rounded-sm object-contain"
              />
            )}
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-(--text-primary)">
                {opt.label}
              </span>
              {opt.description && (
                <span className="mt-0.5 block text-[11px] leading-snug text-(--text-muted)">
                  {opt.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
