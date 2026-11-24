import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchAgentTerminals } from "@/hooks/use-api.js";
import { isActiveAgentCommand } from "@/lib/workspace-tabs.js";
import { t } from "../../i18n/index.js";

export function AgentTerminalPanel({ sessionId, command }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(false);
  const outputRef = useRef(null);
  const followOutput = useRef(true);
  const { id } = command;

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const result = await fetchAgentTerminals(sessionId, { id, signal: controller.signal });
        if (controller.signal.aborted || !isActiveAgentCommand(result.command)) return;
        setSnapshot((current) => current?.revision === result.command.revision ? current : result.command);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 450);
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, sessionId]);

  const output = snapshot?.output || "";
  useLayoutEffect(() => {
    const viewport = outputRef.current;
    if (viewport && followOutput.current) viewport.scrollTop = viewport.scrollHeight;
  }, [output]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-(--border-default) px-3 py-2.5">
        <div className="flex items-baseline gap-3">
          <code className="min-w-0 flex-1 truncate text-[12px] text-(--text-primary)" title={command.command}>{command.command}</code>
          <span role="status" className="shrink-0 text-[11px] text-(--text-muted)">{t("terminalRunning")}</span>
        </div>
        <div className="mt-1 truncate text-[11px] text-(--text-muted)" title={command.cwd}>{command.cwd}</div>
      </div>
      <div
        ref={outputRef}
        role="region"
        tabIndex={0}
        aria-label={t("agentTerminalOutput")}
        className="min-h-0 flex-1 overflow-auto px-3 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent-blue)"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followOutput.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32;
        }}
      >
        {error ? <div className="mb-2 text-[12px] text-(--accent-red)" role="status">{t("terminalStreamError")}</div> : null}
        {output ? <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-(--text-secondary)">{output}</pre> : (
          <p className="text-[12px] text-(--text-muted)">{t("agentTerminalWaiting")}</p>
        )}
      </div>
    </div>
  );
}
