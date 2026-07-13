import { cn } from "@/lib/utils";

export function SettingsSection({ title, description, children, className }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {(title || description) && (
        <div className="flex flex-col gap-1">
          {title && (
            <h3 className="text-[14px] font-semibold text-(--text-primary)">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-[12px] leading-snug text-(--text-muted)">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}
