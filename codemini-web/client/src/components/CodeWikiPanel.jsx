import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n/index.js";
import {
  ArrowClockwise,
  BookOpenText,
  ChatText,
  CircleNotch,
  DotsSixVertical,
  DotsThree,
  FileText,
  Network,
  PaperPlaneRight,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  deleteCodeWikiReport,
  fetchCodeWikiReportText,
  fetchCodeWikiSymbolGraph,
  fetchCodeWikiReports,
  generateCodeWikiReport,
  streamCodeWikiAsk,
} from "@/hooks/use-api.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { MessageBubble } from "@/components/MessageBubble.jsx";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  applyStreamEventToMessage,
  finishStreamingTextSegments,
  isTranscriptStreamEvent,
} from "../../../shared/transcript-segments.js";

const CODEWIKI_QA_WIDTH_KEY = "codemini:codewiki:qa-width";
const CODEWIKI_QA_MIN_WIDTH = 320;
const CODEWIKI_QA_MAX_WIDTH = 760;
const CODEWIKI_QA_DEFAULT_WIDTH = 420;
const CODEWIKI_GENERATION_POLL_MS = 4000;
const CODEWIKI_SYMBOL_GRAPH_ENABLED = false;

function getInitialQaWidth() {
  if (typeof window === "undefined") return CODEWIKI_QA_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(CODEWIKI_QA_WIDTH_KEY));
  return Number.isFinite(stored)
    ? Math.min(CODEWIKI_QA_MAX_WIDTH, Math.max(CODEWIKI_QA_MIN_WIDTH, stored))
    : CODEWIKI_QA_DEFAULT_WIDTH;
}

function getGenerationDepths() {
  return [
    { value: "fast", label: t("generationDepthFast") },
    { value: "standard", label: t("generationDepthStandard") },
    { value: "deep", label: t("generationDepthDeep") },
  ];
}

function getGenerationFormats() {
  return [
    { value: "html", label: t("reportFormatHtml") },
    { value: "md", label: t("reportFormatMd") },
  ];
}

function formatReportDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildGraphLayout(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const columns = Math.max(
    1,
    Math.min(nodes.length <= 6 ? 3 : 5, nodes.length),
  );
  const nodeWidth = 188;
  const nodeHeight = 64;
  const colWidth = 250;
  const rowHeight = 132;
  const width = Math.max(520, columns * colWidth + 80);
  const height = Math.max(
    380,
    Math.ceil(nodes.length / columns) * rowHeight + 120,
  );
  const positioned = nodes.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      nodeWidth,
      nodeHeight,
      x: Math.round(40 + colWidth * col + colWidth / 2),
      y: 76 + row * rowHeight,
    };
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const visibleEdges = edges
    .map((edge) => ({
      ...edge,
      sourceNode: byId.get(edge.source),
      targetNode: byId.get(edge.target),
    }))
    .filter((edge) => edge.sourceNode && edge.targetNode);
  return { width, height, nodes: positioned, edges: visibleEdges };
}

