import { useMemo, useState } from "react";
import { Download, MagnifyingGlass } from "@phosphor-icons/react";
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
import { ToolCard } from "@/components/ToolCard.jsx";
import { cn } from "@/lib/utils";
import {
  buildTrajectory,
  filterTrajectoryEvents,
  formatTrajectoryDuration,
  formatTrajectoryRowPreview,
  stringifyTrajectoryValue,
  trajectoryExportFilename,
} from "@/lib/session-trajectory.js";
import { t } from "../../i18n/index.js";

const KIND_CLASS = {
  system: "bg-(--bg-secondary) text-(--text-muted)",
  user: "bg-(--accent-blue-bg) text-(--accent-blue)",
  context: "bg-(--accent-green-bg) text-(--accent-green)",
  thinking: "bg-(--accent-purple-bg) text-(--accent-purple)",
  assistant: "bg-(--accent-purple-bg) text-(--accent-purple)",
  tool: "bg-(--accent-orange-bg) text-(--accent-orange)",
  skill: "bg-(--accent-teal-bg) text-(--accent-teal)",
};

const KIND_I18N = {
  system: "trajectoryKindSystem",
  user: "trajectoryKindUser",
  context: "trajectoryKindContext",
  thinking: "trajectoryKindThinking",
  assistant: "trajectoryKindAssistant",
  tool: "trajectoryKindTool",
  skill: "trajectoryKindSkill",
};

function kindLabel(kind) {
  return t(KIND_I18N[kind] || "trajectoryKindAssistant");
}

function isInspectable(event) {
  return ["system", "context", "thinking", "assistant", "tool", "skill"].includes(event?.kind);
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
          className="shrink-0 border-0 bg-transparent p-0 text-[11px] leading-5 text-(--accent-blue) opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:opacity-80"
          onClick={onInspect}
        >
          {t("trajectoryInspect")}
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
        <div className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-[0.4px] text-(--text-muted)">
          {label}
        </div>
      ) : null}
      <pre className="m-0 max-h-[min(60vh,32rem)] overflow-auto whitespace-pre-wrap break-words rounded-md bg-(--bg-tertiary) p-3 font-mono text-xs leading-relaxed text-(--text-primary) dark:bg-(--bg-primary)">
        {text}
      </pre>
    </section>
  );
}

function TrajectoryInspectDialog({ event, onClose }) {
  if (!event) return null;
  const input = event.input || (event.kind !== "tool" ? event.body : "");
  const output = event.output || (event.kind === "tool" ? event.preview : "");
  const summary = event.kind === "tool" || event.kind === "skill" ? event.preview : "";
  const showIo = event.kind === "skill";
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
          {event.kind === "tool" ? (
            <ToolCard
              card={cardFromTrajectoryEvent(event)}
              collapsible={false}
              conversationVisual={false}
            />
          ) : showIo ? (
            <div className="min-w-0 pb-1">
              <InspectSection label={t("trajectoryInspectArguments")} value={input} />
              {summary && summary !== output ? (
                <InspectSection label={t("trajectoryInspectSummary")} value={summary} />
              ) : null}
              <InspectSection label={t("trajectoryInspectResult")} value={output} />
            </div>
          ) : (
            <InspectSection value={input || event.body} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrajectoryPanel({
  messages = [],
  runtimeState = null,
  projectCwd = "",
  isGeneral = false,
  sessionId = "",
}) {
  const [showDuration, setShowDuration] = useState(true);
  const [showTurns, setShowTurns] = useState(true);
  const [showCalls, setShowCalls] = useState(true);
  const [query, setQuery] = useState("");
  const [exportError, setExportError] = useState("");
  const [inspectEvent, setInspectEvent] = useState(null);

  const built = useMemo(
    () =>
      buildTrajectory({
        messages,
        runtimeState,
        projectCwd,
        isGeneral,
      }),
    [messages, runtimeState, projectCwd, isGeneral],
  );

  const visible = useMemo(
    () =>
      filterTrajectoryEvents(built.events, {
        query,
        includeCalls: showCalls,
      }),
    [built.events, query, showCalls],
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

  let lastTurn = null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--border-default) px-3 py-2 sm:px-5">
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showDuration}
            onCheckedChange={(value) => setShowDuration(value === true)}
          />
          {t("trajectoryDuration").replace(
            "{{value}}",
            formatTrajectoryDuration(built.metrics.durationMs),
          )}
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showTurns}
            onCheckedChange={(value) => setShowTurns(value === true)}
          />
          {t("trajectoryTurns").replace("{{count}}", String(built.metrics.turns))}
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <Checkbox
            checked={showCalls}
            onCheckedChange={(value) => setShowCalls(value === true)}
          />
          {t("trajectoryCalls").replace("{{count}}", String(built.metrics.calls))}
        </label>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 w-36 sm:w-56">
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
                      "flex h-7 min-w-0 items-center gap-3 overflow-hidden",
                      event.loop > 0 && "pl-4",
                    )}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-(--text-muted)"
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "w-[88px] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold tracking-wide",
                        KIND_CLASS[event.kind] || KIND_CLASS.assistant,
                      )}
                    >
                      {kindLabel(event.kind)}
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
