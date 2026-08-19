import { useMemo, useState } from "react";
import { Download, MagnifyingGlass } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  buildTrajectory,
  filterTrajectoryEvents,
  formatTrajectoryDuration,
  trajectoryExportFilename,
  truncateTrajectoryText,
} from "@/lib/session-trajectory.js";
import { t } from "../../i18n/index.js";

const KIND_CLASS = {
  system: "bg-(--bg-secondary) text-(--text-muted)",
  user: "bg-(--accent-blue-bg) text-(--accent-blue)",
  context: "bg-(--accent-green-bg) text-(--accent-green)",
  assistant: "bg-(--accent-purple-bg) text-(--accent-purple)",
  tool: "bg-(--accent-orange-bg) text-(--accent-orange)",
  skill: "bg-(--accent-teal-bg) text-(--accent-teal)",
};

const KIND_I18N = {
  system: "trajectoryKindSystem",
  user: "trajectoryKindUser",
  context: "trajectoryKindContext",
  assistant: "trajectoryKindAssistant",
  tool: "trajectoryKindTool",
  skill: "trajectoryKindSkill",
};

function kindLabel(kind) {
  return t(KIND_I18N[kind] || "trajectoryKindAssistant");
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function EventBody({ event, expanded, onToggle }) {
  const raw = event.kind === "tool"
    ? [event.body, event.preview].filter(Boolean).join("\n")
    : event.body;
  const needsTruncate = String(raw || "").length > 240;
  const shown = expanded || !needsTruncate ? raw : truncateTrajectoryText(raw);
  return (
    <div className="min-w-0 flex-1">
      {event.title && event.kind !== "user" && event.kind !== "system" && event.kind !== "context" ? (
        <div className="mb-0.5 font-mono text-[12px] text-(--text-primary)">{event.title}</div>
      ) : null}
      {shown ? (
        <pre className="m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-(--text-secondary)">
          {shown}
        </pre>
      ) : null}
      {needsTruncate ? (
        <button
          type="button"
          className="mt-1 border-0 bg-transparent p-0 text-[11px] text-(--text-muted) hover:text-(--text-primary)"
          onClick={onToggle}
        >
          {expanded ? t("trajectoryCollapse") : t("trajectoryExpand")}
        </button>
      ) : null}
    </div>
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
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [exportError, setExportError] = useState("");

  const built = useMemo(
    () => buildTrajectory({ messages, runtimeState, projectCwd, isGeneral }),
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          <div className="relative w-44 sm:w-56">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--text-muted)"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("trajectorySearchPlaceholder")}
              className="h-8 pl-7"
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
      <ScrollArea className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="px-3 py-10 text-center text-[13px] text-(--text-muted) sm:px-5">
            {t("trajectoryEmpty")}
          </div>
        ) : (
          <ol className="px-3 py-3 sm:px-5">
            {visible.map((event) => {
              const showTurnHeader =
                showTurns && event.turn > 0 && event.turn !== lastTurn;
              lastTurn = event.turn;
              return (
                <li key={event.id}>
                  {showTurnHeader ? (
                    <div className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-(--text-muted)">
                      {t("trajectoryTurnLabel").replace(
                        "{{count}}",
                        String(event.turn),
                      )}
                    </div>
                  ) : null}
                  <div className="flex items-start gap-3 py-1.5">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-(--text-muted)"
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "mt-0.5 w-[88px] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold tracking-wide",
                        KIND_CLASS[event.kind] || KIND_CLASS.assistant,
                      )}
                    >
                      {kindLabel(event.kind)}
                    </span>
                    <EventBody
                      event={event}
                      expanded={expandedIds.has(event.id)}
                      onToggle={() => {
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(event.id)) next.delete(event.id);
                          else next.add(event.id);
                          return next;
                        });
                      }}
                    />
                    {showDuration ? (
                      <span className="shrink-0 font-mono text-[11px] text-(--text-muted)">
                        {formatTrajectoryDuration(event.durationMs)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </ScrollArea>
    </div>
  );
}
