import { createCliRenderer, type InputRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import {
  buildMessageRows,
  buildUiMessagesFromSessionHistory,
  collapseActivityChainRows,
  formatSuggestionDescription,
  getCopy,
  getPendingUserMessageMeta,
  getSuggestionPageState,
  messageLabel,
  moveSuggestionSelection,
  normalizeDeleteApprovalRequest,
  normalizeRunApprovalRequest,
  parseDeleteApprovalAnswer,
  roleStyle,
  sanitizeRenderableText,
  shouldAppendAssistantResult,
  stripPlanExecutionResult
} from "../chat-app.js";
import {
  appendAssistantDelta,
  createBridgeState,
  startAssistantMessage,
  updateActivityOnAssistant
} from "../runtime-bridge.js";
import {
  getAnimatedStatusGlyph,
  getInlineStatusText,
  isBlankSystemMessage,
  shouldHideMessageBubble,
  shouldRenderPlainSystemNotice
} from "./presentation.js";

/* opentui uses lowercase compound: "brightcyan" not "cyanBright" */
function c(legacyColor: string): string {
  const map: Record<string, string> = {
    cyanBright: "brightcyan", redBright: "brightred", yellowBright: "brightyellow",
    magentaBright: "brightmagenta", blueBright: "brightblue", greenBright: "brightgreen",
    blackBright: "brightblack", whiteBright: "brightwhite",
    cyan: "cyan", red: "red", yellow: "yellow", magenta: "magenta",
    blue: "blue", green: "green", white: "white", black: "black", gray: "gray", grey: "grey",
  };
  return map[legacyColor] || legacyColor;
}

const BANNER = [
  ' ██████  ██████  ██████  ███████ ███    ███ ██ ███    ██ ██ ',
  '██      ██    ██ ██   ██ ██      ████  ████ ██ ████   ██ ██ ',
  '██      ██    ██ ██   ██ █████   ██ ████ ██ ██ ██ ██  ██ ██ ',
  '██      ██    ██ ██   ██ ██      ██  ██  ██ ██ ██  ██ ██ ██ ',
  ' ██████  ██████  ██████  ███████ ██      ██ ██ ██   ████ ██ '
];
/* opentui colors directly */
const BANNER_COLORS = ["brightmagenta", "brightred", "brightyellow", "brightcyan", "brightmagenta"];
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const APP_BACKGROUND = "#282a36";

function nextMessageIdFactory() {
  let id = 0;
  return () => { id += 1; return `otui-${id}`; };
}

function getSuggestionValue(item: any) { return typeof item === "string" ? item : String(item?.value || ""); }
function getSuggestionDisplay(item: any) { return typeof item === "string" ? item : String(item?.display || item?.value || ""); }
function getSuggestionDescription(item: any) { return typeof item === "string" ? "" : String(item?.description || ""); }

function buildStartupMessage(copy: any) {
  const hints = Array.isArray(copy?.generic?.startupHints) ? copy.generic.startupHints : [];
  return hints[0] || copy?.generic?.noMessagesYet || "";
}

function isDeleteKey(event: KeyEvent) {
  return Boolean(event?.name === "delete" || (event?.ctrl && event?.name === "d"));
}

function patchMessages(messages: any[], messageId: string, patch: any) {
  return messages.map((m: any) => {
    if (m.id !== messageId) return m;
    return typeof patch === "function" ? patch(m) : { ...m, ...patch };
  });
}

function appendPlainMessage(messages: any[], message: any) {
  return [...messages, message];
}

/* ─── Visual components ─── */

function StatusPill(props: { label: string; value: string; color: string; textColor: string }) {
  return (
    <box flexDirection="row" marginRight={1}>
      <text fg="gray">{`${props.label} `}</text>
      <text fg={props.textColor} bg={props.color}>{` ${props.value} `}</text>
    </box>
  );
}

function Banner(props: { sessionId: string; model: string; sdkProvider: string; shellName: string; safeMode: boolean }) {
  const shortSession = String(props.sessionId || "").slice(-12) || "-";
  const modeValue = props.safeMode ? "SAFE" : "OPEN";
  const modeColor = props.safeMode ? "brightgreen" : "brightred";
  const modeTextColor = props.safeMode ? "black" : "white";
  const sdkValue = String(props.sdkProvider || "openai-compatible");
  return (
    <box
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor="cyan"
      paddingX={4}
      paddingY={1}
      alignItems="center"
      marginBottom={2}
    >
      <For each={BANNER}>
        {(line, idx) => (
          <box justifyContent="center">
            <text fg={BANNER_COLORS[idx()]}>{line}</text>
          </box>
        )}
      </For>
      <box height={1} />
      <text fg="gray">{"optimized for small-model workflows"}</text>
      <box height={1} />
      <box flexDirection="row" justifyContent="center">
        <StatusPill label="SDK" value={sdkValue} color="brightblue" textColor="white" />
        <StatusPill label="MODEL" value={props.model} color="brightcyan" textColor="black" />
        <StatusPill label="SHELL" value={props.shellName || "powershell"} color="brightyellow" textColor="black" />
        <StatusPill label="SESSION" value={shortSession} color="brightmagenta" textColor="black" />
        <StatusPill label="MODE" value={modeValue} color={modeColor} textColor={modeTextColor} />
      </box>
    </box>
  );
}

function ContextProgressMeter(props: { runtimeState: any }) {
  const pct = createMemo(() => {
    const rs = props.runtimeState || {};
    const maxT = Number(rs.maxContextTokens || 0);
    const curT = Number(rs.currentContextTokens || 0);
    const pctRaw = Number.isFinite(rs.contextUsagePct) && rs.contextUsagePct >= 0
      ? rs.contextUsagePct
      : maxT > 0 ? (curT / maxT) * 100 : 0;
    return Math.min(100, Math.max(0, pctRaw));
  });
  const filled = createMemo(() => Math.min(12, Math.max(0, Math.round((pct() / 100) * 12))));
  const activeColor = createMemo(() => pct() < 40 ? "brightgreen" : pct() < 75 ? "brightyellow" : "brightred");
  const bars = createMemo(() => {
    const f = filled();
    const result: { color: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const zone = i < 5 ? "brightgreen" : i < 9 ? "brightyellow" : "brightred";
      result.push({ color: i < f ? zone : "gray" });
    }
    return result;
  });
  return (
    <box flexDirection="row" justifyContent="flex-end" alignItems="center" width={24} flexShrink={0}>
      <text fg="gray">{"上下文 "}</text>
      <text fg={activeColor()}>{`${Math.round(pct())}% `}</text>
      <For each={bars()}>{(b) => <text fg={b.color}>{"|"}</text>}</For>
    </box>
  );
}

function SignatureBar(props: { version: string }) {
  return (
    <box
      flexDirection="row"
      marginTop={1}
      justifyContent="space-between"
      backgroundColor={APP_BACKGROUND}
      shouldFill={true}
      zIndex={10}
    >
      <text fg="gray">{" "}</text>
      <box flexDirection="row">
        <text fg="gray">{"developed by "}</text>
        <text fg="brightmagenta">{"@havingautism"}</text>
      </box>
      <text fg="gray">{`v${props.version}`}</text>
    </box>
  );
}

function renderActivityRow(row: any, loaderTick: number) {
  const dot = row.status === "running" ? SPINNER_FRAMES[loaderTick % SPINNER_FRAMES.length]
    : row.status === "done" ? "●" : "○";
  const color = (row.status === "error" || row.status === "blocked") ? "brightred"
    : row.status === "done" ? "brightgreen" : "brightyellow";
  return (
    <box flexDirection="row">
      <text fg="gray">{" "}</text>
      <text fg={color}>{dot}</text>
      <text fg="brightcyan">{` ${row.name}`}</text>
      <Show when={row.summary}><text fg="gray">{` · ${row.summary}`}</text></Show>
    </box>
  );
}

function renderRow(row: any, index: number, loaderTick: number) {
  if (!row) return <text key={`e-${index}`} fg="gray"> </text>;
  if (row.kind === "activity")
    return <box key={`a-${index}`}>{renderActivityRow(row, loaderTick)}</box>;
  if (row.kind === "activity-summary" || row.kind === "activity-collapsed")
    return <box key={`s-${index}`} paddingLeft={2}><text fg="gray">{`└ ${row.text}`}</text></box>;
  if (row.kind === "todo-item") {
    const mk = row.status === "completed" ? "[✓]" : row.status === "in_progress" ? "[*]" : "[ ]";
    return (
      <box key={`t-${index}`} paddingLeft={2}>
        <text fg="gray">{`${mk} `}</text>
        <text fg={row.status === "in_progress" ? "white" : "gray"}>{row.text || row.activeForm || " "}</text>
      </box>
    );
  }
  if (row.kind === "todo-gap") return <text key={`g-${index}`} fg="gray"> </text>;
  if (row.kind === "status")
    return (
      <box key={`st-${index}`} paddingLeft={2} flexDirection="row">
        <text fg="gray">{row.text}</text>
        <text fg="white">{` ${getAnimatedStatusGlyph(loaderTick)}`}</text>
      </box>
    );
  if (row.kind === "table-vertical")
    return <box key={`tv-${index}`} paddingLeft={1}><text fg="brightcyan">{`${row.label}:`}</text><text fg="gray">{row.text ? ` ${row.text}` : ""}</text></box>;
  if (row.kind === "table-vertical-continuation" || row.kind === "table-vertical-separator")
    return <box key={`tvc-${index}`} paddingLeft={3}><text fg="gray">{row.text}</text></box>;
  if (["table","table-separator","quote","tree","code","code-placeholder"].includes(row.kind))
    return <box key={`tx-${index}`} paddingLeft={1}><text fg={row.color ? c(row.color) : "gray"}>{row.text}</text></box>;
  if (row.kind === "plan-progress") return null;
  return <box key={`gen-${index}`}><text fg={row.color ? c(row.color) : "white"}>{row.text || " "}</text></box>;
}

function SimpleMessageRow(props: any) {
  const theme = createMemo(() => roleStyle(props.message.label));
  const rows = createMemo(() =>
    collapseActivityChainRows(
      buildMessageRows(props.message, props.showToolDetails, props.contentWidth, props.copy),
      props.showToolDetails, props.copy
    )
  );
  if (isBlankSystemMessage(props.message)) return null;
  if (shouldRenderPlainSystemNotice(props.message, rows())) {
    const firstRow = rows()[0];
    return (
      <box marginBottom={1} paddingLeft={1}>
        <text fg={firstRow?.color ? c(firstRow.color) : "brightyellow"}>{firstRow?.text || props.message.text || " "}</text>
      </box>
    );
  }
  return (
    <box flexDirection="row" marginBottom={1} paddingLeft={1}>
      <text fg={c(theme().badgeText)} bg={c(theme().badgeBg)}>{` ${messageLabel(props.message.label, props.copy)} `}</text>
      <text fg="gray">{" "}</text>
      <For each={rows()}>
        {(row: any, idx: () => number) => renderRow(row, idx(), props.loaderTick)}
      </For>
    </box>
  );
}

function BorderedMessageBubble(props: any) {
  const theme = createMemo(() => roleStyle(props.message.label));
  const rows = createMemo(() =>
    collapseActivityChainRows(
      buildMessageRows(props.message, props.showToolDetails, props.contentWidth, props.copy),
      props.showToolDetails, props.copy
    )
  );
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      border={true}
      borderStyle="rounded"
      borderColor={c(theme().border)}
      paddingX={1}
    >
      <box flexDirection="row" marginBottom={1}>
        <text fg={c(theme().badgeText)} bg={c(theme().badgeBg)}>{` ${messageLabel(props.message.label, props.copy)} `}</text>
        <Show when={props.message.planStep}>
          <text fg="gray">{` ${props.message.planStep}`}</text>
        </Show>
      </box>
      <For each={rows()}>
        {(row: any, idx: () => number) => renderRow(row, idx(), props.loaderTick)}
      </For>
    </box>
  );
}

