import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "../../i18n/index.js";

function formatUsageNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (number >= 1_000_000)
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1000)
    return `${(number / 1000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

export function getUsageSummary(usage) {
  if (!usage || typeof usage !== "object") return null;
  const total = Number(usage.totalTokens || 0);
  const input = Number(usage.inputTokens || 0);
  const output = Number(usage.outputTokens || 0);
  const cached = Number(usage.cachedInputTokens || 0);
  const cacheMiss = Number(usage.cacheMissInputTokens || 0);
  const cacheWrite = Number(usage.cacheWriteInputTokens || 0);
  const reasoning = Number(usage.reasoningOutputTokens || 0);
  const requests = Number(usage.requests || 0);
  if (
    ![total, input, output, cached, cacheWrite, reasoning].some(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const cacheBase =
    cacheMiss > 0 || cacheWrite > 0 ? cached + cacheMiss + cacheWrite : input;
  const cachePct = cacheBase > 0 ? (cached / cacheBase) * 100 : 0;
  const labelParts = [
    `${formatUsageNumber(total || input + output)} ${t("usageTokens")}`,
  ];
  if (cached > 0 || input > 0) {
    labelParts.push(
      `${t("usageCache")} ${formatUsageNumber(cached)} (${cachePct.toFixed(1)}%)`,
    );
  }
  const detailParts = [
    `${t("usageInput")} ${formatUsageNumber(input)}`,
    `${t("usageOutput")} ${formatUsageNumber(output)}`,
    `${t("usageTotal")} ${formatUsageNumber(total || input + output)}`,
  ];
  if (cached > 0 || input > 0)
    detailParts.push(
      `${t("usageCacheHit")} ${formatUsageNumber(cached)} (${cachePct.toFixed(1)}%)`,
    );
  if (cacheMiss > 0)
    detailParts.push(`${t("usageCacheMiss")} ${formatUsageNumber(cacheMiss)}`);
  if (cacheWrite > 0)
    detailParts.push(
      `${t("usageCacheWrite")} ${formatUsageNumber(cacheWrite)}`,
    );
  if (reasoning > 0)
    detailParts.push(`${t("usageReasoning")} ${formatUsageNumber(reasoning)}`);
  if (requests > 1)
    detailParts.push(t("usageRequests").replace("{{count}}", requests));
  return {
    label: labelParts.join(" · "),
    details: detailParts.join(" · "),
  };
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
      <TooltipContent side="bottom" sideOffset={6}>
        {summary.details}
      </TooltipContent>
    </Tooltip>
  );
}
