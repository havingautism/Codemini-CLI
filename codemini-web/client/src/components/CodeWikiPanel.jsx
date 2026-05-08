import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpenText,
  FileText,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  SendHorizontal,
  Sparkles,
} from "lucide-react";
import {
  deleteCodeWikiReport,
  fetchCodeWikiReports,
  generateCodeWikiReport,
  streamCodeWikiAsk,
} from "@/hooks/use-api.js";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { MessageBubble } from "@/components/MessageBubble.jsx";
import { cn } from "@/lib/utils";

const GENERATION_DEPTHS = [
  { value: "fast", label: "快速" },
  { value: "standard", label: "标准" },
  { value: "deep", label: "深度" },
];

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

function getGenerationProgress(steps, stageLabel) {
  const planSteps = Array.isArray(steps) ? steps : [];
  if (!planSteps.length) {
    return {
      done: 0,
      total: 0,
      pct: 8,
      label: stageLabel || "正在启动项目需求分析",
      detail: "准备扫描代码、接口和项目结构",
    };
  }

  const done = planSteps.filter((step) => step.status === "done").length;
  const failed = planSteps.find((step) => step.status === "failed");
  const active =
    planSteps.find((step) => step.status === "running") ||
    planSteps.find((step) => step.status === "in_progress") ||
    planSteps.find((step) => step.status === "pending") ||
    planSteps[planSteps.length - 1];

  return {
    done,
    total: planSteps.length,
    pct: Math.max(8, Math.round((done / planSteps.length) * 100)),
    label: failed
      ? "生成遇到问题"
      : active?.title || stageLabel || "正在生成 CodeWiki",
    detail: failed
      ? failed.title
      : `${done}/${planSteps.length} 个步骤完成${active?.role ? ` · ${active.role.toUpperCase()}` : ""}`,
  };
}

function GenerationProgress({ steps, stageLabel, compact = false }) {
  const progress = getGenerationProgress(steps, stageLabel);

  return (
    <div
      className={cn(
        "rounded-lg border border-(--border-default) bg-(--bg-primary) p-3 text-left",
        compact ? "mt-3" : "mt-5 w-full max-w-md",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-medium text-(--text-primary)">
          {progress.label}
        </span>
        {progress.total > 0 && (
          <span className="shrink-0 text-[11px] text-(--text-muted)">
            {progress.done}/{progress.total}
          </span>
        )}
      </div>
      <Progress value={progress.pct} className="mt-2 h-1.5" />
      <p className="mt-2 truncate text-[11px] text-(--text-muted)">
        {progress.detail}
      </p>
    </div>
  );
}

function addToolToSegments(segments, toolCard) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [{ type: "tools", cards: [toolCard] }];
  }
  const last = segments[segments.length - 1];
  if (last.type === "tools") {
    return [
      ...segments.slice(0, -1),
      { ...last, cards: [...last.cards, toolCard] },
    ];
  }
  return [...segments, { type: "tools", cards: [toolCard] }];
}

function updateToolInSegments(segments, toolId, updater) {
  return (Array.isArray(segments) ? segments : []).map((seg) => {
    if (seg.type !== "tools") return seg;
    const index = seg.cards.findIndex((card) => card.id === toolId);
    if (index === -1) return seg;
    const cards = [...seg.cards];
    cards[index] = updater(cards[index]);
    return { ...seg, cards };
  });
}

function ensureTextSegment(segments) {
  const current = Array.isArray(segments) ? segments : [];
  if (current.length === 0) {
    return [{ type: "text", text: "", isStreaming: false }];
  }
  const last = current[current.length - 1];
  if (last.type === "text") return current;
  return [...current, { type: "text", text: "", isStreaming: false }];
}

function appendDeltaToSegments(segments, delta) {
  const value = String(delta || "");
  if (!value) return Array.isArray(segments) ? segments : [];
  const current = ensureTextSegment(segments);
  const last = current[current.length - 1];
  return [
    ...current.slice(0, -1),
    { ...last, text: `${last.text || ""}${value}`, isStreaming: true },
  ];
}

