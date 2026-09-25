import { useEffect, useMemo, useState } from "react";
import { Download, Eye, MagnifyingGlass, X } from "@/lib/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BackupNotice, FilePreview } from "@/components/ToolCard.jsx";
import { cn } from "@/lib/utils";
import {
  extractToolName,
  getFileToolMeta,
  getToolInspectSections,
} from "@/lib/tool-card-display.js";
import {
  buildTrajectory,
  filterTrajectoryEvents,
  formatTrajectoryDuration,
  formatTrajectoryRowPreview,
  formatTrajectoryUsage,
  stringifyTrajectoryValue,
  trajectoryExportFilename,
} from "@/lib/session-trajectory.js";
import {
  activationLabel,
  beliefPercent,
  classifyDecision,
  collectHarnessEvents,
  decisionAction,
  hardGateLabel,
  summarizeHarness,
} from "@/lib/harness-summary.js";
import { t } from "../../i18n/index.js";

const KIND_CLASS = {
  system: "bg-(--bg-secondary) text-(--text-muted)",
  user: "bg-(--accent-blue-bg) text-(--accent-blue)",
  routing: "bg-(--accent-teal-bg) text-(--accent-teal)",
  thinking: "bg-(--accent-purple-bg) text-(--accent-purple)",
  assistant: "bg-(--accent-purple-bg) text-(--accent-purple)",
  tool: "bg-(--accent-orange-bg) text-(--accent-orange)",
  skill: "bg-(--accent-teal-bg) text-(--accent-teal)",
  error: "bg-(--accent-red-bg) text-(--accent-red)",
  memory: "bg-(--bg-secondary) text-(--accent-blue)",
};

const KIND_I18N = {
  system: "trajectoryKindSystem",
  user: "trajectoryKindUser",
  routing: "trajectoryKindRouting",
  memory: "trajectoryKindMemory",
  thinking: "trajectoryKindThinking",
  assistant: "trajectoryKindAssistant",
  tool: "trajectoryKindTool",
  skill: "trajectoryKindSkill",
  error: "trajectoryKindError",
};

const TITLE_I18N = {
  handoff: "trajectoryKindHandoff",
  abort: "trajectoryKindAbort",
  plan: "trajectoryKindPlan",
  notice: "trajectoryKindNotice",
  error: "trajectoryKindError",
  "system notice": "trajectoryKindSystemNotice",
};

const INSPECT_SECTION_I18N = {
  Arguments: "trajectoryInspectArguments",
  Summary: "trajectoryInspectSummary",
  Result: "trajectoryInspectResult",
};

function kindLabel(event) {
  const titleKey = TITLE_I18N[event?.title];
  if (titleKey) return t(titleKey);
  if (event?.status === "error" && event?.kind !== "tool" && event?.kind !== "skill") {
    return t("trajectoryKindError");
  }
  return t(KIND_I18N[event?.kind] || "trajectoryKindAssistant");
}

function isInspectable(event) {
  return [
    "system",
    "user",
    "routing",
    "memory",
    "thinking",
    "assistant",
    "tool",
    "skill",
    "error",
  ].includes(event?.kind);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EventRow({ event, onInspect }) {
  const preview = formatTrajectoryRowPreview(event);
  const inspectable = isInspectable(event);
  const previewClass =
    "block min-w-0 w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] leading-5 text-(--text-secondary)";
  return (
    <div className="group flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      {inspectable ? (
        <button
          type="button"
          onClick={onInspect}
          title={preview || undefined}
          className={cn(
            previewClass,
            "cursor-pointer border-0 bg-transparent p-0 text-left hover:text-(--text-primary)",
          )}
        >
          {preview || "—"}
        </button>
      ) : (
        <div className={previewClass} title={preview || undefined}>
          {preview || "—"}
        </div>
      )}
      {inspectable ? (
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded border-0 bg-transparent text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--border-strong)"
          onClick={onInspect}
          aria-label={t("trajectoryInspect")}
          title={t("trajectoryInspect")}
        >
          <Eye size={13} />
        </button>
      ) : null}
    </div>
  );
}

function prettyInspectValue(value) {
  return stringifyTrajectoryValue(value) || String(value || "").trim();
}