function MessageBubble(props: any) {
  const rows = createMemo(() =>
    collapseActivityChainRows(
      buildMessageRows(props.message, props.showToolDetails, props.contentWidth, props.copy),
      props.showToolDetails, props.copy
    )
  );
  if (shouldHideMessageBubble(props.message, rows())) return null;
  const isSimple = createMemo(() =>
    (props.message.label === "system" || props.message.label === "error") && rows().length <= 1
  );
  return (
    <Show when={isSimple()} fallback={<BorderedMessageBubble {...props} />}>
      <SimpleMessageRow {...props} />
    </Show>
  );
}

function SuggestionPanel(props: any) {
  if (!props.items || props.items.length === 0) return null;
  const page = createMemo(() => getSuggestionPageState(props.items, props.menuIndex, 8));
  return (
    <box
      flexDirection="column"
      marginTop={1}
      border={true}
      borderStyle="rounded"
      borderColor="magenta"
      paddingX={1}
      paddingY={0}
    >
      <box marginBottom={1} flexDirection="row">
        <text fg="brightmagenta">{props.copy.generic.commandPaletteGroupedSuggestions}</text>
        <text fg="gray">{`  ${page().pageIndex + 1}/${page().pageCount}`}</text>
      </box>
      <For each={page().pageItems}>
        {(item: any, idx: () => number) => {
          const active = props.menuIndex === page().pageStart + idx();
          return (
            <box flexDirection="row">
              <text fg={active ? "black" : "brightmagenta"} bg={active ? "brightmagenta" : undefined}>
                {`${active ? " > " : "   "}${getSuggestionDisplay(item)}`}
              </text>
              <Show when={getSuggestionDescription(item)}>
                <text fg={active ? "black" : "gray"} bg={active ? "brightmagenta" : undefined}>
                  {`  ${formatSuggestionDescription(getSuggestionDescription(item), 42)}`}
                </text>
              </Show>
            </box>
          );
        }}
      </For>
    </box>
  );
}

