import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Check,
  CopySimple,
  DotsSixVertical,
  Stop,
  Terminal as TerminalIcon,
  Trash,
  X,
} from "@phosphor-icons/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  clearTerminalSession,
  openTerminalStream,
  resizeTerminalSession,
  restartTerminalSession,
  stopTerminalCommand,
  writeTerminalInput,
} from "@/hooks/use-api.js";
import { t } from "../../i18n/index.js";

const DEFAULT_PANEL_WIDTH = 500;
const MIN_PANEL_WIDTH = 340;
const INPUT_BATCH_MS = 12;

function readTheme() {
  const styles = window.getComputedStyle(document.documentElement);
  const color = (name, fallback) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: color("--bg-primary", "#111113"),
    foreground: color("--text-secondary", "#d4d4d8"),
    cursor: color("--text-primary", "#fafafa"),
    cursorAccent: color("--bg-primary", "#111113"),
    selectionBackground: color("--accent-blue", "#2563eb") + "66",
    black: "#18181b",
    red: color("--accent-red", "#ef4444"),
    green: color("--accent-green", "#22c55e"),
    yellow: "#eab308",
    blue: color("--accent-blue", "#3b82f6"),
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#e4e4e7",
    brightBlack: "#71717a",
    brightWhite: "#fafafa",
  };
}