function cardFromTrajectoryEvent(event) {
  if (event?.sourceCard && typeof event.sourceCard === "object") {
    return {
      ...event.sourceCard,
      status: event.status || event.sourceCard.status || "done",
    };
  }
  return {
    name: event?.title || "tool",
    arguments: event?.input || event?.body || "",
    result: event?.output || "",
    summary: event?.preview || "",
    status: event?.status || "done",
  };
}

function InspectSection({ label, value }) {
  const text = prettyInspectValue(value);
  if (!text) return null;
  return (
    <section className="min-w-0">
      {label ? (
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.4px] text-(--text-muted)">
          {label}
        </div>
      ) : null}
      <pre className="codemini-inspect-pane">{text}</pre>
    </section>
  );
}

function inspectToolName(event) {
  return String(event?.sourceCard?.name || event?.title || "tool").trim();
}

function ToolInspectBody({ event }) {
  const card = cardFromTrajectoryEvent(event);
  const toolName = extractToolName(card.name);
  const fileMeta = getFileToolMeta(
    toolName,
    card.arguments,
    card.result,
    card.summary,
    card.fileChange,
    card.resultMeta,
    card.fileChanges,
  );
  const hasFilePreview = Boolean(fileMeta);
  const sections = getToolInspectSections(card, { hasFilePreview });
  return (
    <div className="flex min-w-0 flex-col gap-3 pb-1">
      <div className="break-all font-mono text-[13px] leading-5 text-(--text-primary)">
        {inspectToolName(event)}
      </div>
      {sections.map((section) => (
        <InspectSection
          key={section.label}
          label={t(INSPECT_SECTION_I18N[section.label] || section.label)}
          value={section.value}
        />
      ))}
      {fileMeta ? (
        <>
          <BackupNotice meta={fileMeta} />
          <FilePreview meta={fileMeta} />
        </>
      ) : null}
    </div>
  );
}

