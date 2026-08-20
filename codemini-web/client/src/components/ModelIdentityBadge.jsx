import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApp } from "@/context/app-context.jsx";
import { buildModelPanelModel } from "@/lib/message-model-identity.js";
import { getLocale, t } from "../../i18n/index.js";

function formatGrouped(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  const locale = getLocale() === "zh" ? "zh-CN" : "en-US";
  return number.toLocaleString(locale);
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-(--text-muted)">{label}</span>
      <span className="min-w-0 break-all text-right text-(--text-primary)">
        {value}
      </span>
    </div>
  );
}

function contextBarClass(pct) {
  if (pct < 40) return "bg-(--accent-green)";
  if (pct < 75) return "bg-(--accent-orange)";
  return "bg-(--accent-red)";
}

function ModelPanel({ model }) {
  const defaultModel = model.mainModel || model.replyModel;
  return (
    <div className="flex w-[280px] flex-col gap-3 text-left text-[11px] leading-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-semibold text-(--text-primary)">
          {t("modelPanelTitle")}
        </h3>
        <div className="flex flex-col gap-0.5">
          <MetricRow label={t("sdk")} value={model.sdkLabel} />
          {defaultModel ? (
            <MetricRow label={t("modelName")} value={defaultModel} />
          ) : null}
          {model.fastModel ? (
            <MetricRow label={t("fastModel")} value={model.fastModel} />
          ) : null}
          {model.showReplyModel ? (
            <MetricRow label={t("modelPanelReply")} value={model.replyModel} />
          ) : null}
        </div>
      </section>
      {model.context ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold text-(--text-primary)">
            {t("contextPanelTitle")}
          </h3>
          <div className="h-2 w-full overflow-hidden rounded-full bg-(--bg-primary)">
            <span
              className={`block h-full ${contextBarClass(model.context.pct)}`}
              style={{ width: `${model.context.pct}%` }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <MetricRow
              label={t("usageContextUsed")}
              value={`${formatGrouped(model.context.used)} ${t("usageTokens")}`}
            />
            <MetricRow
              label={t("usageContextWindow")}
              value={`${formatGrouped(model.context.max)} ${t("usageTokens")}`}
            />
            <MetricRow
              label={t("usageContextUsage")}
              value={`${model.context.pct}%`}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ModelIdentityBadge({ sdkProvider, model }) {
  const { state } = useApp();
  const panel = buildModelPanelModel({
    sdkProvider,
    model,
    runtimeState: state.runtimeState,
  });
  if (!panel) return null;
  const { identity } = panel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-8 max-w-full items-center gap-2.5 rounded-md px-1.5 text-[11px] text-(--text-muted)">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <img
              src={identity.logo}
              alt=""
              width={13}
              height={13}
              className="size-[13px] shrink-0 object-contain"
            />
            <span className="uppercase">{identity.sdkLabel}</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {identity.modelLogo ? (
              <img
                src={identity.modelLogo}
                alt=""
                width={13}
                height={13}
                className="size-[13px] shrink-0 object-contain"
              />
            ) : null}
            <span className="uppercase">{identity.model}</span>
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="w-fit max-w-[calc(100vw-2rem)] p-3 text-left font-normal text-pretty"
      >
        <ModelPanel model={panel} />
      </TooltipContent>
    </Tooltip>
  );
}