export function TerminalPanel({
  sessionId = "",
  projectCwd = "",
  disabled = false,
  embedded = false,
  onClose,
}) {
  const [shell, setShell] = useState("pwsh");
  const [cwd, setCwd] = useState(projectCwd || "");
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef(null);
  const inputChainRef = useRef(Promise.resolve());
  const resizingRef = useRef(false);

  const flushInput = useCallback(() => {
    inputTimerRef.current = null;
    const data = inputBufferRef.current;
    inputBufferRef.current = "";
    if (!data) return;
    inputChainRef.current = inputChainRef.current
      .catch(() => {})
      .then(() => writeTerminalInput(sessionId, data))
      .then((result) => {
        if (result?.ok === false) {
          throw new Error(result.error || t("terminalRunFailed"));
        }
      })
      .catch((nextError) => {
        setError(String(nextError?.message || t("terminalRunFailed")));
      });
  }, [sessionId]);

  const queueInput = useCallback(
    (data) => {
      inputBufferRef.current += data;
      if (inputTimerRef.current) return;
      inputTimerRef.current = window.setTimeout(flushInput, INPUT_BATCH_MS);
    },
    [flushInput],
  );

  const fitAndSync = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || disabled) return;
    try {
      fitAddon.fit();
      resizeTerminalSession(sessionId, terminal.cols, terminal.rows).catch(
        () => {},
      );
    } catch {
      // The panel can briefly have zero dimensions during responsive layout.
    }
  }, [disabled, sessionId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || disabled) return undefined;

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        '"Geist Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      minimumContrastRatio: 4.5,
      rightClickSelectsWord: true,
      screenReaderMode: true,
      scrollback: 5000,
      theme: readTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const helperTextarea = host.querySelector(".xterm-helper-textarea");
    helperTextarea?.setAttribute("aria-label", t("terminalInputLabel"));
    const inputDisposable = terminal.onData(queueInput);
    const resizeObserver = new ResizeObserver(() => fitAndSync());
    resizeObserver.observe(host);
    window.requestAnimationFrame(() => {
      fitAndSync();
      terminal.focus();
    });

    const source = openTerminalStream(sessionId);
    source.onopen = () => {
      setConnection("connected");
      setError("");
    };
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "snapshot" && data.snapshot) {
          terminal.reset();
          if (data.snapshot.data) terminal.write(data.snapshot.data);
          setShell(data.snapshot.shell || "pwsh");
          setCwd(data.snapshot.cwd || projectCwd || "");
          setConnection(
            data.snapshot.connected === false ? "disconnected" : "connected",
          );
          window.requestAnimationFrame(() => {
            fitAndSync();
            terminal.focus();
          });
          return;
        }
        if (data.type === "data" && data.data) {
          terminal.write(data.data);
          return;
        }
        if (data.type === "status") {
          setConnection(data.connected === false ? "disconnected" : "connected");
        }
      } catch {
        setError(t("terminalStreamError"));
      }
    };
    source.onerror = () => {
      setConnection("disconnected");
      setError(t("terminalDisconnected"));
    };

    return () => {
      source.close();
      resizeObserver.disconnect();
      inputDisposable.dispose();
      if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
      inputTimerRef.current = null;
      inputBufferRef.current = "";
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [disabled, fitAndSync, projectCwd, queueInput, sessionId]);

  const copyAll = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.selectAll();
    const text = terminal.getSelection();
    terminal.clearSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError(t("terminalCopyFailed"));
    } finally {
      terminal.focus();
    }
  }, []);

  const clearTerminal = useCallback(async () => {
    terminalRef.current?.clear();
    setError("");
    try {
      await clearTerminalSession(sessionId);
    } catch (nextError) {
      setError(String(nextError?.message || t("terminalRunFailed")));
    }
    terminalRef.current?.focus();
  }, [sessionId]);

  const restartTerminal = useCallback(async () => {
    terminalRef.current?.reset();
    setConnection("connecting");
    setError("");
    try {
      const result = await restartTerminalSession(sessionId);
      if (result?.ok === false) {
        throw new Error(result.error || t("terminalRunFailed"));
      }
      setConnection("connected");
    } catch (nextError) {
      setConnection("disconnected");
      setError(String(nextError?.message || t("terminalRunFailed")));
    }
    terminalRef.current?.focus();
  }, [sessionId]);

  const interruptTerminal = useCallback(async () => {
    try {
      await stopTerminalCommand(sessionId);
    } catch (nextError) {
      setError(String(nextError?.message || t("terminalRunFailed")));
    }
    terminalRef.current?.focus();
  }, [sessionId]);

  const updatePanelWidth = (clientX) => {
    const maxWidth = Math.max(
      MIN_PANEL_WIDTH,
      Math.floor(window.innerWidth * 0.72),
    );
    setPanelWidth(
      Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, window.innerWidth - clientX)),
    );
  };

  const statusLabel =
    connection === "connected"
      ? t("terminalConnected")
      : connection === "connecting"
        ? t("terminalConnecting")
        : t("terminalDisconnected");

  const content = (
    <>
      {!embedded ? (
        <div
          className="codemini-terminal-resizer absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize items-center justify-center max-md:hidden"
          role="separator"
          aria-label={t("terminalResize")}
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
          onPointerDown={(event) => {
            resizingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePanelWidth(event.clientX);
          }}
          onPointerMove={(event) => {
            if (resizingRef.current) updatePanelWidth(event.clientX);
          }}
          onPointerUp={(event) => {
            resizingRef.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setPanelWidth((value) => value + 24);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setPanelWidth((value) =>
                Math.max(MIN_PANEL_WIDTH, value - 24),
              );
            }
          }}
        >
          <DotsSixVertical size={12} weight="bold" />
        </div>
      ) : null}

      <div
        className={
          "flex shrink-0 items-center gap-2 border-b border-(--border-default) px-3 " +
          (embedded ? "h-10" : "h-12")
        }
      >
        <TerminalIcon size={15} className="text-(--text-muted)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-(--text-primary)">
            <span>{shell}</span>
            <span
              className={
                "size-1.5 rounded-full " +
                (connection === "connected"
                  ? "bg-(--accent-green)"
                  : connection === "connecting"
                    ? "bg-(--text-muted)"
                    : "bg-(--accent-red)")
              }
              aria-hidden="true"
            />
            <span className="sr-only">{statusLabel}</span>
          </div>
          <div
            className="truncate font-mono text-[11px] text-(--text-muted)"
            title={cwd}
          >
            {cwd || projectCwd || "—"}
          </div>
        </div>
        <button
          type="button"
          className="codemini-terminal-action"
          title={t("terminalCopy")}
          aria-label={t("terminalCopy")}
          onClick={copyAll}
        >
          {copied ? <Check size={14} /> : <CopySimple size={14} />}
        </button>
        <button
          type="button"
          className="codemini-terminal-action"
          title={t("terminalStop")}
          aria-label={t("terminalStop")}
          onClick={interruptTerminal}
        >
          <Stop size={14} weight="fill" />
        </button>
        <button
          type="button"
          className="codemini-terminal-action"
          title={t("terminalClear")}
          aria-label={t("terminalClear")}
          onClick={clearTerminal}
        >
          <Trash size={14} />
        </button>
        <button
          type="button"
          className="codemini-terminal-action"
          title={t("terminalRestart")}
          aria-label={t("terminalRestart")}
          onClick={restartTerminal}
        >
          <ArrowCounterClockwise size={14} />
        </button>
        {!embedded ? (
          <button
            type="button"
            className="codemini-terminal-action"
            title={t("close")}
            aria-label={t("close")}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {disabled ? (
        <div className="p-3 text-[12px] text-(--text-muted)">
          {t("terminalNeedsProject")}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="codemini-terminal-host min-h-0 flex-1"
          role="application"
          aria-label={t("terminalInputLabel")}
          onClick={() => terminalRef.current?.focus()}
        />
      )}

      <div className="sr-only" aria-live="polite">
        {statusLabel}
      </div>
      {error ? (
        <div
          className="shrink-0 border-t border-(--border-default) px-3 py-1.5 text-[11px] text-(--accent-red)"
          role="status"
        >
          {error}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
  }

  return (
    <aside
      className="codemini-terminal-panel relative flex shrink-0 flex-col border-l border-(--border-default) bg-(--bg-primary) min-h-0 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-full! max-md:shadow-xl"
      style={{ width: `${panelWidth}px` }}
      aria-label={t("terminalTitle")}
    >
      {content}
    </aside>
  );
}