function DeleteApprovalPanel(props: any) {
  if (!props.request) return null;
  const r = props.request;
  const typeLabel = r.type === "directory" ? props.copy.deleteApproval.directoryType : props.copy.deleteApproval.fileType;
  const pathDisplay = (r.path?.includes("/") || r.path?.includes("\\")) ? r.path : `./${r.path}`;
  return (
    <box
      marginTop={1} flexDirection="column"
      border={true} borderStyle="rounded" borderColor="brightred"
      paddingX={1} paddingY={0}
    >
      <text fg="brightred">{props.copy.deleteApproval.title}</text>
      <text fg="white">{`${props.copy.deleteApproval.nameLabel}: ${r.name || ""}`}</text>
      <text fg="white">{`${props.copy.deleteApproval.pathLabel}: ${pathDisplay}`}</text>
      <text fg="white">{`${props.copy.deleteApproval.typeLabel}: ${typeLabel}`}</text>
      <text fg="gray">{props.copy.deleteApproval.prompt}</text>
      <Show when={props.errorText}><text fg="brightyellow">{props.errorText}</text></Show>
    </box>
  );
}

function RunApprovalPanel(props: any) {
  if (!props.request) return null;
  const r = props.request;
  const cc = props.copy.runApproval || {};
  const riskColor = r.risk === "low" ? "green" : r.risk === "medium" ? "yellow" : "brightred";
  const borderColor = r.risk === "medium" ? "yellow" : "brightred";
  const riskLabel = r.risk === "low" ? cc.lowRisk : r.risk === "medium" ? cc.mediumRisk : cc.highRisk;
  return (
    <box
      marginTop={1} flexDirection="column"
      border={true} borderStyle="rounded" borderColor={borderColor}
      paddingX={1} paddingY={0}
    >
      <text fg={borderColor}>{cc.title}</text>
      <text fg="white">{`${cc.commandLabel}: ${r.command || ""}`}</text>
      <text fg="white">{`${cc.riskLabel}: `}</text>
      <text fg={riskColor}>{riskLabel || r.risk}</text>
      <Show when={r.description}><text fg="gray">{`${cc.descriptionLabel}: ${r.description}`}</text></Show>
      <text fg="gray">{cc.prompt}</text>
      <Show when={props.errorText}><text fg="brightyellow">{props.errorText}</text></Show>
    </box>
  );
}

