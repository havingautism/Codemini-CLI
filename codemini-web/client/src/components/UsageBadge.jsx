import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildUsagePanelModel,
  formatDurationMs,
  formatTokensPerSecond,
} from "../../../../src/core/usage-timing.js";
import { getLocale, t } from "../../i18n/index.js";

function formatUsageNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (number >= 1_000_000)
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1000)
    return `${(number / 1000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

function formatGrouped(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  const locale = getLocale() === "zh" ? "zh-CN" : "en-US";
  return number.toLocaleString(locale);
}

function cachePct(tokens) {
  const base =
    tokens.cacheMiss > 0 || tokens.cacheWrite > 0
      ? tokens.cached + tokens.cacheMiss + tokens.cacheWrite
      : tokens.input;
  return base > 0 ? (tokens.cached / base) * 100 : 0;
}

export function getUsageSummary(usage) {
  const model = buildUsagePanelModel(usage);
  if (!model) return null;
  const { tokens } = model;
  const pct = cachePct(tokens);
  const labelParts = [`${formatUsageNumber(tokens.total)} ${t("usageTokens")}`];
  if (tokens.cached > 0 || tokens.input > 0) {
    labelParts.push(
      `${t("usageCache")} ${formatUsageNumber(tokens.cached)} (${pct.toFixed(1)}%)`,
    );
  }
  return { label: labelParts.join(" · "), model };
}

function SegmentBar({ segments }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      {segments
        .filter((item) => item.value > 0)
        .map((item) => (
          <span
            key={item.key}
            className={item.className}
            style={{ width: `${(item.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-(--text-muted)">{label}</span>
      <span className="text-(--text-primary)">{value}</span>
    </div>
  );
}

function UsagePanel({ model }) {
  const { tokens, timing } = model;
  const tokenSegments = [
    { key: "input", value: tokens.barInput, className: "bg-(--accent-orange)" },
    { key: "output", value: tokens.output, className: "bg-(--accent-blue)" },
    { key: "cached", value: tokens.cached, className: "bg-(--accent-green)" },
  ];
  const tokenLegend = [
    { key: "input", label: t("usageInput"), value: tokens.input, dot: "bg-(--accent-orange)" },
    { key: "output", label: t("usageOutput"), value: tokens.output, dot: "bg-(--accent-blue)" },
    { key: "cached", label: t("usageCache"), value: tokens.cached, dot: "bg-(--accent-green)" },
  ];
  const extraRows = [
    tokens.cacheWrite > 0 && [t("usageCacheWrite"), `${formatGrouped(tokens.cacheWrite)} ${t("usageTokens")}`],
    tokens.cacheMiss > 0 && [t("usageCacheMiss"), `${formatGrouped(tokens.cacheMiss)} ${t("usageTokens")}`],
    tokens.reasoning > 0 && [t("usageReasoning"), `${formatGrouped(tokens.reasoning)} ${t("usageTokens")}`],
    tokens.requests > 1 && [t("usageRequests").replace("{{count}}", tokens.requests), ""],
  ].filter(Boolean);

  const waitingPct = timing ? Math.min(100, Math.max(0, timing.waitingRatio * 100)) : 0;
  const generatingPct = Math.max(0, 100 - waitingPct);
  const showGeneratingSegment = timing && timing.generatingMs > 0 && generatingPct > 0;

  return (
    <div className="flex w-[280px] flex-col gap-3 text-left text-[11px] leading-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-semibold text-(--text-primary)">{t("usagePanelTitle")}</h3>
        <SegmentBar segments={tokenSegments} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-(--text-muted)">
          {tokenLegend.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${item.dot}`} />
              {item.label} {formatGrouped(item.value)}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <MetricRow label={t("usageInput")} value={`${formatGrouped(tokens.input)} ${t("usageTokens")}`} />
          <MetricRow label={t("usageOutput")} value={`${formatGrouped(tokens.output)} ${t("usageTokens")}`} />
          <MetricRow label={t("usageCacheRead")} value={`${formatGrouped(tokens.cached)} ${t("usageTokens")}`} />
          <MetricRow label={t("usageTotal")} value={`${formatGrouped(tokens.total)} ${t("usageTokens")}`} />
          {extraRows.map((row) => (
            <MetricRow key={row[0]} label={row[0]} value={row[1]} />
          ))}
        </div>
      </section>
      {timing ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold text-(--text-primary)">{t("usageTimingTitle")}</h3>
          <div className="flex flex-col gap-1">
            <div className="relative h-6">
              <div className="absolute inset-x-0 top-2 flex h-2 overflow-hidden rounded-full">
                {waitingPct > 0 ? (
                  <span className="bg-(--text-muted)" style={{ width: `${waitingPct}%` }} />
                ) : null}
                {showGeneratingSegment ? (
                  <span className="bg-(--accent-blue)" style={{ width: `${generatingPct}%` }} />
                ) : null}
              </div>
              <span className="absolute left-0 top-0 text-[10px] text-(--text-muted)">
                {t("usageRequestSent")}
              </span>
              <span
                className="absolute top-0 -translate-x-1/2 text-[10px] text-(--text-muted)"
                style={{ left: `${waitingPct}%` }}
              >
                {t("usageFirstToken")}
              </span>
              <span className="absolute right-0 top-0 text-[10px] text-(--text-muted)">
                {t("usageComplete")}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-(--text-muted)">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-(--text-muted)" />
                {t("usageWaiting")} {formatDurationMs(timing.waitingMs)}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-(--accent-blue)" />
                {t("usageGenerating")} {formatDurationMs(timing.generatingMs)}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <MetricRow label={t("usageTotalResponse")} value={formatDurationMs(timing.totalMs)} />
            <MetricRow label={t("usageTtft")} value={formatDurationMs(timing.waitingMs)} />
            {timing.showTps ? (
              <MetricRow label={t("usageTps")} value={formatTokensPerSecond(timing.tps)} />
            ) : null}
          </div>
          {timing.showTps ? (
            <p className="text-[10px] leading-4 text-(--text-muted)">{t("usageTpsFootnote")}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function UsageBadge({ usage, className = "" }) {
  const summary = getUsageSummary(usage);
  if (!summary) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-8 max-w-full items-center truncate rounded-md px-1.5 text-[11px] text-(--text-muted) ${className}`.trim()}
        >
          {summary.label}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="w-fit max-w-[calc(100vw-2rem)] p-3 text-left font-normal text-pretty"
      >
        <UsagePanel model={summary.model} />
      </TooltipContent>
    </Tooltip>
  );
}