function inspectMetaLine(event) {
  const parts = [
    kindLabel(event),
    event.status && event.status !== "done" ? event.status : "",
    event.model || "",
    event.sdkProvider || "",
    formatTrajectoryUsage(event.usage),
    event.startedAt || "",
    event.endedAt && event.endedAt !== event.startedAt ? event.endedAt : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function TrajectoryInspectDialog({ event, onClose }) {
  if (!event) return null;
  const input = event.input || (event.kind !== "tool" ? event.body : "");
  const output = event.output || (event.kind === "tool" ? event.preview : "");
  const summary = event.kind === "tool" || event.kind === "skill" ? event.preview : "";
  const showIo = event.kind === "skill" || event.kind === "user";
  const meta = inspectMetaLine(event);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeOnOutsideClick
        className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] min-w-0 flex-col overflow-hidden sm:max-w-6xl"
      >
        <DialogHeader>
          <DialogTitle>{t("trajectoryInspectTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("trajectoryInspectTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {meta ? (
            <div className="mb-2 font-mono text-[11px] leading-5 text-(--text-muted)">
              {meta}
            </div>
          ) : null}
          {event.kind === "tool" ? (
            <ToolInspectBody event={event} />
          ) : showIo ? (
            <div className="flex min-w-0 flex-col gap-3 pb-1">
              <InspectSection
                label={
                  event.kind === "user"
                    ? t("trajectoryKindUser")
                    : t("trajectoryInspectArguments")
                }
                value={input}
              />
              {event.kind === "user" && output ? (
                <InspectSection
                  label={t("trajectoryInspectModelInput")}
                  value={output}
                />
              ) : null}
              {event.kind === "skill" && summary && summary !== output ? (
                <InspectSection label={t("trajectoryInspectSummary")} value={summary} />
              ) : null}
              {event.kind === "skill" ? (
                <InspectSection label={t("trajectoryInspectResult")} value={output} />
              ) : null}
            </div>
          ) : (
            <InspectSection value={input || event.body} />
          )}
          {event.usage ? (
            <div className="mt-3">
              <InspectSection
                label={t("trajectoryInspectUsage")}
                value={event.usage}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrajectoryPanel({
  messages = [],
  runtimeState = null,
  sessionId = "",
  harnessRevision = 0,
}) {
  const [showDuration, setShowDuration] = useState(true);
  const [showTurns, setShowTurns] = useState(true);
  const [showCalls, setShowCalls] = useState(true);
  const [turnFilter, setTurnFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [exportError, setExportError] = useState("");
  const [inspectEvent, setInspectEvent] = useState(null);
  const [harnessEpisodes, setHarnessEpisodes] = useState([]);
  const [harnessActivation, setHarnessActivation] = useState(null);
  const [harnessFetchStatus, setHarnessFetchStatus] = useState("idle");
  const [harnessFetchError, setHarnessFetchError] = useState("");
  const [toolReliability, setToolReliability] = useState([]);

  useEffect(() => {
    if (!sessionId) {
      setHarnessEpisodes([]);
      setHarnessActivation(null);
      setHarnessFetchStatus("idle");
      setHarnessFetchError("");
      return undefined;
    }
    let active = true;
    setHarnessFetchStatus("loading");
    setHarnessFetchError("");
    fetch(`/api/harness/episodes?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`请求失败（${response.status}）`);
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setHarnessEpisodes(Array.isArray(payload?.episodes) ? payload.episodes : []);
        setHarnessActivation(payload?.activation || null);
        setHarnessFetchStatus("success");
      })
      .catch((error) => {
        if (!active) return;
        setHarnessEpisodes([]);
        setHarnessActivation(null);
        setHarnessFetchStatus("error");
        setHarnessFetchError(String(error?.message || "任务决策助手轨迹请求失败"));
      });
    return () => { active = false; };
  }, [sessionId, harnessRevision]);

  useEffect(() => {
    let active = true;
    fetch("/api/harness/tool-reliability")
      .then((response) => (response.ok ? response.json() : { tools: [] }))
      .then((payload) => { if (active) setToolReliability(Array.isArray(payload?.tools) ? payload.tools : []); })
      .catch(() => { if (active) setToolReliability([]); });
    return () => { active = false; };
  }, [harnessEpisodes.length]);

  const built = useMemo(
    () =>
      buildTrajectory({
        messages,
        runtimeState,
      }),
    [messages, runtimeState],
  );

  const turnOptions = useMemo(() => {
    const seen = new Set();
    for (const event of built.events) {
      const turn = Number(event.turn);
      if (turn > 0) seen.add(turn);
    }
    return [...seen].sort((a, b) => a - b);
  }, [built.events]);

  const kindOptions = useMemo(() => {
    const seen = new Set(built.events.map((event) => event.kind));
    return Object.keys(KIND_I18N).filter((kind) => seen.has(kind));
  }, [built.events]);

  const harnessSummary = useMemo(
    () => summarizeHarness(harnessEpisodes, {
      fetchStatus: harnessFetchStatus,
      fetchError: harnessFetchError,
    }),
    [harnessEpisodes, harnessFetchStatus, harnessFetchError],
  );

  const activeTurn = turnOptions.includes(Number(turnFilter))
    ? Number(turnFilter)
    : null;
  const activeKind = kindOptions.includes(kindFilter) ? kindFilter : "";

  const visible = useMemo(
    () =>
      filterTrajectoryEvents(built.events, {
        query,
        includeCalls: showCalls,
        turn: activeTurn,
        kind: activeKind,
      }),
    [built.events, query, showCalls, activeTurn, activeKind],
  );

  const exportLog = () => {
    setExportError("");
    if (!sessionId) return;
    try {
      downloadJson(trajectoryExportFilename(sessionId, new Date()), {
        sessionId,
        exportedAt: new Date().toISOString(),
        metrics: built.metrics,
        events: built.events,
      });
    } catch {
      setExportError(t("trajectoryExportFailed"));
    }
  };

  const hasActiveFilters = Boolean(
    query || activeTurn != null || activeKind || !showCalls,
  );
  const resetFilters = () => {
    setQuery("");
    setTurnFilter("all");
    setKindFilter("all");
    setShowCalls(true);
  };

  let lastTurn = null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--border-default) px-3 py-2 sm:px-5">
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showDuration}
            onCheckedChange={(value) => setShowDuration(value === true)}
          />
          {t("trajectoryDuration")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showTurns}
            onCheckedChange={(value) => setShowTurns(value === true)}
          />
          {t("trajectoryTurns")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showCalls}
            onCheckedChange={(value) => setShowCalls(value === true)}
          />
          {t("trajectoryCalls")}
        </label>
        <Select
          value={activeTurn == null ? "all" : String(activeTurn)}
          onValueChange={(value) => value && setTurnFilter(value)}
        >
          <SelectTrigger
            className="h-8 min-w-[6.5rem] px-2.5 text-[12px]"
            aria-label={t("trajectoryFilterTurn")}
          >
            <SelectValue placeholder={t("trajectoryFilterAll")} />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">{t("trajectoryFilterAll")}</SelectItem>
            {turnOptions.map((turn) => (
              <SelectItem key={turn} value={String(turn)}>
                {t("trajectoryTurnLabel").replace("{{count}}", String(turn))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={activeKind || "all"}
          onValueChange={(value) => value && setKindFilter(value)}
        >
          <SelectTrigger
            className="h-8 min-w-[7.5rem] px-2.5 text-[12px]"
            aria-label={t("trajectoryFilterKind")}
          >
            <SelectValue placeholder={t("trajectoryFilterAll")} />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">{t("trajectoryFilterAll")}</SelectItem>
            {kindOptions.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(KIND_I18N[kind])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="shrink-0 font-mono text-[11px] text-(--text-muted)">
            {t("trajectoryEventCount")
              .replace("{{visible}}", String(visible.length))
              .replace("{{total}}", String(built.events.length))}
          </span>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={resetFilters}
              aria-label={t("trajectoryResetFilters")}
              title={t("trajectoryResetFilters")}
            >
              <X size={13} />
            </Button>
          ) : null}
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--text-muted)"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("trajectorySearchPlaceholder")}
              className="h-8 min-w-0 pl-7"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!sessionId}
            onClick={exportLog}
          >
            <Download size={13} />
            {t("trajectorySessionLog")}
          </Button>
        </div>
      </div>
      {exportError ? (
        <Alert variant="destructive" className="mx-3 mt-2 sm:mx-5">
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      ) : null}
      <section className="mx-3 mt-2 rounded border border-(--border-default) bg-(--bg-secondary)/40 px-3 py-3 text-[12px] sm:mx-5">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-(--text-primary)">任务决策助手实际效果</strong>
          <span className="text-[11px] text-(--text-muted)">
            {harnessSummary.fetchStatus === "error"
              ? `轨迹读取失败：${harnessSummary.fetchError || "未知错误"}`
              : harnessSummary.decisions.length
                ? `${harnessSummary.decisions.length} 次判断 · 成功 ${harnessSummary.counts.success} · 失败 ${harnessSummary.counts.failed} · 弃权 ${harnessSummary.counts.abstained} · ${harnessSummary.routes.length} 次路由 · ${harnessSummary.contextBlocks} 个上下文块`
                : harnessActivation
                  ? activationLabel(harnessActivation)
                  : "尚无历史决策记录"}
          </span>
          <span className="ml-auto text-[11px] text-(--text-muted)">
            {harnessFetchStatus === "loading" ? "正在读取…" : `${harnessEpisodes.length} 个历史 episode`}
          </span>
        </div>
        {harnessActivation ? (
          <div className="mt-2 text-[11px] text-(--text-muted)">
            当前配置资格：{activationLabel(harnessActivation)}。这只表示当前配置是否可能启用，不代表历史会话已经调用。
          </div>
        ) : null}
        {harnessSummary.decisions.length || harnessSummary.routes.length || harnessSummary.contexts.length ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[["完成概率", "TaskComplete"], ["测试通过", "TestPass"], ["重试收益", "RetryBenefit"], ["需求遗漏", "RequirementsMiss"], ["工具可靠", "ToolReliability"]].map(([label, node]) => (
                <div key={node} className="rounded bg-(--bg-primary) px-2 py-2">
                  <div className="text-[10px] text-(--text-muted)">{label}</div>
                  <div className="mt-0.5 font-mono text-[14px] text-(--text-primary)">{beliefPercent(harnessSummary.latestBelief, node)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-(--text-secondary)">
              {Object.entries(harnessSummary.actions).map(([action, count]) => (
                <span key={action} className="rounded-full border border-(--border-default) px-2 py-1 font-mono">{action}: {count}</span>
              ))}
              {harnessSummary.latestDecision?.payload?.policy?.reason ? <span className="rounded-full bg-(--accent-blue-bg) px-2 py-1">原因：{harnessSummary.latestDecision.payload.policy.reason}</span> : null}
            </div>
            {toolReliability.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-(--text-secondary)">查看工具可靠性与降权原因</summary>
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1">
                  {toolReliability.map((tool) => (
                    <div key={tool.tool_name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-(--border-default) px-2 py-1.5 font-mono text-[11px]">
                      <span className="text-(--text-primary)">{tool.tool_name}</span>
                      <span>可靠性 {Math.round(Number(tool.reliability || 0) * 100)}%</span>
                      <span>成功 {tool.successes} · 失败 {Number(tool.failures || 0) + Number(tool.timeouts || 0) + Number(tool.permission_errors || 0)}</span>
                      {tool.last_error ? <span className="text-(--text-muted)">最近原因：{tool.last_error}</span> : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-(--text-secondary)">查看每次判断与硬门禁</summary>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {harnessSummary.decisions.map((item, index) => {
                  const payload = item.payload || {};
                  const action = decisionAction(payload);
                  const belief = payload.belief || {};
                  const result = classifyDecision(item);
                  const provider = payload.provider || payload.decision?.provider || "—";
                  return <div key={item.id || index} className="rounded border border-(--border-default) px-2 py-2 font-mono text-[11px]">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-(--text-primary)">
                      <span>#{index + 1}</span><span>step {item.step ?? "—"}</span><span>动作: {action}</span><span>结果: {result.status === "success" ? "成功" : result.status === "failed" ? "失败" : "弃权"}</span><span>provider: {provider}</span>
                    </div>
                    <div className="mt-1 text-(--text-muted)">原因: {payload.policy?.reason || "—"} · 硬门禁: {hardGateLabel(payload)} · 重试收益: {Number.isFinite(Number(belief.RetryBenefit?.true)) ? `${Math.round(Number(belief.RetryBenefit.true) * 100)}%` : "—"}</div>
                    <div className="mt-1 break-words text-(--text-muted)">模型: {payload.decision?.modelVersion || payload.decision?.model || "—"} · Jev 错误: {result.errors.length ? result.errors.join("；") : "无"}</div>
                  </div>;
                })}
              </div>
            </details>
          </>
        ) : (
          <div className="mt-2 text-[11px] text-(--text-muted)">请在设置中开启任务决策助手，并让当前会话实际运行一步后，这里会显示概率、动作和触发原因。</div>
        )}
      </section>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-3 py-10 text-center text-[13px] text-(--text-muted) sm:px-5">
            {built.events.length === 0
              ? t("trajectoryEmpty")
              : t("noMatches")}
          </div>
        ) : (
          <ol className="min-w-0 px-3 py-3 sm:px-5">
            {visible.map((event) => {
              const showTurnHeader =
                showTurns && event.turn > 0 && event.turn !== lastTurn;
              lastTurn = event.turn;
              if (event.kind === "loop") {
                return (
                  <li key={event.id} className="min-w-0">
                    {showTurnHeader ? (
                      <div className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-(--text-muted)">
                        {t("trajectoryTurnLabel").replace(
                          "{{count}}",
                          String(event.turn),
                        )}
                      </div>
                    ) : null}
                    <div className="mt-2 mb-1 flex h-6 min-w-0 items-center gap-2 pl-4 text-[11px] font-medium tracking-wide text-(--text-muted)">
                      <span>
                        {t("trajectoryLoopLabel").replace(
                          "{{count}}",
                          String(event.loop || 1),
                        )}
                      </span>
                      {showDuration ? (
                        <span className="font-mono text-[11px] font-normal">
                          {formatTrajectoryDuration(event.durationMs)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              }
              return (
                <li key={event.id} className="min-w-0">
                  {showTurnHeader ? (
                    <div className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-(--text-muted)">
                      {t("trajectoryTurnLabel").replace(
                        "{{count}}",
                        String(event.turn),
                      )}
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "-mx-1 flex h-7 min-w-0 items-center gap-3 overflow-hidden rounded-md px-1 transition-colors hover:bg-(--bg-hover) focus-within:bg-(--bg-hover)",
                      event.loop > 0 && "pl-4",
                    )}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-(--text-muted)"
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "codemini-trajectory-kind w-[7.5rem] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold tracking-wide whitespace-nowrap",
                        event.status === "error" && event.kind !== "tool"
                          ? KIND_CLASS.error
                          : KIND_CLASS[event.kind] || KIND_CLASS.assistant,
                      )}
                    >
                      {kindLabel(event)}
                    </span>
                    <EventRow
                      event={event}
                      onInspect={() => setInspectEvent(event)}
                    />
                    {showDuration ? (
                      <span className="shrink-0 font-mono text-[11px] leading-5 text-(--text-muted)">
                        {formatTrajectoryDuration(event.durationMs)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <TrajectoryInspectDialog
        event={inspectEvent}
        onClose={() => setInspectEvent(null)}
      />
    </div>
  );
}
