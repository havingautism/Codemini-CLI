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
const PANEL_WIDTH_KEY = "codemini:terminal-panel-width";
const INPUT_BATCH_MS = 12;
const RESIZE_SYNC_MS = 120;

function getInitialPanelWidth() {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
  const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
  return Number.isFinite(stored)
    ? clampPanelWidth(stored)
    : DEFAULT_PANEL_WIDTH;
}

function clampPanelWidth(width) {
  if (typeof window === "undefined") {
    return Math.max(MIN_PANEL_WIDTH, width);
  }
  const maxWidth = Math.max(
    MIN_PANEL_WIDTH,
    Math.floor(window.innerWidth * 0.72),
  );
  return Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, width));
}

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
  onClose,
}) {
  const [shell, setShell] = useState("pwsh");
  const [cwd, setCwd] = useState(projectCwd || "");
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [panelWidth, setPanelWidth] = useState(getInitialPanelWidth);
  const [panelResizing, setPanelResizing] = useState(false);
  const hostRef = useRef(null);
  const panelElRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef(null);
  const inputChainRef = useRef(Promise.resolve());
  const resizeSyncTimerRef = useRef(null);
  const lastSyncedSizeRef = useRef({ cols: 0, rows: 0 });
  const panelResizingRef = useRef(false);
  const livePanelWidthRef = useRef(panelWidth);
  const panelResizeRef = useRef({
    startX: 0,
    startWidth: DEFAULT_PANEL_WIDTH,
  });

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
    // Skip xterm reflow while the user is dragging the panel width.
    if (!terminal || !fitAddon || disabled || panelResizingRef.current) return;
    try {
      fitAddon.fit();
      if (resizeSyncTimerRef.current) {
        window.clearTimeout(resizeSyncTimerRef.current);
      }
      resizeSyncTimerRef.current = window.setTimeout(() => {
        resizeSyncTimerRef.current = null;
        const size = { cols: terminal.cols, rows: terminal.rows };
        const previous = lastSyncedSizeRef.current;
        if (size.cols === previous.cols && size.rows === previous.rows) return;
        lastSyncedSizeRef.current = size;
        resizeTerminalSession(sessionId, size.cols, size.rows).catch(() => {});
      }, RESIZE_SYNC_MS);
    } catch {
      // The panel can briefly have zero dimensions during responsive layout.
    }
  }, [disabled, sessionId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || disabled) return undefined;

    // A new browser terminal maps to a different server-side PTY. Its default
    // size must be synchronized even when it matches the previous UI terminal.
    lastSyncedSizeRef.current = { cols: 0, rows: 0 };

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
      if (resizeSyncTimerRef.current) {
        window.clearTimeout(resizeSyncTimerRef.current);
      }
      inputTimerRef.current = null;
      resizeSyncTimerRef.current = null;
      inputBufferRef.current = "";
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [disabled, fitAndSync, projectCwd, queueInput, sessionId]);

  useEffect(() => {
    livePanelWidthRef.current = panelWidth;
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

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

  const handlePanelResizeStart = useCallback(
    (event) => {
      event.preventDefault();
      panelResizingRef.current = true;
      livePanelWidthRef.current = panelWidth;
      setPanelResizing(true);
      panelResizeRef.current = {
        startX: event.clientX,
        startWidth: panelWidth,
      };

      const handleMove = (moveEvent) => {
        const delta = panelResizeRef.current.startX - moveEvent.clientX;
        const nextWidth = clampPanelWidth(
          panelResizeRef.current.startWidth + delta,
        );
        livePanelWidthRef.current = nextWidth;
        if (panelElRef.current) {
          panelElRef.current.style.width = `${nextWidth}px`;
        }
      };

      const handleEnd = () => {
        panelResizingRef.current = false;
        const nextWidth = livePanelWidthRef.current;
        setPanelWidth(nextWidth);
        setPanelResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleEnd);
        window.requestAnimationFrame(() => fitAndSync());
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleEnd);
    },
    [fitAndSync, panelWidth],
  );

  const statusLabel =
    connection === "connected"
      ? t("terminalConnected")
      : connection === "connecting"
        ? t("terminalConnecting")
        : t("terminalDisconnected");

  return (
    <aside
      ref={panelElRef}
      className="codemini-terminal-panel relative flex shrink-0 flex-col border-l border-(--border-default) bg-(--bg-primary) min-h-0 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-full! max-md:shadow-xl"
      style={{
        width: `${panelResizing ? livePanelWidthRef.current : panelWidth}px`,
      }}
      aria-label={t("terminalTitle")}
    >
      <div
        className="codemini-terminal-resizer absolute inset-y-0 left-0 z-10 -translate-x-1/2 max-md:hidden"
        role="separator"
        aria-label={t("terminalResize")}
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuenow={panelWidth}
        tabIndex={0}
        onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
        onMouseDown={handlePanelResizeStart}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setPanelWidth((value) => clampPanelWidth(value + 24));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setPanelWidth((value) => clampPanelWidth(value - 24));
          }
        }}
      >
        <span className="codewiki-resizer-handle">
          <DotsSixVertical size={14} aria-hidden="true" />
        </span>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-(--border-default) px-3">
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
        <button
          type="button"
          className="codemini-terminal-action"
          title={t("close")}
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
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
      {panelResizing && <div className="codemini-terminal-resize-overlay" />}
    </aside>
  );
}