function PendingPanel(props: any) {
  if (!props.queue || props.queue.length === 0) return null;
  return (
    <box
      flexDirection="column"
      border={true} borderStyle="rounded" borderColor="cyan"
      paddingX={1} paddingY={0}
    >
      <text fg="brightcyan">{`${props.copy.generic.pendingQueue} | ${props.queue.length}`}</text>
      <For each={props.queue.slice(0, 3)}>
        {(p: any) => <text fg="cyan">{`- ${typeof p === "string" ? p : p.line}`}</text>}
      </For>
    </box>
  );
}

/* ─── Main App ─── */

export function App(props: any) {
  const copy = getCopy(props.language);
  const nextId = nextMessageIdFactory();
  const initialMessages = buildUiMessagesFromSessionHistory(props.sessionMessages || [], nextId);
  const [messages, setMessages] = createSignal(
    initialMessages.length > 0 ? initialMessages : [{
      id: nextId(), label: "system", text: buildStartupMessage(copy), color: "brightyellow"
    }]
  );
  const [inputValue, setInputValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [streaming, setStreaming] = createSignal(false);
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal<number | null>(null);
  const [historyMatches, setHistoryMatches] = createSignal<string[]>([]);
  const [draftBeforeHistory, setDraftBeforeHistory] = createSignal("");
  const [pendingQueue, setPendingQueue] = createSignal<any[]>([]);
  const [showToolDetails, setShowToolDetails] = createSignal(false);
  const [loaderTick, setLoaderTick] = createSignal(0);
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [suggestionNav, setSuggestionNav] = createSignal(false);
  const [pendingDeleteApproval, setPendingDeleteApproval] = createSignal<any>(null);
  const [pendingRunApproval, setPendingRunApproval] = createSignal<any>(null);
  const [approvalError, setApprovalError] = createSignal("");
  const [activeAssistantId, setActiveAssistantId] = createSignal<string | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true);
  const [runtimeStatus, setRuntimeStatus] = createSignal<any>(null);
  const [runtimeState, setRuntimeState] = createSignal<any>(null);

  const dimensions = useTerminalDimensions();
  const commandSuggestions = createMemo(() =>
    inputValue().startsWith("/") && !pendingDeleteApproval() && !pendingRunApproval()
      ? props.runtime.getCompletionOptions(inputValue()) || []
      : []
  );
  const messageWidth = createMemo(() => Math.max(24, dimensions().width - 8));
  const footerPanelHeight = createMemo(() => {
    let height = 0;
    if (commandSuggestions().length > 0) {
      const page = getSuggestionPageState(commandSuggestions(), menuIndex(), 8);
      height += 3 + Math.min(8, page.pageItems.length);
    }
    if (pendingQueue().length > 0) height += 2 + Math.min(3, pendingQueue().length);
    if (pendingDeleteApproval()) height += 7;
    if (pendingRunApproval()) height += 7;
    return height;
  });
  const fixedFooterHeight = createMemo(() => 1 + footerPanelHeight() + 6 + 2);
  const scrollHeight = createMemo(() =>
    Math.max(6, Number(dimensions().height || 24) - fixedFooterHeight())
  );
  let scrollRef: ScrollBoxRenderable | undefined;
  let inputRef: InputRenderable | undefined;
  let deleteApprovalResolver: any = null;
  let runApprovalResolver: any = null;

  const syncHistory = async () => {
    if (typeof props.runtime.getInputHistory !== "function") return;
    const items = await props.runtime.getInputHistory();
    setHistory(Array.isArray(items) ? items : []);
  };

  const applyBridge = (transform: any) => {
    const next = transform({ messages: messages(), activeAssistantId: activeAssistantId() });
    setMessages(next.messages);
    setActiveAssistantId(next.activeAssistantId);
    return next;
  };

  const patchMessage = (messageId: string, patch: any) => {
    if (!messageId) return;
    setMessages((prev) => patchMessages(prev, messageId, patch));
  };

  const ensureAssistant = () => {
    if (activeAssistantId()) return activeAssistantId();
    const messageId = nextId();
    applyBridge((state: any) => startAssistantMessage(state, { messageId, label: "coder" }));
    patchMessage(messageId, { loading: true });
    return messageId;
  };

  const finalizeAssistant = () => {
    const currentId = activeAssistantId();
    if (!currentId) return;
    patchMessage(currentId, { loading: false, phase: undefined, liveStatus: undefined });
    setActiveAssistantId(null);
  };

  const scrollToBottom = () => { if (scrollRef) scrollRef.scrollTo(scrollRef.scrollHeight); };

  const queueSubmission = (line: string, messageId: string) => {
    setPendingQueue((prev) => [...prev, { line, messageId }]);
    patchMessage(messageId, { loading: true, phase: "queued", liveStatus: copy.runtime.queuedWaiting });
  };

  const appendSystemMessage = (text: string, label = "system", color = "brightyellow") => {
    setMessages((prev) => appendPlainMessage(prev, {
      id: nextId(), label, text: sanitizeRenderableText(text), color
    }));
  };

  const handleResult = (result: any, userMessageId: string) => {
    patchMessage(userMessageId, { loading: false, phase: undefined, liveStatus: undefined });
    if (result?.type === "exit") { props.onExit(); return; }
    if (result?.aborted) { appendSystemMessage(copy.runtime.responseStopped); return; }
    if (!shouldAppendAssistantResult(result, activeAssistantId(), false)) return;

    if (result?.type === "assistant" && result.text) {
      const targetId = activeAssistantId();
      const cleaned = stripPlanExecutionResult(String(result.text || "")).trim();
      if (targetId) {
        patchMessage(targetId, (m: any) => {
          const nextText = cleaned || String(m.text || "");
          return { ...m, text: nextText, segments: nextText ? [{ type: "text", text: nextText }] : m.segments || [], loading: false };
        });
      } else if (cleaned) {
        setMessages((prev) => appendPlainMessage(prev, { id: nextId(), label: "coder", text: cleaned, color: "brightgreen" }));
      }
    } else if (result?.type === "system" && result.text) {
      appendSystemMessage(result.text);
    } else if (result?.text) {
      appendSystemMessage(result.text, "coder", "brightgreen");
    }
  };

  const processQueue = () => {
    const queue = pendingQueue();
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setPendingQueue(rest);
    runSubmission(next.line, next.messageId);
  };

  const handleEvent = (event: any) => {
    if (event?.type === "assistant:start") { ensureAssistant(); return; }
    if (event?.type === "assistant:delta") { setStreaming(false); ensureAssistant(); applyBridge((s: any) => appendAssistantDelta(s, event.text || "")); return; }
    if (event?.type === "assistant:response") {
      const targetId = activeAssistantId();
      if (targetId && event.text) {
        const cleaned = stripPlanExecutionResult(String(event.text || "")).trim();
        if (cleaned) patchMessage(targetId, (m: any) => ({ ...m, text: cleaned, segments: [{ type: "text", text: cleaned }] }));
      }
      return;
    }
    if (["tool:start","tool:end","tool:error","tool:blocked"].includes(event?.type)) {
      ensureAssistant();
      applyBridge((s: any) => updateActivityOnAssistant(s, {
        type: "tool", id: event.id, name: event.name,
        status: event.type === "tool:start" ? "running" : event.type === "tool:end" ? "done" : event.type === "tool:blocked" ? "blocked" : "error",
        summary: event.summary, arguments: event.arguments, durationMs: event.durationMs
      }));
      return;
    }
    if (["system_tool:start","system_tool:end","system_tool:error"].includes(event?.type)) {
      ensureAssistant();
      applyBridge((s: any) => updateActivityOnAssistant(s, {
        type: "system_tool", id: event.id, name: event.name,
        status: event.type === "system_tool:start" ? "running" : event.type === "system_tool:end" ? "done" : "error",
        summary: event.summary
      }));
      return;
    }
    if (["skill:start","skill:end","skill:error"].includes(event?.type)) {
      ensureAssistant();
      applyBridge((s: any) => updateActivityOnAssistant(s, {
        type: "skill", name: event.name,
        status: event.type === "skill:start" ? "running" : event.type === "skill:end" ? "done" : "error",
        summary: event.summary
      }));
      return;
    }
    if (event?.type === "compact:auto") appendSystemMessage(copy.runtime.autoCompactTriggered(event.mode, event.threshold));
    if (event?.type === "dream:auto") appendSystemMessage(copy.runtime.dreamAutoTriggered, "system", "brightmagenta");
    if (event?.type === "dream:complete") appendSystemMessage(copy.runtime.dreamCompleted, "system", "brightgreen");
    if (event?.type === "runtime:status") setRuntimeStatus(event.status || null);
    if (event?.type === "runtime:state") setRuntimeState(event.state || null);
  };

  const runSubmission = (line: string, userMessageId: string) => {
    setBusy(true);
    setStreaming(true);
    setApprovalError("");
    props.runtime.submit(line, handleEvent)
      .then((result: any) => handleResult(result, userMessageId))
      .catch((error: any) => {
        patchMessage(userMessageId, { loading: false, phase: undefined, liveStatus: undefined });
        appendSystemMessage(error?.message || String(error), "error", "brightred");
      })
      .finally(() => { finalizeAssistant(); setBusy(false); setStreaming(false); syncHistory(); processQueue(); });
  };

  const submitCurrentInput = () => {
    const raw = inputValue().trim();
    if (!raw) return;
    if (pendingDeleteApproval()) {
      const answer = parseDeleteApprovalAnswer(raw);
      if (answer !== "approve" && answer !== "deny") { setApprovalError(copy.deleteApproval.invalidAnswer); return; }
      const resolver = deleteApprovalResolver;
      deleteApprovalResolver = null;
      setPendingDeleteApproval(null); setApprovalError(""); setInputValue("");
      if (resolver) resolver({ approved: answer === "approve" });
      return;
    }
    if (pendingRunApproval()) {
      const answer = parseDeleteApprovalAnswer(raw);
      if (answer !== "approve" && answer !== "deny") { setApprovalError(copy.runApproval.invalidAnswer); return; }
      const resolver = runApprovalResolver;
      runApprovalResolver = null;
      setPendingRunApproval(null); setApprovalError(""); setInputValue("");
      if (resolver) resolver({ approved: answer === "approve" });
      return;
    }
    const messageId = nextId();
    const immediateLocal = typeof props.runtime.isImmediateLocalInput === "function" && props.runtime.isImmediateLocalInput(raw);
    const pendingMeta = getPendingUserMessageMeta(copy, { immediateLocal, inFlight: busy() });
    setMessages((prev) => appendPlainMessage(prev, {
      id: messageId, label: "you", text: raw, color: "white",
      loading: true, phase: pendingMeta.phase, liveStatus: pendingMeta.liveStatus
    }));
    setHistory((prev) => [...prev, raw]);
    setHistoryIndex(null); setHistoryMatches([]); setDraftBeforeHistory("");
    setInputValue(""); setSuggestionNav(false);
    if (busy() && !immediateLocal) { queueSubmission(raw, messageId); return; }
    runSubmission(raw, messageId);
  };

  let loaderTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    if (loaderTimer) { clearInterval(loaderTimer); loaderTimer = null; }
    if (streaming()) {
      loaderTimer = setInterval(() => setLoaderTick((t) => t + 1), 120);
    }
  });

  onMount(() => {
    syncHistory();
    const startupActivities = props.runtime.consumeStartupEvents?.() || [];
    if (Array.isArray(startupActivities) && startupActivities.length > 0) {
      setMessages((prev) => appendPlainMessage(prev, {
        id: nextId(), label: "system", text: "", color: "brightyellow",
        toolCalls: startupActivities, segments: startupActivities
      }));
    }
    if (typeof props.runtime.setRequestToolApproval === "function") {
      props.runtime.setRequestToolApproval((request: any) => {
        const del = normalizeDeleteApprovalRequest(request);
        if (del) {
          setPendingDeleteApproval(del); setPendingRunApproval(null);
          setApprovalError(""); setInputValue("");
          return new Promise((resolve) => { deleteApprovalResolver = resolve; });
        }
        const run = normalizeRunApprovalRequest(request);
        if (run) {
          setPendingRunApproval(run); setPendingDeleteApproval(null);
          setApprovalError(""); setInputValue("");
          return new Promise((resolve) => { runApprovalResolver = resolve; });
        }
        return Promise.resolve({ approved: false });
      });
      onCleanup(() => { props.runtime.setRequestToolApproval(null); });
    }
  });

  createEffect(() => {
    messages();
    if (pinnedToBottom()) setTimeout(() => scrollToBottom(), 0);
  });

  useKeyboard((event: KeyEvent) => {
    if (event.ctrl && event.name === "c") {
      if (busy() && typeof props.runtime.abort === "function") { props.runtime.abort(); return; }
      props.onExit(); return;
    }
    if (event.ctrl && event.name === "t") { setShowToolDetails((p) => !p); return; }
    if (!scrollRef) return;
    if (event.name === "pageup") { scrollRef.scrollBy(-Math.max(1, Math.floor(scrollRef.height / 2))); setPinnedToBottom(false); return; }
    if (event.name === "pagedown") { scrollRef.scrollBy(Math.max(1, Math.floor(scrollRef.height / 2))); return; }
    if (event.name === "home") { scrollRef.scrollTo(0); setPinnedToBottom(false); return; }
    if (event.name === "end") { scrollToBottom(); setPinnedToBottom(true); }
  });

  const handleInputKey = (event: KeyEvent) => {
    if (event.name === "up") {
      if (suggestionNav() && commandSuggestions().length > 0) {
        event.preventDefault();
        setMenuIndex((p) => moveSuggestionSelection(p, commandSuggestions().length, "up"));
        return;
      }
      const items = history();
      if (items.length === 0) return;
      const ci = historyIndex();
      if (ci === null) {
        const matches = items.filter((it) => it.toLowerCase().startsWith(inputValue().toLowerCase())).reverse();
        if (matches.length === 0) return;
        event.preventDefault();
        setDraftBeforeHistory(inputValue()); setHistoryMatches(matches); setHistoryIndex(0); setInputValue(matches[0]);
        return;
      }
      const matches = historyMatches();
      if (matches.length === 0) return;
      event.preventDefault();
      const next = Math.min(matches.length - 1, ci + 1);
      setHistoryIndex(next); setInputValue(matches[next]);
      return;
    }
    if (event.name === "down") {
      if (suggestionNav() && commandSuggestions().length > 0) {
        event.preventDefault();
        setMenuIndex((p) => moveSuggestionSelection(p, commandSuggestions().length, "down"));
        return;
      }
      const ci = historyIndex();
      if (ci === null) return;
      event.preventDefault();
      const next = ci - 1;
      if (next < 0) { setHistoryIndex(null); setHistoryMatches([]); setInputValue(draftBeforeHistory()); return; }
      setHistoryIndex(next); setInputValue(historyMatches()[next] || "");
      return;
    }
    if (event.name === "left" && suggestionNav() && commandSuggestions().length > 0) {
      event.preventDefault(); setMenuIndex((p) => moveSuggestionSelection(p, commandSuggestions().length, "left")); return;
    }
    if (event.name === "right" && suggestionNav() && commandSuggestions().length > 0) {
      event.preventDefault(); setMenuIndex((p) => moveSuggestionSelection(p, commandSuggestions().length, "right")); return;
    }
    if (event.name === "tab" && commandSuggestions().length > 0) {
      event.preventDefault();
      if (!suggestionNav()) { setSuggestionNav(true); setMenuIndex(0); return; }
      setInputValue(getSuggestionValue(commandSuggestions()[Math.min(menuIndex(), commandSuggestions().length - 1)]));
      setSuggestionNav(false); return;
    }
    if (isDeleteKey(event) && inputValue().length === 0 && busy() && typeof props.runtime.abort === "function") {
      props.runtime.abort();
    }
  };

  const deleteRequest = createMemo(() => pendingDeleteApproval());
  const runRequest = createMemo(() => pendingRunApproval());

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      height={dimensions().height}
      overflow="hidden"
      backgroundColor={APP_BACKGROUND}
      shouldFill={true}
    >
      <scrollbox
        ref={(ref: ScrollBoxRenderable) => { scrollRef = ref; }}
        stickyScroll={true}
        stickyStart="bottom"
        height={scrollHeight()}
        maxHeight={scrollHeight()}
        flexGrow={0}
        flexShrink={0}
        minHeight={6}
        overflow="hidden"
        viewportCulling={true}
        rootOptions={{ overflow: "hidden", height: scrollHeight(), maxHeight: scrollHeight() }}
        wrapperOptions={{ overflow: "hidden", height: scrollHeight(), maxHeight: scrollHeight() }}
        viewportOptions={{ overflow: "hidden", height: scrollHeight(), maxHeight: scrollHeight() }}
        contentOptions={{ overflow: "hidden" }}
        zIndex={0}
      >
        <Banner
          sessionId={props.sessionId}
          model={props.model}
          sdkProvider={props.sdkProvider}
          shellName={props.shellName}
          safeMode={props.safeMode}
        />
        <For each={messages().filter((message: any) => !isBlankSystemMessage(message))}>
          {(message: any) => (
            <MessageBubble
              message={message}
              loaderTick={loaderTick()}
              showToolDetails={showToolDetails()}
              contentWidth={messageWidth()}
              copy={copy}
            />
          )}
        </For>
      </scrollbox>
      <box
        flexDirection="row"
        justifyContent="space-between"
        width={Math.max(1, dimensions().width - 2)}
        height={1}
        flexGrow={0}
        flexShrink={0}
        flexWrap="no-wrap"
        overflow="hidden"
        backgroundColor={APP_BACKGROUND}
        shouldFill={true}
        zIndex={10}
      >
        <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          <text fg="gray">{`${showToolDetails() ? copy.generic.toolSummaryExpanded : copy.generic.toolSummaryCollapsed} (Ctrl+T)`}</text>
          <text fg="gray">{"  ·  "}</text>
          <text fg={streaming() ? "brightgreen" : "gray"}>
            {`${getInlineStatusText({ busy: busy(), copy })}${streaming() ? ` ${SPINNER_FRAMES[loaderTick() % SPINNER_FRAMES.length]}` : ""}`}
          </text>
        </box>
        <ContextProgressMeter runtimeState={runtimeState()} />
      </box>
      <SuggestionPanel items={commandSuggestions()} menuIndex={menuIndex()} copy={copy} />
      <PendingPanel queue={pendingQueue()} copy={copy} />
      <DeleteApprovalPanel request={deleteRequest()} errorText={approvalError()} copy={copy} />
      <RunApprovalPanel request={runRequest()} errorText={approvalError()} copy={copy} />
      <box
        marginTop={1}
        border={true}
        borderStyle="rounded"
        borderColor="cyan"
        backgroundColor={APP_BACKGROUND}
        shouldFill={true}
        paddingX={1}
        paddingY={0}
        height={5}
        flexGrow={0}
        flexShrink={0}
        zIndex={10}
      >
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row">
            <text fg="gray">{copy.suggestion.singleTab}</text>
          </box>
          <Show when={pendingQueue().length > 0}>
            <text fg="brightcyan">{`${copy.generic.queued} ${pendingQueue().length}`}</text>
          </Show>
        </box>
        <box flexDirection="row">
          <text fg="cyan">{"codemini> "}</text>
          <box flexGrow={1}>
            <input
              ref={(ref: InputRenderable) => { inputRef = ref; }}
              focused={true}
              flexGrow={1}
              width="100%"
              value={inputValue()}
              placeholder={
                pendingDeleteApproval() ? copy.deleteApproval.inputLocked
                  : pendingRunApproval() ? copy.runApproval.inputLocked
                    : ""
              }
              onInput={(value: string) => {
                setInputValue(value);
                if (suggestionNav()) setSuggestionNav(false);
                setApprovalError("");
              }}
              onKeyDown={handleInputKey}
              onSubmit={() => submitCurrentInput()}
            />
          </box>
        </box>
      </box>
      <SignatureBar version={props.version} />
    </box>
  );
}

export async function startOpenTui(props: any) {
  return new Promise<void>(async (resolve) => {
    const renderer = await createCliRenderer({
      externalOutputMode: "passthrough",
      targetFps: 60,
      exitOnCtrlC: false,
      autoFocus: true,
      useMouse: true,
      onDestroy: () => resolve()
    });
    await render(() => <App {...props} onExit={() => renderer.destroy()} />, renderer);
  });
}
