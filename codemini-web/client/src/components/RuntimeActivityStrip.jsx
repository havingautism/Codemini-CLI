import { CheckCircle, XCircle } from "@/lib/icons";
import { SessionOrb } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  running: {
    className:
      "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
  },
  done: {
    icon: CheckCircle,
    className:
      "border-(--accent-green)/30 bg-(--accent-green-bg) text-(--accent-green)",
    iconClassName: "",
  },
  error: {
    icon: XCircle,
    className:
      "border-(--accent-red)/30 bg-(--accent-red-bg) text-(--accent-red)",
    iconClassName: "",
  },
};

export function RuntimeActivityStrip({ activities = [] }) {
  const visible = activities
    .filter((activity) => activity.key !== "reflect" && activity.key !== "dream")
    .slice(0, 3);
  if (!visible.length) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
      {visible.map((activity) => {
        const style = STATUS_STYLES[activity.status] || STATUS_STYLES.done;
        const Icon = style.icon;
        const isRunning = activity.status === "running";
        return (
          <div
            key={activity.id}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none",
              "border shadow-sm",
              style.className,
            )}
          >
            <span className="shrink-0" aria-hidden="true">
              {activity.emoji}
            </span>
            {isRunning ? (
              <SessionOrb state="working" />
            ) : (
              <Icon size={13} className={cn("shrink-0", style.iconClassName)} />
            )}
            <span className="truncate text-(--text-primary)">
              {activity.label}
            </span>
            {activity.detail && (
              <span className="max-w-[180px] truncate text-(--text-muted)">
                {activity.detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