function replaceLastTextSegment(segments, text) {
  const current = ensureTextSegment(segments);
  const lastIndex = current.length - 1;
  return current.map((seg, index) =>
    index === lastIndex && seg.type === "text"
      ? { ...seg, text, isStreaming: false }
      : seg,
  );
}

function finishStreamingSegments(segments) {
  return (Array.isArray(segments) ? segments : []).map((seg) =>
    seg.type === "text" ? { ...seg, isStreaming: false } : seg,
  );
}

function applyCodeWikiEventToMessage(message, event) {
  switch (event?.type) {
    case "assistant:delta":
      return {
        ...message,
        segments: appendDeltaToSegments(message.segments, event.text),
      };
    case "assistant:response":
      return {
        ...message,
        segments: event.text
          ? replaceLastTextSegment(message.segments, event.text)
          : finishStreamingSegments(message.segments),
      };
    case "tool:start":
      return {
        ...message,
        segments: addToolToSegments(message.segments, {
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          status: "running",
          durationMs: null,
          summary: "",
          result: "",
        }),
      };
    case "tool:result":
      return {
        ...message,
        segments: updateToolInSegments(message.segments, event.id, (card) => ({
          ...card,
          result: event.content || card.result || "",
        })),
      };
    case "tool:end":
      return {
        ...message,
        segments: updateToolInSegments(message.segments, event.id, (card) => ({
          ...card,
          status: "done",
          durationMs: event.durationMs,
          summary: event.summary || card.summary || "",
        })),
      };
    case "tool:error":
      return {
        ...message,
        segments: updateToolInSegments(message.segments, event.id, (card) => ({
          ...card,
          status: "error",
          durationMs: event.durationMs,
          summary: event.summary || card.summary || "",
        })),
      };
    case "tool:blocked":
      return {
        ...message,
        segments: updateToolInSegments(message.segments, event.id, (card) => ({
          ...card,
          status: "blocked",
          summary: card.summary || "Tool blocked",
        })),
      };
    case "codewiki:done":
      return {
        ...message,
        loading: false,
        segments: finishStreamingSegments(message.segments),
      };
    case "codewiki:error":
      return {
        ...message,
        role: "error",
        loading: false,
        segments: [
          {
            type: "text",
            text: event.message || "CodeWiki 问答失败",
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
}) {
  const [reports, setReports] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [frameError, setFrameError] = useState(false);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [sawRuntimeBusy, setSawRuntimeBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingReport, setDeletingReport] = useState(false);
  const [generationDepth, setGenerationDepth] = useState("standard");
  const [chatMessages, setChatMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const chatScrollRef = useRef(null);

  const selected = useMemo(
    () => reports.find((report) => report.file === selectedFile) || null,
    [reports, selectedFile],
  );

  const reportUrl = selected
    ? `/api/codewiki/report/${encodeURIComponent(selected.file)}`
    : "";

  const loadReports = useCallback(async ({ preferNewest = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchCodeWikiReports();
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
    } catch (err) {
      setError(err?.message || "无法加载 CodeWiki 报告");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setReports([]);
    setSelectedFile("");
    setFrameError(false);
    setQuestion("");
    setLastQuestion("");
    setChatMessages([]);
    setAsking(false);
    loadReports({ preferNewest: true });
  }, [loadReports, projectKey]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [chatMessages, asking]);

  useEffect(() => {
    if (generating && busy) setSawRuntimeBusy(true);
  }, [busy, generating]);

  useEffect(() => {
    if (!generating || busy || !sawRuntimeBusy) return;
    loadReports({ preferNewest: true });
    setGenerating(false);
    setSawRuntimeBusy(false);
  }, [busy, generating, loadReports, sawRuntimeBusy]);

  const handleGenerate = async () => {
    if (busy || generating) return;
    setError("");
    setGenerating(true);
    setSawRuntimeBusy(false);
    try {
      const result = await generateCodeWikiReport(generationDepth);
      if (result?.error) {
        setGenerating(false);
        setError(result.message || "无法启动 CodeWiki 生成");
      }
    } catch (err) {
      setGenerating(false);
      setError(err?.message || "无法启动 CodeWiki 生成");
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
        role: "general",
        text: "",
        segments: [],
        timestamp: new Date().toISOString(),
        loading: true,
      },
    ]);
    setAsking(true);
    try {
      await streamCodeWikiAsk({
        question: trimmed,
        reportFile: selected?.file || "",
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
                    text: err?.message || "CodeWiki 问答失败",
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
      const result = await deleteCodeWikiReport(pendingDelete.file);
      if (result?.error) {
        setError(result.message || "无法删除 CodeWiki 报告");
      } else {
        setPendingDelete(null);
        setFrameError(false);
        await loadReports({ preferNewest: false });
      }
    } catch (err) {
      setError(err?.message || "无法删除 CodeWiki 报告");
    } finally {
      setDeletingReport(false);
    }
  };

  const isWorking = busy || generating;
  const askInputLocked = isWorking || asking;

  return (
    <div className="flex-1 min-h-0 bg-(--bg-primary) rounded-[18px] border border-(--border-default) border-b-0 overflow-hidden my-1 mx-1">
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)_420px] max-xl:grid-cols-[220px_minmax(0,1fr)] max-lg:grid-cols-1">
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
              {projectCwd || "当前项目"}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
              {GENERATION_DEPTHS.map((item) => (
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
            <button
              className="mt-3 w-full h-9 rounded-lg border border-(--border-default) bg-(--bg-primary) text-[13px] text-(--text-primary) inline-flex items-center justify-center gap-2 hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleGenerate}
              disabled={isWorking}
            >
              {generating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              {generating ? "生成中" : "生成新的 CodeWiki"}
            </button>
            {generating && (
              <GenerationProgress
                steps={planSteps}
                stageLabel={stageLabel}
                compact
              />
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[12px] font-medium text-(--text-muted)">
              报告
            </span>
            <button
              className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              onClick={() => loadReports({ preferNewest: true })}
              title="刷新报告"
              aria-label="刷新报告"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {loading && (
              <div className="px-3 py-6 text-[12px] text-(--text-muted) inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                加载报告
              </div>
            )}

            {!loading && reports.length === 0 && (
              <div className="mx-2 rounded-lg border border-dashed border-(--border-default) px-3 py-4 text-[12px] leading-5 text-(--text-muted)">
                还没有 requirements 报告。生成后会出现在这里。
              </div>
            )}

            <div className="flex flex-col gap-1">
              {reports.map((report) => (
                <div
                  key={report.file}
                  className={cn(
                    "group w-full rounded-lg px-3 py-2 text-left hover:bg-(--bg-hover) cursor-pointer",
                    selectedFile === report.file && "bg-(--bg-active)",
                  )}
                  onClick={() => {
                    setSelectedFile(report.file);
                    setFrameError(false);
                  }}
                >
                  <span className="flex items-start gap-2 text-[13px] text-(--text-primary)">
                    <FileText
                      size={14}
                      className="shrink-0 mt-0.5 text-(--text-muted)"
                    />
                    <span className="min-w-0 flex-1 break-words">
                      {report.file}
                    </span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) opacity-0 hover:bg-(--bg-active) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                          aria-label="报告操作"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-36 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="w-full rounded-md px-2.5 py-2 text-left text-[13px] text-(--accent-red) hover:bg-(--accent-red-bg)"
                          onClick={() => setPendingDelete(report)}
                        >
                          删除
                        </button>
                      </PopoverContent>
                    </Popover>
                  </span>
                  <span className="mt-1 block truncate pl-6 text-[11px] text-(--text-muted)">
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
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              生成
            </button>
          </div> */}

          {error && (
            <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400 inline-flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="flex-1 min-h-0 p-4">
            {!selected && !loading ? (
              <div className="h-full min-h-[420px] rounded-xl border border-dashed border-(--border-default) bg-(--bg-secondary) flex flex-col items-center justify-center text-center px-8">
                <BookOpenText size={34} className="text-(--text-muted)" />
                <h2 className="mt-4 text-[18px] font-semibold text-(--text-primary)">
                  还没有 CodeWiki
                </h2>
                <p className="mt-2 max-w-md text-[13px] leading-6 text-(--text-muted)">
                  生成当前项目的 requirements
                  报告后，这里会展示架构图、接口需求、流程和风险说明。
                </p>
                <button
                  className="mt-5 h-10 rounded-lg bg-(--text-primary) px-4 text-[13px] font-medium text-(--bg-primary) inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleGenerate}
                  disabled={isWorking}
                >
                  {generating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {generating ? "正在生成" : "生成新的 CodeWiki"}
                </button>
                <div className="mt-3 grid w-full max-w-xs grid-cols-3 gap-1 rounded-lg border border-(--border-default) bg-(--bg-primary) p-1">
                  {GENERATION_DEPTHS.map((item) => (
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
                {generating && (
                  <GenerationProgress
                    steps={planSteps}
                    stageLabel={stageLabel}
                  />
                )}
              </div>
            ) : (
              <div className="h-full min-h-[420px] overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary)">
                {frameError ? (
                  <div className="h-full flex flex-col items-center justify-center px-8 text-center">
                    <AlertCircle size={28} className="text-(--text-muted)" />
                    <p className="mt-3 text-[13px] text-(--text-secondary)">
                      报告加载失败。
                    </p>
                    <button
                      className="mt-4 h-8 rounded-md border border-(--border-default) px-3 text-[12px] text-(--text-primary) hover:bg-(--bg-hover)"
                      onClick={() => setFrameError(false)}
                    >
                      重试
                    </button>
                  </div>
                ) : selected ? (
                  <iframe
                    key={selected.file}
                    title={`CodeWiki ${selected.file}`}
                    src={reportUrl}
                    sandbox="allow-scripts"
                    className="h-full w-full border-0 bg-white"
                    onLoad={() => setFrameError(false)}
                    onError={() => setFrameError(true)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[13px] text-(--text-muted)">
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    加载中
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="border-l border-(--border-default) bg-(--bg-secondary) min-h-0 flex flex-col max-xl:hidden">
          <div className="p-4 border-b border-(--border-default)">
            {/* <div className="flex items-center gap-2 text-(--text-primary)">
              <MessageSquareText size={17} />
              <span className="font-medium text-[14px]">
                Ask this repository
              </span>
            </div> */}
            <p className="mt-2 text-[12px] leading-5 text-(--text-muted)">
              {generating
                ? "CodeWiki 生成完成前暂不接受提问。"
                : "临时只读问答，不会修改项目，也不会保存到会话历史。"}
            </p>
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
          >
            {chatMessages.length === 0 ? (
              <div className="rounded-xl border border-(--border-default) bg-(--bg-primary) p-4">
                {/* <Sparkles size={22} className="text-(--text-muted)" /> */}
                <p className="text-[13px] font-medium text-(--text-primary)">
                  {generating
                    ? "正在生成 CodeWiki"
                    : asking || busy
                      ? "当前问题处理中"
                      : "可以问当前项目"}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-(--text-muted)">
                  {generating
                    ? "生成完成后再基于报告提问。"
                    : lastQuestion ||
                      "例如：主要业务流程是什么？哪些接口风险最高？"}
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
                          <Loader2 size={14} className="animate-spin" />
                          正在回答...
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
                    ? "CodeWiki 正在生成"
                    : asking || busy
                      ? "正在回答..."
                      : "Ask about this repository"
                }
                disabled={askInputLocked}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-(--text-primary) outline-none placeholder:text-(--text-muted) disabled:opacity-60"
              />
              <button
                type="submit"
                className="inline-flex size-7 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-50"
                disabled={askInputLocked || !question.trim()}
                aria-label="发送问题"
              >
                {asking ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <SendHorizontal size={15} />
                )}
              </button>
            </div>
          </form>
        </aside>
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除 CodeWiki 报告？"
        description={`报告「${pendingDelete?.title || pendingDelete?.file || ""}」会从当前项目历史报告中移除，此操作不可撤销。`}
        loading={deletingReport}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={confirmDeleteReport}
      />
    </div>
  );
}