function SymbolGraphView({ graph, loading, error, onRefresh }) {
  const [selectedId, setSelectedId] = useState("");
  const layout = useMemo(() => buildGraphLayout(graph), [graph]);
  const selected =
    layout.nodes.find((node) => node.id === selectedId) ||
    layout.nodes[0] ||
    null;

  useEffect(() => {
    if (!layout.nodes.length) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!selectedId || !layout.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(layout.nodes[0].id);
    }
  }, [layout.nodes, selectedId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-(--text-muted)">
        <CircleNotch size={16} className="mr-2 animate-spin" />
        Loading code graph
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <WarningCircle size={28} className="text-(--text-muted)" />
        <p className="mt-3 text-[13px] text-(--text-secondary)">{error}</p>
        <button
          className="mt-4 h-8 rounded-md border border-(--border-default) px-3 text-[12px] text-(--text-primary) hover:bg-(--bg-hover)"
          onClick={onRefresh}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!layout.nodes.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <Network size={30} className="text-(--text-muted)" />
        <p className="mt-3 text-[13px] text-(--text-secondary)">
          No symbols indexed yet.
        </p>
        <button
          className="mt-4 h-8 rounded-md border border-(--border-default) px-3 text-[12px] text-(--text-primary) hover:bg-(--bg-hover)"
          onClick={onRefresh}
        >
          Refresh graph
        </button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 grid grid-cols-[minmax(0,1fr)_320px] bg-(--bg-secondary)">
      <div className="min-w-0 min-h-0 overflow-auto p-6">
        <svg
          className="block max-w-none"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Code symbol graph"
        >
          <defs>
            <marker
              id="codewiki-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--text-muted)" />
            </marker>
          </defs>
          {layout.edges.map((edge, index) => {
            const sx = edge.sourceNode.x;
            const sy = edge.sourceNode.y;
            const tx = edge.targetNode.x;
            const ty = edge.targetNode.y;
            const midY = (sy + ty) / 2;
            return (
              <path
                key={`${edge.source}-${edge.target}-${edge.kind}-${index}`}
                d={`M ${sx} ${sy + 24} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty - 24}`}
                fill="none"
                stroke={
                  edge.kind === "calls"
                    ? "var(--accent-blue)"
                    : "var(--text-muted)"
                }
                strokeOpacity="0.42"
                strokeWidth="1.4"
                markerEnd="url(#codewiki-arrow)"
              />
            );
          })}
          {layout.nodes.map((node) => {
            const active = node.id === selected?.id;
            const fill =
              node.type === "class"
                ? "var(--accent-purple-bg)"
                : node.type === "method"
                  ? "var(--accent-blue-bg)"
                  : "var(--bg-primary)";
            return (
              <g
                key={node.id}
                transform={`translate(${node.x - node.nodeWidth / 2} ${node.y - node.nodeHeight / 2})`}
                className="cursor-pointer"
                onClick={() => setSelectedId(node.id)}
              >
                <rect
                  width={node.nodeWidth}
                  height={node.nodeHeight}
                  rx="8"
                  fill={fill}
                  stroke={
                    active ? "var(--text-primary)" : "var(--border-default)"
                  }
                  strokeWidth={active ? 2 : 1}
                />
                <text
                  x="12"
                  y="23"
                  fill="var(--text-primary)"
                  fontSize="12"
                  fontWeight="600"
                >
                  {String(node.label || "").slice(0, 20)}
                </text>
                <text x="12" y="42" fill="var(--text-muted)" fontSize="10">
                  {String(
                    `${node.type} 路 ${String(node.file || "")
                      .split("/")
                      .pop()}`,
                  ).slice(0, 28)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <aside className="min-h-0 border-l border-(--border-default) bg-(--bg-primary) p-4 overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-(--text-muted)">
              Code Graph
            </p>
            <p className="mt-1 text-[11px] text-(--text-muted)">
              {graph?.stats?.displayed_nodes || 0} nodes 路{" "}
              {graph?.stats?.displayed_edges || 0} edges
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
            onClick={onRefresh}
            aria-label="Refresh graph"
          >
            <ArrowClockwise size={14} />
          </button>
        </div>
        {selected && (
          <div className="mt-5">
            <h2 className="break-words text-[15px] font-semibold text-(--text-primary)">
              {selected.label}
            </h2>
            <p className="mt-1 break-words text-[12px] text-(--text-muted)">
              {selected.file}:{selected.range?.start_line || "?"}-
              {selected.range?.end_line || "?"}
            </p>
            {selected.signature && (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3 text-[11px] leading-5 text-(--text-secondary)">
                {selected.signature}
              </pre>
            )}
            {[
              ["Calls", selected.calls],
              ["Called by", selected.called_by],
              ["Writes", selected.writes],
              ["Emits", selected.emits],
              ["Imports", selected.imports],
            ].map(([label, values]) => (
              <div key={label} className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
                  {label}
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {(Array.isArray(values) && values.length
                    ? values
                    : ["None"]
                  ).map((value) => (
                    <span
                      key={`${label}-${value}`}
                      className="rounded-md border border-(--border-default) bg-(--bg-secondary) px-2 py-1 text-[11px] text-(--text-secondary)"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function applyCodeWikiEventToMessage(message, event) {
  if (isTranscriptStreamEvent(event?.type)) {
    return applyStreamEventToMessage(message, event, {
      finishThinkingBeforeText: false,
    });
  }
  switch (event?.type) {
    case "codewiki:done":
      return {
        ...message,
        loading: false,
        segments: finishStreamingTextSegments(message.segments),
      };
    case "codewiki:error":
      return {
        ...message,
        role: "error",
        loading: false,
        segments: [
          {
            type: "text",
            text: event.message || t("codewikiFailed"),
            isStreaming: false,
          },
        ],
      };
    default:
      return message;
  }
}

export function CodeWikiPanel({
  projectCwd,
  projectKey,
  busy,
  planSteps = [],
  stageLabel = "",
  generationStatus = { status: "idle", updatedAt: null, error: "" },
}) {
  const [reports, setReports] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [activeDoc, setActiveDoc] = useState("report");
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [symbolGraph, setSymbolGraph] = useState(null);
  const [localGenerating, setLocalGenerating] = useState(false);
  const [manifestSettledGeneration, setManifestSettledGeneration] =
    useState(false);
  const [error, setError] = useState("");
  const [frameError, setFrameError] = useState(false);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [sawRuntimeBusy, setSawRuntimeBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingReport, setDeletingReport] = useState(false);
  const [generationDepth, setGenerationDepth] = useState("standard");
  const [generationFormat, setGenerationFormat] = useState("html");
  const [markdownReport, setMarkdownReport] = useState({
    file: "",
    text: "",
    loading: false,
    error: "",
  });
  const [chatMessages, setChatMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const [qaWidth, setQaWidth] = useState(getInitialQaWidth);
  const [qaResizing, setQaResizing] = useState(false);
  const chatScrollRef = useRef(null);
  const generationStartedAtRef = useRef(0);
  const qaResizeRef = useRef({
    startX: 0,
    startWidth: CODEWIKI_QA_DEFAULT_WIDTH,
  });

  const selected = useMemo(
    () => reports.find((report) => report.file === selectedFile) || null,
    [reports, selectedFile],
  );
  const selectedFormat = String(
    selected?.format ||
      (selected?.file?.toLowerCase().endsWith(".md") ? "md" : "html"),
  ).toLowerCase();
  const selectedIsMarkdown = selectedFormat === "md";
  const generationState = generationStatus?.status || "idle";
  const generationRunning = generationState === "running";
  const generationDone = generationState === "done";
  const generationError = generationState === "error";
  const generating =
    (localGenerating || generationRunning) && !manifestSettledGeneration;

  const reportUrl = selected
    ? `/api/codewiki/report/${encodeURIComponent(selected.file)}${projectKey ? `?project=${encodeURIComponent(projectKey)}` : ""}`
    : "";

  const loadSymbolGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError("");
    try {
      const data = await fetchCodeWikiSymbolGraph(projectKey);
      setSymbolGraph(data);
      if (data?.error) setGraphError(data.error);
    } catch (err) {
      setGraphError(err?.message || "Failed to load code graph");
    } finally {
      setGraphLoading(false);
    }
  }, [projectKey]);

  const loadReports = useCallback(
    async ({ preferNewest = false, silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const data = await fetchCodeWikiReports(projectKey);
        const rawReports = Array.isArray(data?.reports) ? data.reports : [];
        const nextReports = [...rawReports].sort(
          (a, b) => new Date(b.mtime || 0) - new Date(a.mtime || 0),
        );
        setReports(nextReports);
        setSelectedFile((current) => {
          if (preferNewest && nextReports[0]) return nextReports[0].file;
          if (nextReports.some((report) => report.file === current))
            return current;
          return nextReports[0]?.file || "";
        });
        return nextReports;
      } catch (err) {
        setError(err?.message || t("failedToLoad"));
        return [];
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectKey],
  );

  useEffect(() => {
    setReports([]);
    setSelectedFile("");
    setActiveDoc("report");
    setFrameError(false);
    setQuestion("");
    setLastQuestion("");
    generationStartedAtRef.current = 0;
    setLocalGenerating(false);
    setSawRuntimeBusy(false);
    setManifestSettledGeneration(false);
    setMarkdownReport({ file: "", text: "", loading: false, error: "" });
    setChatMessages([]);
    setAsking(false);
    setSymbolGraph(null);
    setGraphError("");
    loadReports({ preferNewest: true });
    if (CODEWIKI_SYMBOL_GRAPH_ENABLED) loadSymbolGraph();
  }, [loadReports, loadSymbolGraph, projectKey]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [chatMessages, asking]);

  useEffect(() => {
    if (generationRunning) {
      setLocalGenerating(true);
      setSawRuntimeBusy(true);
      setError("");
    }
  }, [generationRunning]);

  useEffect(() => {
    if (!generationDone) return;
    loadReports({ preferNewest: true });
    generationStartedAtRef.current = 0;
    setLocalGenerating(false);
    setSawRuntimeBusy(false);
    setManifestSettledGeneration(false);
  }, [generationDone, loadReports]);

  useEffect(() => {
    if (!generationError) return;
    generationStartedAtRef.current = 0;
    setLocalGenerating(false);
    setSawRuntimeBusy(false);
    setManifestSettledGeneration(false);
    if (generationStatus?.error) setError(generationStatus.error);
  }, [generationError, generationStatus?.error]);

  useEffect(() => {
    if (!localGenerating || busy || generationRunning || !sawRuntimeBusy)
      return;
    loadReports({ preferNewest: true });
    generationStartedAtRef.current = 0;
    setLocalGenerating(false);
    setSawRuntimeBusy(false);
    setManifestSettledGeneration(true);
  }, [busy, generationRunning, loadReports, localGenerating, sawRuntimeBusy]);

  useEffect(() => {
    if (!localGenerating) return undefined;

    let cancelled = false;
    const isReportFromCurrentRun = (report) => {
      const startedAt = generationStartedAtRef.current;
      if (!startedAt || !report) return true;
      const reportTime = new Date(
        report.manifestUpdatedAt || report.mtime || 0,
      ).getTime();
      return Number.isFinite(reportTime) && reportTime >= startedAt - 2000;
    };
    const isTerminalStatus = (status) =>
      ["completed", "failed", "aborted"].includes(
        String(status || "").toLowerCase(),
      );

    const poll = async () => {
      const nextReports = await loadReports({
        preferNewest: true,
        silent: true,
      });
      if (cancelled) return;
      const newest = Array.isArray(nextReports) ? nextReports[0] : null;
      if (
        newest &&
        isReportFromCurrentRun(newest) &&
        isTerminalStatus(newest.manifestStatus)
      ) {
        generationStartedAtRef.current = 0;
        setLocalGenerating(false);
        setSawRuntimeBusy(false);
        setManifestSettledGeneration(true);
        if (String(newest.manifestStatus).toLowerCase() === "failed") {
          setError(t("reportLoadFailed"));
        }
      }
    };

    const timer = window.setInterval(poll, CODEWIKI_GENERATION_POLL_MS);
    poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadReports, localGenerating]);

  useEffect(() => {
    if (!selected || !selectedIsMarkdown) {
      setMarkdownReport({ file: "", text: "", loading: false, error: "" });
      return;
    }

    let cancelled = false;
    setMarkdownReport({
      file: selected.file,
      text: "",
      loading: true,
      error: "",
    });

    fetchCodeWikiReportText(selected.file, projectKey)
      .then((text) => {
        if (cancelled) return;
        setMarkdownReport({
          file: selected.file,
          text,
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setMarkdownReport({
          file: selected.file,
          text: "",
          loading: false,
          error: err?.message || t("reportLoadFailed"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectKey, selected?.file, selectedIsMarkdown]);

  useEffect(() => {
    window.localStorage.setItem(CODEWIKI_QA_WIDTH_KEY, String(qaWidth));
  }, [qaWidth]);

  const handleQaResizeStart = useCallback(
    (event) => {
      event.preventDefault();
      setQaResizing(true);
      qaResizeRef.current = {
        startX: event.clientX,
        startWidth: qaWidth,
      };

      const handleMove = (moveEvent) => {
        const delta = qaResizeRef.current.startX - moveEvent.clientX;
        const viewportMax = Math.max(
          CODEWIKI_QA_MIN_WIDTH,
          Math.min(CODEWIKI_QA_MAX_WIDTH, window.innerWidth - 720),
        );
        const nextWidth = Math.min(
          viewportMax,
          Math.max(
            CODEWIKI_QA_MIN_WIDTH,
            qaResizeRef.current.startWidth + delta,
          ),
        );
        setQaWidth(nextWidth);
      };

      const handleEnd = () => {
        setQaResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleEnd);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleEnd);
    },
    [qaWidth],
  );

  const handleGenerate = async () => {
    if (busy || generating) return;
    setError("");
    setLocalGenerating(true);
    setSawRuntimeBusy(false);
    setManifestSettledGeneration(false);
    generationStartedAtRef.current = Date.now();
    try {
      const result = await generateCodeWikiReport(
        generationDepth,
        projectKey,
        generationFormat,
      );
      if (result?.error) {
        generationStartedAtRef.current = 0;
        setLocalGenerating(false);
        setSawRuntimeBusy(false);
        setManifestSettledGeneration(false);
        setError(result.message || t("failedToStart"));
      }
    } catch (err) {
      generationStartedAtRef.current = 0;
      setLocalGenerating(false);
      setSawRuntimeBusy(false);
      setManifestSettledGeneration(false);
      setError(err?.message || t("failedToStart"));
    }
  };

  const handleAsk = async (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isWorking || asking) return;
    const now = Date.now();
    const assistantId = `cw-assistant-${now}`;
    setLastQuestion(trimmed);
    setQuestion("");
    setError("");
    setChatMessages((current) => [
      ...current,
      {
        id: `cw-user-${now}`,
        role: "you",
        text: trimmed,
        segments: [{ type: "text", text: trimmed, isStreaming: false }],
        timestamp: new Date().toISOString(),
      },
      {
        id: assistantId,
        role: "codewiki",
        text: "",
        segments: [],
        timestamp: new Date().toISOString(),
        loading: true,
      },
    ]);
    setAsking(true);
    const recentHistory = chatMessages
      .filter((m) => (m.role === "you" || m.role === "codewiki") && !m.loading)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text || "" }));
    try {
      await streamCodeWikiAsk({
        question: trimmed,
        reportFile: selected?.file || "",
        project: projectKey,
        history: recentHistory,
        onEvent: (streamEvent) => {
          setChatMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? applyCodeWikiEventToMessage(message, streamEvent)
                : message,
            ),
          );
        },
      });
    } catch (err) {
      setChatMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                role: "error",
                loading: false,
                segments: [
                  {
                    type: "text",
                    text: err?.message || t("codewikiFailed"),
                    isStreaming: false,
                  },
                ],
              }
            : message,
        ),
      );
    } finally {
      setAsking(false);
    }
  };

  const confirmDeleteReport = async () => {
    if (!pendingDelete) return;
    setDeletingReport(true);
    setError("");
    try {
      const result = await deleteCodeWikiReport(pendingDelete.file, projectKey);
      if (result?.error) {
        setError(result.message || t("failedToDelete"));
      } else {
        setPendingDelete(null);
        setFrameError(false);
        await loadReports({ preferNewest: false });
      }
    } catch (err) {
      setError(err?.message || t("failedToDelete"));
    } finally {
      setDeletingReport(false);
    }
  };

  const isWorking =
    generating || (busy && !manifestSettledGeneration && !generationDone);
  const askInputLocked = isWorking || asking;

  return (
    <div className="flex-1 min-h-0 bg-(--bg-primary) rounded-[18px] border border-(--border-default) border-b-0 overflow-hidden my-1 mx-1">
      <div
        className="codewiki-layout h-full min-h-0"
        style={{ "--codewiki-qa-width": `${qaWidth}px` }}
      >
        <aside className="border-r border-(--border-default) bg-(--bg-secondary) min-h-0 flex flex-col max-lg:hidden">
          <div className="p-4 border-b border-(--border-default)">
            <div className="flex items-center gap-2 text-(--text-primary)">
              <BookOpenText size={18} />
              <span className="font-semibold text-[15px]">CodeWiki</span>
            </div>
            <p
              className="mt-2 text-[12px] leading-5 text-(--text-muted) truncate"
              title={projectCwd || ""}
            >
              {projectCwd || t("currentProject")}
            </p>
            {false && (
              <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
                {getGenerationDepths().map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      "h-7 rounded-md text-[12px] text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-60",
                      generationDepth === item.value &&
                        "bg-(--bg-active) text-(--text-primary)",
                    )}
                    disabled={isWorking}
                    onClick={() => setGenerationDepth(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
              {getGenerationFormats().map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={cn(
                    "h-7 rounded-md text-[12px] text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-60",
                    generationFormat === item.value &&
                      "bg-(--bg-active) text-(--text-primary)",
                  )}
                  disabled={isWorking}
                  onClick={() => setGenerationFormat(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              className="mt-3 w-full h-9 rounded-lg border border-(--border-default) bg-(--bg-primary) text-[13px] text-(--text-primary) inline-flex items-center justify-center gap-2 hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleGenerate}
              disabled={isWorking}
            >
              {generating ? (
                <CircleNotch size={15} className="animate-spin" />
              ) : (
                <Sparkle size={15} />
              )}
              {generating ? t("generating") : t("generateNew")}
            </button>
            {/* {generating && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5">
                <CircleNotch size={14} className="animate-spin shrink-0 text-(--text-muted)" />
                <span className="text-[12px] text-(--text-secondary) truncate">
                  {t("generatingCodeWiki")}
                </span>
              </div>
            )} */}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[12px] font-medium text-(--text-muted)">
              Documents
            </span>
            <button
              className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              onClick={() => {
                loadReports({ preferNewest: true });
                if (CODEWIKI_SYMBOL_GRAPH_ENABLED) loadSymbolGraph();
              }}
              title="Refresh"
              aria-label="Refresh"
            >
              <ArrowClockwise size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {CODEWIKI_SYMBOL_GRAPH_ENABLED && (
              <div
                className={cn(
                  "group mb-2 w-full rounded-lg px-3 py-2 text-left hover:bg-(--bg-hover) cursor-pointer",
                  activeDoc === "graph" && "bg-(--bg-active)",
                )}
                onClick={() => {
                  setActiveDoc("graph");
                  if (!symbolGraph && !graphLoading) loadSymbolGraph();
                }}
              >
                <span className="flex items-start gap-2 text-[13px] text-(--text-primary)">
                  <Network
                    size={14}
                    className="shrink-0 mt-0.5 text-(--text-muted)"
                  />
                  <span className="min-w-0 flex-1">浠ｇ爜鍏崇郴</span>
                  {graphLoading && (
                    <CircleNotch
                      size={13}
                      className="mt-0.5 shrink-0 animate-spin text-(--text-muted)"
                    />
                  )}
                </span>
                <span className="mt-1 block truncate pl-6 text-[11px] text-(--text-muted)">
                  {symbolGraph?.stats
                    ? `${symbolGraph.stats.displayed_nodes || 0} nodes 路 ${symbolGraph.stats.displayed_edges || 0} edges`
                    : "Symbol Graph"}
                </span>
              </div>
            )}

            {loading && (
              <div className="px-3 py-6 text-[12px] text-(--text-muted) inline-flex items-center gap-2">
                <CircleNotch size={14} className="animate-spin" />
                {t("loadingReport")}
              </div>
            )}

            {!loading && reports.length === 0 && (
              <div className="mx-2 rounded-lg border border-dashed border-(--border-default) px-3 py-4 text-[12px] leading-5 text-(--text-muted)">
                {t("noReportYet")}
              </div>
            )}

            <div className="flex flex-col gap-1">
              {reports.map((report) => (
                <div
                  key={report.file}
                  className={cn(
                    "group w-full rounded-lg px-3 py-2 text-left hover:bg-(--bg-hover) cursor-pointer",
                    activeDoc === "report" &&
                      selectedFile === report.file &&
                      "bg-(--bg-active)",
                  )}
                  onClick={() => {
                    setActiveDoc("report");
                    setSelectedFile(report.file);
                    setFrameError(false);
                  }}
                >
                  <span className="flex items-start gap-2 text-[13px] text-(--text-primary)">
                    <span className="min-w-0 flex-1 break-words">
                      {report.file}
                    </span>
                    <span className="mt-0.5 shrink-0 rounded-md border border-(--border-default) px-1.5 py-0.5 text-[10px] uppercase text-(--text-muted)">
                      {report.format ||
                        (report.file?.endsWith(".md") ? "md" : "html")}
                    </span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) opacity-0 hover:bg-(--bg-active) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t("reportActions")}
                        >
                          <DotsThree size={14} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-36 p-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="w-full rounded-md px-2.5 py-2 text-left text-[13px] text-(--accent-red) hover:bg-(--accent-red-bg)"
                          onClick={() => setPendingDelete(report)}
                        >
                          {t("deleteReport")}
                        </button>
                      </PopoverContent>
                    </Popover>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-(--text-muted)">
                    {formatReportDate(report.mtime)}
                    {formatFileSize(report.size)
                      ? ` 路 ${formatFileSize(report.size)}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 min-h-0 flex flex-col bg-(--bg-primary)">
          {/* <div className="h-[52px] px-5 border-b border-(--border-default) flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-(--text-primary) truncate">
                {selected?.title || "CodeWiki"}
              </h1>
              <p className="text-[12px] text-(--text-muted) truncate">
                {selected ? selected.file : "基于 project-requirements 的项目文档"}
              </p>
            </div>
            <button
              className="hidden max-lg:inline-flex h-8 items-center gap-2 rounded-lg border border-(--border-default) px-3 text-[12px] text-(--text-secondary)"
              onClick={handleGenerate}
              disabled={isWorking}
            >
              {generating ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} />}
              {t("generate")}
            </button>
          </div> */}

          {error && (
            <Alert variant="destructive" className="mx-5 mt-4">
              <WarningCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex-1 min-h-0 p-4">
            {CODEWIKI_SYMBOL_GRAPH_ENABLED && activeDoc === "graph" ? (
              <div className="h-full min-h-[420px] overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary)">
                <SymbolGraphView
                  graph={symbolGraph}
                  loading={graphLoading}
                  error={graphError}
                  onRefresh={loadSymbolGraph}
                />
              </div>
            ) : !selected && !loading ? (
              <div className="h-full min-h-[420px] rounded-xl border border-dashed border-(--border-default) bg-(--bg-secondary) flex flex-col items-center justify-center text-center px-8">
                <BookOpenText size={34} className="text-(--text-muted)" />
                <h2 className="mt-4 text-[18px] font-semibold text-(--text-primary)">
                  {t("noCodeWiki")}
                </h2>
                <p className="mt-2 max-w-md text-[13px] leading-6 text-(--text-muted)">
                  {t("reportWillShow")}
                </p>
                <button
                  className="mt-5 h-10 rounded-lg bg-(--text-primary) px-4 text-[13px] font-medium text-(--bg-primary) inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleGenerate}
                  disabled={isWorking}
                >
                  {generating ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Sparkle size={16} />
                  )}
                  {generating ? t("generating") : t("generateNew")}
                </button>
                {false && (
                  <div className="mt-3 grid w-full max-w-xs grid-cols-3 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
                    {getGenerationDepths().map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={cn(
                          "h-7 rounded-md text-[12px] text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-60",
                          generationDepth === item.value &&
                            "bg-(--bg-active) text-(--text-primary)",
                        )}
                        disabled={isWorking}
                        onClick={() => setGenerationDepth(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-2 grid w-full max-w-xs grid-cols-2 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
                  {getGenerationFormats().map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        "h-7 rounded-md text-[12px] text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-60",
                        generationFormat === item.value &&
                          "bg-(--bg-active) text-(--text-primary)",
                      )}
                      disabled={isWorking}
                      onClick={() => setGenerationFormat(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {/* {generating && (
                  <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-primary) px-4 py-4 w-full max-w-md">
                    <CircleNotch
                      size={16}
                      className="animate-spin shrink-0 text-(--text-muted)"
                    />
                    <span className="text-[13px] text-(--text-secondary)">
                      {t("generatingCodeWiki")}
                    </span>
                  </div>
                )} */}
              </div>
            ) : (
              <div className="h-full min-h-[420px] overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary)">
                {frameError ? (
                  <div className="h-full flex flex-col items-center justify-center px-8 text-center">
                    <WarningCircle size={28} className="text-(--text-muted)" />
                    <p className="mt-3 text-[13px] text-(--text-secondary)">
                      {t("reportLoadFailed")}
                    </p>
                    <button
                      className="mt-4 h-8 rounded-md border border-(--border-default) px-3 text-[12px] text-(--text-primary) hover:bg-(--bg-hover)"
                      onClick={() => setFrameError(false)}
                    >
                      {t("retry")}
                    </button>
                  </div>
                ) : selected ? (
                  selectedIsMarkdown ? (
                    <div className="h-full overflow-auto bg-(--bg-primary) text-(--text-primary)">
                      {markdownReport.loading ||
                      markdownReport.file !== selected.file ? (
                        <div className="flex h-full items-center justify-center text-[13px] text-(--text-muted)">
                          <CircleNotch size={16} className="mr-2 animate-spin" />
                          {t("loadingReport")}
                        </div>
                      ) : markdownReport.error ? (
                        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                          <WarningCircle
                            size={28}
                            className="text-(--text-muted)"
                          />
                          <p className="mt-3 text-[13px] text-(--text-secondary)">
                            {markdownReport.error}
                          </p>
                        </div>
                      ) : (
                        <div className="codewiki-md-report mx-auto max-w-[1120px] px-8 py-8 max-sm:px-4">
                          <StreamdownRenderer
                            text={markdownReport.text || t("reportLoadFailed")}
                            streaming={false}
                            className="codewiki-md-report-body text-[14px] leading-7 text-(--text-primary)"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <iframe
                      key={selected.file}
                      title={`CodeWiki ${selected.file}`}
                      src={reportUrl}
                      sandbox="allow-scripts"
                      className="h-full w-full border-0 bg-white"
                      onLoad={() => setFrameError(false)}
                      onError={() => setFrameError(true)}
                    />
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-[13px] text-(--text-muted)">
                    <CircleNotch size={16} className="mr-2 animate-spin" />
                    {t("loading")}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <div
          className="codewiki-resizer max-xl:hidden"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize CodeWiki Q&A panel"
          title="Drag to resize"
          onMouseDown={handleQaResizeStart}
        >
          <span className="codewiki-resizer-handle">
            <DotsSixVertical size={14} aria-hidden="true" />
          </span>
        </div>

        <aside className="bg-(--bg-secondary) min-h-0 flex flex-col max-xl:hidden">
          <div className="p-4 border-b border-(--border-default)">
            {/* <div className="flex items-center gap-2 text-(--text-primary)">
              <ChatText size={17} />
              <span className="font-medium text-[14px]">
                Ask this repository
              </span>
            </div> */}
            <p className="mt-2 text-[12px] leading-5 text-(--text-muted)">
              {generating
                ? t("noQuestionsDuringGeneration")
                : t("tempReadOnlyQa")}
            </p>
            {selected && (
              <p
                className="mt-2 truncate rounded-md border border-(--border-default) bg-(--bg-primary) px-2 py-1.5 text-[11px] text-(--text-secondary)"
                title={selected.file}
              >
                {t("referenceReport")}{" "}
                <span className="font-medium text-(--text-primary)">
                  {selected.file}
                </span>
              </p>
            )}
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
          >
            {chatMessages.length === 0 ? (
              <div className="rounded-xl border border-(--border-default) bg-(--bg-primary) p-4">
                {/* <Sparkle size={22} className="text-(--text-muted)" /> */}
                <p className="text-[13px] font-medium text-(--text-primary)">
                  {generating
                    ? t("generatingCodeWiki")
                    : asking || busy
                      ? t("processingQuestion")
                      : selected
                        ? t("canAskAboutSelectedReport")
                        : t("canAskAboutProject")}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-(--text-muted)">
                  {generating
                    ? t("askAfterGeneration")
                    : lastQuestion ||
                      (selected
                        ? `${t("askUsingSelectedReport")} ${selected.file}`
                        : t("exampleQuestions"))}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {chatMessages.map((message) => (
                  <div key={message.id}>
                    <MessageBubble message={message} />
                    {message.loading &&
                      (!message.segments || message.segments.length === 0) && (
                        <div className="mt-[-12px] mb-3 ml-1 inline-flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 py-2 text-[12px] text-(--text-muted)">
                          <CircleNotch size={14} className="animate-spin" />
                          {t("answering")}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            className="p-4 border-t border-(--border-default)"
            onSubmit={handleAsk}
          >
            <div className="flex items-center gap-2 rounded-full border border-(--border-default) bg-(--bg-primary) px-3 py-2">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={
                  generating
                    ? t("generatingCodeWiki")
                    : asking || busy
                      ? t("answering")
                      : selected
                        ? t("askAboutSelectedReport")
                        : t("askAboutRepository")
                }
                disabled={askInputLocked}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-(--text-primary) outline-none placeholder:text-(--text-muted) disabled:opacity-60"
              />
              <button
                type="submit"
                className="inline-flex size-7 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-50"
                disabled={askInputLocked || !question.trim()}
                aria-label={t("sendingQuestion")}
              >
                {asking ? (
                  <CircleNotch size={15} className="animate-spin" />
                ) : (
                  <PaperPlaneRight size={15} />
                )}
              </button>
            </div>
          </form>
        </aside>
      </div>
      {qaResizing && <div className="codewiki-resize-overlay" />}
      <ConfirmDialog
        open={!!pendingDelete}
        title={t("deleteReportConfirm")}
        description={t("deleteReportDescription").replace(
          "{{report}}",
          pendingDelete?.title || pendingDelete?.file || "",
        )}
        loading={deletingReport}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={confirmDeleteReport}
      />
    </div>
  );
}
