import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n/index.js";
import {
  ArrowUp,
  ArrowClockwise,
  BookOpenText,
  ChatText,
  CheckCircle,
  CircleNotch,
  DotsSixVertical,
  DotsThree,
  FileText,
  Network,
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { MessageBubble } from "@/components/MessageBubble.jsx";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  applyStreamEventToMessage,
  finishStreamingTextSegments,
  finishThinkingSegments,
  isTranscriptStreamEvent,
} from "../../../shared/transcript-segments.js";

const CODEWIKI_QA_WIDTH_KEY = "codemini:codewiki:qa-width";
const CODEWIKI_QA_MIN_WIDTH = 320;
const CODEWIKI_QA_MAX_WIDTH = 760;
const CODEWIKI_QA_DEFAULT_WIDTH = 420;
const CODEWIKI_GENERATION_POLL_MS = 4000;
const CODEWIKI_SYMBOL_GRAPH_ENABLED = true;

function isReportInProgress(report) {
  const status = String(report?.manifestStatus || "").toLowerCase();
  return status === "running" || status === "pending";
}

function isReportFailed(report) {
  const status = String(report?.manifestStatus || "").toLowerCase();
  return status === "failed" || status === "aborted";
}

function GenerationProgress({ planSteps, stageLabel }) {
  const steps = Array.isArray(planSteps) ? planSteps : [];
  const completed = steps.filter((step) =>
    ["done", "completed"].includes(String(step?.status || "").toLowerCase()),
  ).length;
  const activeIndex = steps.findIndex(
    (step) => String(step?.status || "").toLowerCase() === "running",
  );
  const progress = steps.length
    ? Math.max(8, Math.round((completed / steps.length) * 100))
    : 12;

  return (
    <section
      className="codewiki-generation-progress"
      aria-live="polite"
      aria-label={t("generationProgress")}
    >
      <div className="flex items-start gap-3">
        <span className="codewiki-generation-orb" aria-hidden="true">
          <CircleNotch size={16} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-(--text-primary)">
            {t("generatingCodeWiki")}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-(--text-secondary)">
            {stageLabel || t("preparingScan")}
          </p>
        </div>
        {steps.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-(--text-muted)">
            {completed}/{steps.length}
          </span>
        )}
      </div>
      <div
        className="codewiki-progress-track mt-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      {steps.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {steps.slice(0, 5).map((step, index) => {
            const status = String(step?.status || "pending").toLowerCase();
            const done = ["done", "completed"].includes(status);
            const running = status === "running" || index === activeIndex;
            return (
              <li
                key={`${step?.index || index}-${step?.title || ""}`}
                className={cn(
                  "codewiki-generation-step",
                  done && "codewiki-generation-step--done",
                  running && "codewiki-generation-step--running",
                )}
              >
                {done ? (
                  <CheckCircle size={13} weight="fill" aria-hidden="true" />
                ) : running ? (
                  <span
                    className="codewiki-generation-step-pulse"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="codewiki-generation-step-dot"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 truncate">
                  {step?.title || `${t("report")} ${index + 1}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

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

function SymbolGraphView({ graph, loading, error, onRefresh, onExplore }) {
  const [selectedId, setSelectedId] = useState("");
  const [graphQuery, setGraphQuery] = useState("");
  const [graphTarget, setGraphTarget] = useState("");
  const [graphMode, setGraphMode] = useState("query");
  const layout = useMemo(() => buildGraphLayout(graph), [graph]);
  const selected =
    layout.nodes.find((node) => node.id === selectedId) ||
    layout.nodes[0] ||
    null;
  const selectedConnections = useMemo(
    () =>
      (graph?.edges || []).filter(
        (edge) => edge.source === selected?.id || edge.target === selected?.id,
      ),
    [graph?.edges, selected?.id],
  );

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
      <div className="min-w-0 min-h-0 flex flex-col">
        <form
          className="flex items-center gap-2 border-b border-(--border-default) bg-(--bg-primary) px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (graphMode === "path") {
              onExplore({
                operation: "path",
                from: graphQuery,
                to: graphTarget,
              });
            } else if (graphMode === "impact") {
              onExplore({
                operation: "impact",
                file: graphQuery
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                depth: 3,
              });
            } else {
              onExplore({ operation: "query", query: graphQuery, depth: 2 });
            }
          }}
        >
          <select
            value={graphMode}
            onChange={(event) => setGraphMode(event.target.value)}
            className="h-8 rounded-md border border-(--border-default) bg-(--bg-secondary) px-2 text-[12px] text-(--text-primary)"
            aria-label="Atlas query mode"
          >
            <option value="query">{t("graphRelated")}</option>
            <option value="path">{t("graphPath")}</option>
            <option value="impact">{t("graphImpact")}</option>
          </select>
          <input
            value={graphQuery}
            onChange={(event) => setGraphQuery(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 text-[12px] text-(--text-primary) outline-none focus:border-(--text-muted)"
            placeholder={
              graphMode === "impact"
                ? t("graphImpactPlaceholder")
                : graphMode === "path"
                  ? t("graphPathFrom")
                  : t("graphSearchPlaceholder")
            }
          />
          {graphMode === "path" && (
            <input
              value={graphTarget}
              onChange={(event) => setGraphTarget(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 text-[12px] text-(--text-primary) outline-none focus:border-(--text-muted)"
              placeholder={t("graphPathTo")}
            />
          )}
          <Button
            type="submit"
            size="sm"
            disabled={
              !graphQuery.trim() ||
              (graphMode === "path" && !graphTarget.trim())
            }
          >
            {t("graphQuery")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setGraphQuery("");
              onExplore({ operation: "overview", depth: 2 });
            }}
          >
            {t("graphOverview")}
          </Button>
        </form>
        <div className="min-w-0 min-h-0 flex-1 overflow-auto p-6">
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
                  key={`${edge.source}-${edge.target}-${edge.relation}-${index}`}
                  d={`M ${sx} ${sy + 24} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty - 24}`}
                  fill="none"
                  stroke={
                    edge.relation === "calls"
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
                  onDoubleClick={() =>
                    onExplore({
                      operation: "neighbors",
                      node_id: node.id,
                      depth: 2,
                    })
                  }
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
                      `${node.type} · ${String(node.file || "")
                        .split("/")
                        .pop()}`,
                    ).slice(0, 28)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <aside className="min-h-0 border-l border-(--border-default) bg-(--bg-primary) p-4 overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-(--text-muted)">
              Code Graph
            </p>
            <p className="mt-1 text-[11px] text-(--text-muted)">
              {graph?.stats?.displayed_nodes || 0} nodes ·{" "}
              {graph?.stats?.displayed_edges || 0} edges
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            aria-label="Refresh graph"
          >
            <ArrowClockwise size={14} />
          </Button>
        </div>
        {selected && (
          <div className="mt-5">
            <h2 className="break-words text-[15px] font-semibold text-(--text-primary)">
              {selected.label}
            </h2>
            {(selected.file || selected.range?.start_line) && (
              <p className="mt-1 break-words text-[12px] text-(--text-muted)">
                {selected.file}
                {selected.range?.start_line
                  ? `:${selected.range.start_line}-${selected.range.end_line || selected.range.start_line}`
                  : ""}
              </p>
            )}
            {selected.signature && (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3 text-[11px] leading-5 text-(--text-secondary)">
                {selected.signature}
              </pre>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              onClick={() =>
                onExplore({
                  operation: "neighbors",
                  node_id: selected.id,
                  depth: 2,
                })
              }
            >
              {t("graphExpand")}
            </Button>
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
                Relations
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {(selectedConnections.length
                  ? selectedConnections
                  : [{ id: "none", relation: "None", confidence: "" }]
                ).map((edge) => (
                  <button
                    type="button"
                    key={edge.id}
                    className="rounded-md border border-(--border-default) bg-(--bg-secondary) px-2 py-1.5 text-left text-[11px] text-(--text-secondary)"
                    onClick={() => {
                      const nextId =
                        edge.source === selected.id ? edge.target : edge.source;
                      if (layout.nodes.some((node) => node.id === nextId))
                        setSelectedId(nextId);
                    }}
                  >
                    <span className="font-medium">{edge.relation}</span>
                    {edge.confidence ? ` · ${edge.confidence}` : ""}
                  </button>
                ))}
              </div>
            </div>
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
        isComplete: true,
        segments: finishThinkingSegments(
          finishStreamingTextSegments(message.segments),
        ),
      };
    case "codewiki:error":
      return {
        ...message,
        role: "error",
        loading: false,
        isComplete: true,
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
  const [generationDepth, setGenerationDepth] = useState("fast");
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
  const questionInputRef = useRef(null);
  const reportFrameRef = useRef(null);
  const layoutElRef = useRef(null);
  const liveQaWidthRef = useRef(qaWidth);
  const generationStartedAtRef = useRef(0);
  const qaResizeRef = useRef({
    startX: 0,
    startWidth: CODEWIKI_QA_DEFAULT_WIDTH,
  });
  const [reportTheme, setReportTheme] = useState(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
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
  const isWorking = generating;
  const selectedReportGenerating = isReportInProgress(selected);
  const selectedReportFailed = isReportFailed(selected);
  const showReportLoading =
    activeDoc === "report" && (generating || selectedReportGenerating);
  const showReportFailed =
    activeDoc === "report" &&
    !showReportLoading &&
    selectedReportFailed;

  const reportUrl = useMemo(() => {
    if (!selected) return "";
    const params = new URLSearchParams();
    if (projectKey) params.set("project", projectKey);
    params.set("theme", reportTheme);
    return `/api/codewiki/report/${encodeURIComponent(selected.file)}?${params.toString()}`;
  }, [projectKey, reportTheme, selected]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const syncTheme = () => {
      setReportTheme(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = reportFrameRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        { type: "codewiki-theme", theme: reportTheme },
        "*",
      );
    } catch {}
  }, [reportTheme, selected?.file]);

  const loadSymbolGraph = useCallback(
    async (options = {}) => {
      setGraphLoading(true);
      setGraphError("");
      try {
        const data = await fetchCodeWikiSymbolGraph(projectKey, options);
        setSymbolGraph(data);
        if (data?.error) setGraphError(data.error);
      } catch (err) {
        setGraphError(err?.message || "Failed to load code graph");
      } finally {
        setGraphLoading(false);
      }
    },
    [projectKey],
  );

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
          setError(
            newest.manifestError ||
              generationStatus?.error ||
              t("reportGenerateFailed"),
          );
        }
        if (String(newest.manifestStatus).toLowerCase() === "aborted") {
          setError(newest.manifestError || t("reportGenerateFailed"));
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
    liveQaWidthRef.current = qaWidth;
    window.localStorage.setItem(CODEWIKI_QA_WIDTH_KEY, String(qaWidth));
  }, [qaWidth]);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const handleQaResizeStart = useCallback(
    (event) => {
      event.preventDefault();
      liveQaWidthRef.current = qaWidth;
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
        liveQaWidthRef.current = nextWidth;
        layoutElRef.current?.style.setProperty(
          "--codewiki-qa-width",
          `${nextWidth}px`,
        );
      };

      const handleEnd = () => {
        setQaWidth(liveQaWidthRef.current);
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
    if (generating) return;
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
    if (questionInputRef.current)
      questionInputRef.current.style.height = "auto";
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
        isComplete: false,
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
                isComplete: true,
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

  const askInputLocked = isWorking || asking;

  return (
    <div
      ref={layoutElRef}
      className="codewiki-layout h-full min-h-0 flex-1"
      style={{
        "--codewiki-qa-width": `${qaResizing ? liveQaWidthRef.current : qaWidth}px`,
      }}
    >
        <aside className="codewiki-sidebar min-h-0 flex flex-col max-lg:hidden">
          <div className="px-4 pb-4 pt-5">
            <div className="flex items-center gap-2.5 text-(--text-primary)">
              <span className="codewiki-brand-mark" aria-hidden="true">
                <BookOpenText size={17} />
              </span>
              <div className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-[-0.015em]">
                  CodeWiki
                </span>
                <span
                  className="block truncate text-[11px] text-(--text-muted)"
                  title={projectCwd || ""}
                >
                  {projectCwd || t("currentProject")}
                </span>
              </div>
            </div>

            <section className="codewiki-generation-card mt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-medium text-(--text-primary)">
                    {t("reportStudio")}
                  </h2>
                  <p className="mt-1 text-[11px] leading-[1.55] text-(--text-secondary)">
                    {t("reportStudioDescription")}
                  </p>
                </div>
                <Sparkle
                  size={16}
                  className="mt-0.5 shrink-0 text-(--text-muted)"
                  aria-hidden="true"
                />
              </div>

              <div className="mt-3">
                <span className="codewiki-field-label">
                  {t("generationDepth")}
                </span>
                <div
                  className="codewiki-segmented-control mt-1.5 grid grid-cols-2"
                  role="group"
                  aria-label={t("generationDepth")}
                >
                  {getGenerationDepths().map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={generationDepth === item.value}
                      className={cn(
                        "codewiki-segmented-item",
                        generationDepth === item.value &&
                          "codewiki-segmented-item--active",
                      )}
                      disabled={isWorking}
                      onClick={() => setGenerationDepth(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <span className="codewiki-field-label">
                  {t("reportFormat")}
                </span>
                <div
                  className="codewiki-segmented-control mt-1.5 grid grid-cols-2"
                  role="group"
                  aria-label={t("reportFormat")}
                >
                  {getGenerationFormats().map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={generationFormat === item.value}
                      className={cn(
                        "codewiki-segmented-item",
                        generationFormat === item.value &&
                          "codewiki-segmented-item--active",
                      )}
                      disabled={isWorking}
                      onClick={() => setGenerationFormat(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="codewiki-generate-button mt-3"
                onClick={handleGenerate}
                disabled={isWorking}
              >
                {generating ? (
                  <CircleNotch size={15} className="animate-spin" />
                ) : (
                  <Sparkle size={15} />
                )}
                <span className="truncate">
                  {generating
                    ? stageLabel || t("generating")
                    : reports.length
                      ? t("generateNew")
                      : t("generate")}
                </span>
              </button>
            </section>

            {generating && (
              <GenerationProgress
                planSteps={planSteps}
                stageLabel={stageLabel}
              />
            )}
          </div>

          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <span className="codewiki-section-label">{t("documents")}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                loadReports({ preferNewest: true });
                if (CODEWIKI_SYMBOL_GRAPH_ENABLED) loadSymbolGraph();
              }}
              title="Refresh"
              aria-label="Refresh"
            >
              <ArrowClockwise size={14} />
            </Button>
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
                  <span className="min-w-0 flex-1">{t("projectAtlas")}</span>
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
                    {isReportInProgress(report) && (
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-(--border-default) bg-(--bg-secondary) px-1.5 py-0.5 text-[10px] text-(--text-secondary)">
                        <CircleNotch size={10} className="animate-spin" />
                        {t("generating")}
                      </span>
                    )}
                    {isReportFailed(report) && (
                      <span className="mt-0.5 shrink-0 rounded-md border border-(--border-default) bg-(--bg-secondary) px-1.5 py-0.5 text-[10px] text-(--accent-red)">
                        {t("failed")}
                      </span>
                    )}
                    {report.graphFreshness === "stale" && (
                      <span className="mt-0.5 shrink-0 rounded-md border border-(--border-default) bg-(--bg-secondary) px-1.5 py-0.5 text-[10px] text-(--text-secondary)">
                        {t("graphStale")}
                      </span>
                    )}
                    <span className="mt-0.5 shrink-0 rounded-md border border-(--border-default) px-1.5 py-0.5 text-[10px] uppercase text-(--text-muted)">
                      {report.format ||
                        (report.file?.endsWith(".md") ? "md" : "html")}
                    </span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t("reportActions")}
                        >
                          <DotsThree size={14} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-36 p-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto w-full justify-start rounded-md px-2.5 py-2 text-left text-[13px] text-(--accent-red) shadow-none hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
                          onClick={() => setPendingDelete(report)}
                        >
                          {t("deleteReport")}
                        </Button>
                      </PopoverContent>
                    </Popover>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-(--text-muted)">
                    {formatReportDate(report.mtime)}
                    {formatFileSize(report.size)
                      ? ` · ${formatFileSize(report.size)}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="codewiki-main min-w-0 min-h-0 flex flex-col">
          <header className="codewiki-content-toolbar">
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-(--text-primary)">
                {activeDoc === "graph"
                  ? t("projectAtlas")
                  : selected?.title || t("report")}
              </h1>
              <p className="mt-0.5 truncate text-[11px] text-(--text-muted)">
                {activeDoc === "graph"
                  ? t("graphWorkspaceDescription")
                  : selected
                    ? selected.file
                    : t("projectDocs")}
              </p>
            </div>
            <button
              className="codewiki-toolbar-generate hidden max-lg:inline-flex"
              onClick={handleGenerate}
              disabled={isWorking}
            >
              {generating ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Sparkle size={14} />
              )}
              {generating ? t("generating") : t("generate")}
            </button>
          </header>

          {error && (
            <Alert variant="destructive" className="mx-5 mt-4">
              <WarningCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex-1 min-h-0 p-4 pt-3">
            {CODEWIKI_SYMBOL_GRAPH_ENABLED && activeDoc === "graph" ? (
              <div className="h-full min-h-[420px] overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary)">
                <SymbolGraphView
                  graph={symbolGraph}
                  loading={graphLoading}
                  error={graphError}
                  onRefresh={() => loadSymbolGraph()}
                  onExplore={loadSymbolGraph}
                />
              </div>
            ) : showReportLoading ? (
              <div className="codewiki-empty-state h-full min-h-[420px] flex flex-col items-center justify-center text-center px-8">
                <CircleNotch
                  size={28}
                  className="animate-spin text-(--text-muted)"
                />
                <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                  {t("reportGenerating")}
                </h2>
                <p className="mt-2 max-w-md text-[13px] leading-6 text-(--text-secondary)">
                  {t("reportGeneratingHint")}
                </p>
                {(planSteps?.length > 0 || stageLabel) && (
                  <div className="mt-5 w-full max-w-md text-left">
                    <GenerationProgress
                      planSteps={planSteps}
                      stageLabel={stageLabel}
                    />
                  </div>
                )}
              </div>
            ) : showReportFailed ? (
              <div className="codewiki-empty-state h-full min-h-[420px] flex flex-col items-center justify-center text-center px-8">
                <WarningCircle size={28} className="text-(--text-muted)" />
                <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                  {t("reportGenerateFailed")}
                </h2>
                <p className="mt-2 max-w-lg text-[13px] leading-6 text-(--text-secondary) break-words">
                  {selected?.manifestError ||
                    error ||
                    generationStatus?.error ||
                    t("reportGenerateFailedHint")}
                </p>
                <button
                  className="codewiki-empty-generate mt-5"
                  onClick={handleGenerate}
                  disabled={isWorking}
                >
                  <Sparkle size={16} />
                  {t("generateNew")}
                </button>
              </div>
            ) : !selected && !loading ? (
              <div className="codewiki-empty-state h-full min-h-[420px] flex flex-col items-center justify-center text-center px-8">
                <span className="codewiki-empty-icon" aria-hidden="true">
                  <BookOpenText size={28} />
                </span>
                <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                  {t("noCodeWiki")}
                </h2>
                <p className="mt-2 max-w-md text-[13px] leading-6 text-(--text-secondary)">
                  {t("reportWillShow")}
                </p>
                <button
                  className="codewiki-empty-generate mt-5"
                  onClick={handleGenerate}
                  disabled={isWorking}
                >
                  <Sparkle size={16} />
                  {t("generateNew")}
                </button>
                <p className="mt-3 text-[11px] text-(--text-muted)">
                  {
                    getGenerationDepths().find(
                      (item) => item.value === generationDepth,
                    )?.label
                  }
                  {" · "}
                  {
                    getGenerationFormats().find(
                      (item) => item.value === generationFormat,
                    )?.label
                  }
                </p>
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
                          <CircleNotch
                            size={16}
                            className="mr-2 animate-spin"
                          />
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
                      key={`${selected.file}:${reportTheme}`}
                      ref={reportFrameRef}
                      title={`CodeWiki ${selected.file}`}
                      src={reportUrl}
                      sandbox="allow-scripts"
                      className="h-full w-full border-0 bg-(--bg-primary)"
                      onLoad={() => {
                        setFrameError(false);
                        try {
                          reportFrameRef.current?.contentWindow?.postMessage(
                            { type: "codewiki-theme", theme: reportTheme },
                            "*",
                          );
                        } catch {}
                      }}
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
            <DotsSixVertical size={10} aria-hidden="true" />
          </span>
        </div>

        <aside className="codewiki-question-panel min-h-0 flex flex-col max-xl:hidden">
          <div className="codewiki-question-header">
            <div className="flex items-center gap-2.5">
              <span className="codewiki-question-mark" aria-hidden="true">
                <ChatText size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-(--text-primary)">
                  {t("askCodeWiki")}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-(--text-muted)">
                  {generating
                    ? t("noQuestionsDuringGeneration")
                    : t("askCodeWikiDescription")}
                </p>
              </div>
            </div>
            <div
              className="codewiki-reference-chip mt-3"
              title={selected?.file || projectCwd || t("currentProject")}
            >
              <FileText size={13} className="shrink-0" aria-hidden="true" />
              <span className="text-(--text-muted)">{t("currentContext")}</span>
              <span className="min-w-0 truncate font-medium text-(--text-primary)">
                {selected?.file || projectCwd || t("currentProject")}
              </span>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="codemini-chat-session flex-1 min-h-0 overflow-y-auto px-4 pb-5 pt-4"
          >
            {chatMessages.length === 0 ? (
              <div className="codewiki-question-empty">
                <span
                  className="codewiki-question-empty-icon"
                  aria-hidden="true"
                >
                  <Sparkle size={18} />
                </span>
                <p className="mt-3 text-[14px] font-medium tracking-[-0.01em] text-(--text-primary)">
                  {generating
                    ? t("generatingCodeWiki")
                    : asking || busy
                      ? t("processingQuestion")
                      : selected
                        ? t("canAskAboutSelectedReport")
                        : t("canAskAboutProject")}
                </p>
                <p className="mt-1.5 max-w-[300px] text-[12px] leading-5 text-(--text-secondary)">
                  {generating
                    ? t("askAfterGeneration")
                    : lastQuestion ||
                      (selected
                        ? `${t("askUsingSelectedReport")} ${selected.file}`
                        : t("exampleQuestions"))}
                </p>
                {!generating && !asking && (
                  <div className="mt-4 flex w-full flex-col gap-2">
                    {[
                      t("suggestedCodeWikiQuestion1"),
                      t("suggestedCodeWikiQuestion2"),
                      t("suggestedCodeWikiQuestion3"),
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="codewiki-question-suggestion"
                        disabled={askInputLocked}
                        onClick={() => {
                          setQuestion(suggestion);
                          requestAnimationFrame(() =>
                            questionInputRef.current?.focus(),
                          );
                        }}
                      >
                        <span className="truncate">{suggestion}</span>
                        <ArrowUp
                          size={13}
                          className="rotate-45"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                {chatMessages.map((message) => (
                  <div key={message.id}>
                    <MessageBubble message={message} />
                    {message.loading &&
                      (!message.segments || message.segments.length === 0) && (
                        <div className="codewiki-answering mt-[-12px] mb-3 ml-1">
                          <CircleNotch size={14} className="animate-spin" />
                          {t("answering")}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form className="codewiki-composer-dock" onSubmit={handleAsk}>
            <div className="codemini-input-shell codewiki-question-composer">
              <textarea
                ref={questionInputRef}
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
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
                rows={1}
                aria-label={t("askCodeWiki")}
                aria-describedby="codewiki-composer-hint"
                className="codewiki-question-input"
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-(--text-muted)">
                  {/* {selected ? t("reportContextActive") : t("projectContextActive")} */}
                </span>
                <button
                  type="submit"
                  className={cn(
                    "codewiki-question-submit",
                    question.trim() &&
                      !askInputLocked &&
                      "codewiki-question-submit--ready",
                  )}
                  disabled={askInputLocked || !question.trim()}
                  aria-label={t("sendingQuestion")}
                >
                  {asking ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <ArrowUp size={16} />
                  )}
                </button>
              </div>
            </div>
            {/* <p
              id="codewiki-composer-hint"
              className="mt-2 text-center text-[10px] text-(--text-muted)"
            >
              {askInputLocked ? t("askAfterGeneration") : t("askShortcut")}
            </p> */}
          </form>
        </aside>
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
