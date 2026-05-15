import { Brain, Plug, ShieldCheck, ChartNoAxesCombined } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const STAGE_COLORS = {
  thinking: "bg-(--accent-blue)",
  streaming: "bg-(--accent-green)",
  tooling: "bg-(--accent-orange)",
  live: "bg-(--accent-cyan)",
};

export function StatusBar({ runtimeState, live, stageLabel }) {
  const rs = runtimeState || {};
  const mode = rs.mode || "normal";
  const used = rs.currentContextTokens || 0;
  const max = rs.maxContextTokens || 0;
  const pct = max ? Math.round((used / max) * 100) : 0;
  const contextColor =
    pct < 40
      ? "bg-(--accent-green)"
      : pct < 75
        ? "bg-(--accent-orange)"
        : "bg-(--accent-red)";

  const stageKey =
    Object.keys(STAGE_COLORS).find((k) => (stageLabel || "").includes(k)) ||
    "live";

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0 text-[12px] text-(--text-muted) overflow-hidden">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Brain size={13} className="shrink-0 opacity-70" />
        <span>{rs.model?.toUpperCase() || "-"}</span>
      </span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Plug size={13} className="shrink-0 opacity-70" />
        <span>{rs.sdkProvider?.toUpperCase() || "-"}</span>
      </span>
      {/* <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <ShieldCheck size={13} className="shrink-0 opacity-70" />
        <span>{mode.toUpperCase()}</span>
      </span> */}
      {max > 0 && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <ChartNoAxesCombined size={13} className="shrink-0 opacity-70" />
          <span>CTX</span>
          <span className="w-12 h-1 bg-(--muted) rounded-full overflow-hidden">
            <span
              className={cn(
                "block h-full rounded-full transition-all",
                contextColor,
              )}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{pct}%</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 ml-auto whitespace-nowrap">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            live ? STAGE_COLORS[stageKey] : "bg-(--text-muted)",
            live && "animate-pulse",
          )}
        />
        <span>{live ? stageLabel : t("idle")}</span>
      </span>
    </div>
  );
}
