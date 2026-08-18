import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChartLine,
  Clock,
  Copy,
  Eraser,
  Info,
  ListChecks,
  Plug,
  ShieldWarning,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getModelLogo } from "@/lib/message-model-identity.js";
import { t } from "../../i18n/index.js";
import * as api from "@/hooks/use-api.js";
import { TodoList } from "./TodoList";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const STAGE_LIVE_CLASS = "linear-status-dot linear-status-dot--sm";

const SDK_LOGO_MAP = {
  "openai-compatible": "/logos/openai.svg",
  anthropic: "/logos/claude-color.svg",
};

function ModelLogo({ src, size = 13 }) {
  if (!src) return null;
  const needsLightBg = src.includes("kimi");
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn(
        "shrink-0 rounded-sm object-contain",
        needsLightBg && "dark:bg-white",
      )}
    />
  );
}

// ── 相对/绝对时间 ──
function relativeTimeLabel(iso) {
  if (!iso) return t("statusBarJustNow");
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return t("statusBarJustNow");
  const delta = Date.now() - then;
  if (delta < 0) return t("statusBarJustNow");
  const sec = Math.floor(delta / 1000);
  if (sec < 10) return t("statusBarJustNow");
  if (sec < 60) return t("statusBarSecondsAgo").replace("{{n}}", String(sec));
  const min = Math.floor(sec / 60);
  if (min < 60) return t("statusBarMinutesAgo").replace("{{n}}", String(min));
  const hour = Math.floor(min / 60);
  if (hour < 24) return t("statusBarHoursAgo").replace("{{n}}", String(hour));
  const day = Math.floor(hour / 24);
  return t("statusBarDaysAgo").replace("{{n}}", String(day));
}

function absoluteTimeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// ── 可点击指标胶囊 ──
function StatusChip({ icon: Icon, label, badge = 0, badgeTone, title, children }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] text-(--text-muted) hover:bg-(--bg-hover)",
            badgeTone === "error" && badge > 0 && "text-(--accent-red)",
          )}
        >
          <Icon size={13} className="shrink-0 opacity-70" />
          <span className="hidden md:inline">{label}</span>
          {badge > 0 ? (
            <span
              className={cn(
                "min-w-[15px] px-1 rounded-full bg-(--badge-bg) text-[10px] leading-[15px] text-center text-(--text-primary)",
                badgeTone === "error" && "bg-(--accent-red-bg) text-(--accent-red)",
              )}
            >
              {badge}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="max-h-[320px] overflow-auto">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ── 工具计数明细 ──
function ToolBreakdown({ entries, total }) {
  if (total === 0) {
    return <div className="px-2 py-2 text-[12px] text-(--text-muted)">{t("statusBarToolsEmpty")}</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 py-1.5 text-[12px] font-medium text-(--text-primary)">
        {t("statusBarToolCountTotal").replace("{{count}}", String(total))}
      </div>
      {entries.map(([name, count]) => (
        <div
          key={name}
          className="flex items-center justify-between gap-6 px-2 py-1 text-[12px] text-(--text-secondary)"
        >
          <span className="truncate">{name}</span>
          <span className="font-mono text-(--text-primary)">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ── 系统环境信息 ──
function SystemInfo({ env, sessionId }) {
  const [git, setGit] = useState(null);
  const [gitLoaded, setGitLoaded] = useState(false);
  const loadGit = () => {
    if (gitLoaded || !sessionId) return;
    setGitLoaded(true);
    api.fetchGitInfo(sessionId).then(setGit).catch(() => setGit({}));
  };

  // Popover 内容按需挂载，挂载即代表用户打开了系统指示器——此时异步采集 Git 分支/状态。
  useEffect(() => {
    loadGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGit = Boolean(git?.isGit ?? env?.git?.isGit);
  const branch = git?.branch ?? env?.git?.branch ?? null;
  const dirty = git?.dirty ?? env?.git?.dirty ?? null;

  const rows = [
    [t("statusBarEnvPlatform"), env?.platform || "-"],
    [t("statusBarEnvNode"), env?.nodeVersion || "-"],
    [t("statusBarEnvShell"), env?.shell || "-"],
    [t("statusBarEnvSandbox"), env?.sandboxMode || "-"],
    [t("statusBarEnvWorkspace"), env?.workspaceRoot || "-"],
    [
      t("statusBarEnvGit"),
      !isGit
        ? t("statusBarEnvNotGit")
        : `${branch || "—"}${dirty != null ? ` · ${dirty ? t("statusBarEnvDirty") : t("statusBarEnvClean")}` : ""}`,
    ],
    [t("statusBarEnvModel"), env?.model || "-"],
    [t("statusBarEnvProvider"), env?.provider || "-"],
    [t("statusBarEnvMode"), env?.executionMode || "-"],
  ];

  return (
    <div className="flex flex-col">
      <div className="px-2 py-1.5 text-[12px] font-medium text-(--text-primary)">
        {t("statusBarSystemTitle")}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-6 px-2 py-1 text-[12px]">
            <span className="shrink-0 text-(--text-muted)">{label}</span>
            <span className="min-w-0 break-all text-right text-(--text-secondary)">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 错误详情对话框 ──
function ErrorDialog({ open, onOpenChange, sessionId, count, onClearErrors }) {
  const [details, setDetails] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .fetchSessionErrors(sessionId)
      .then((res) => {
        if (!cancelled) setDetails(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        if (!cancelled) setDetails([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  useEffect(() => {
    if (open && autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, details, autoScroll]);

  const categoryLabel = (category) =>
    category === "blocked" ? t("statusBarErrorCategoryBlocked") : t("statusBarErrorCategoryError");

  const copyStacks = async () => {
    const text = details
      .map((d) => `[${categoryLabel(d.category)}] ${d.tool || ""}\n${d.message || ""}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const clearErrors = async () => {
    if (typeof onClearErrors === "function") {
      await onClearErrors();
    } else {
      await api.clearSessionErrors(sessionId).catch(() => {});
    }
    setDetails([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("statusBarErrorTitle")}</DialogTitle>
          <DialogDescription>
            {t("statusBarToolCountTotal").replace("{{count}}", String(count))}
          </DialogDescription>
        </DialogHeader>

        {details.length === 0 ? (
          <div className="px-1 py-4 text-center text-[13px] text-(--text-muted)">
            {t("statusBarErrorsEmpty")}
          </div>
        ) : (
          <div
            ref={listRef}
            className="flex max-h-[300px] flex-col gap-2 overflow-y-auto pr-1"
          >
            {details.map((d, i) => (
              <div
                key={i}
                className="rounded-lg border border-(--border-default) bg-(--bg-primary) p-2.5"
              >
                <div className="flex items-center gap-2 text-[11px] text-(--text-muted)">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                      d.category === "blocked"
                        ? "bg-(--accent-orange-bg) text-(--accent-orange)"
                        : "bg-(--accent-red-bg) text-(--accent-red)",
                    )}
                  >
                    {d.category === "blocked" ? <ShieldWarning size={11} /> : <WarningCircle size={11} />}
                    {categoryLabel(d.category)}
                  </span>
                  <span className="font-mono">{d.tool || "(unknown)"}</span>
                  <span className="ml-auto">{absoluteTimeLabel(d.at)}</span>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-(--text-secondary)">
                  {d.message || ""}
                </pre>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-(--separator) pt-3">
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:bg-(--bg-hover)",
              autoScroll ? "text-(--text-primary)" : "text-(--text-muted)",
            )}
          >
            <span
              className={cn(
                "size-3.5 rounded border border-(--border-default)",
                autoScroll && "bg-(--text-primary)",
              )}
            />
            {t("statusBarErrorAutoScroll")}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyStacks}>
              <Copy size={13} />
              {copied ? t("statusBarErrorCopied") : t("statusBarErrorCopy")}
            </Button>
            <Button variant="destructive" size="sm" onClick={clearErrors}>
              <Eraser size={13} />
              {t("statusBarErrorClear")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StatusBar({ runtimeState, live, stageLabel, onClearErrors }) {
  const rs = runtimeState || {};
  const mode = rs.mode || "normal";
  const approvalMode = rs.approvalMode || "auto";
  const used = rs.currentContextTokens || 0;
  const max = rs.maxContextTokens || 0;
  const pct = Number.isFinite(rs.contextUsagePct)
    ? Math.round(rs.contextUsagePct)
    : max
      ? Math.round((used / max) * 100)
      : 0;
  const contextColor =
    pct < 40
      ? "bg-(--accent-green)"
      : pct < 75
        ? "bg-(--accent-orange)"
        : "bg-(--accent-red)";

  const modelLogo = getModelLogo(rs.model);
  const sdkLogo = SDK_LOGO_MAP[rs.sdkProvider];

  // 新增指标
  const sessionId = rs.sessionId || "";
  const toolCounts = rs.toolCallCounts || {};
  const toolEntries = useMemo(
    () => Object.entries(toolCounts).sort((a, b) => Number(b[1]) - Number(a[1])),
    [toolCounts],
  );
  const totalTools = useMemo(
    () => toolEntries.reduce((sum, [, n]) => sum + (Number(n) || 0), 0),
    [toolEntries],
  );
  const todos = rs.activeTodos || [];
  const activeTodoCount = Number.isFinite(rs.activeTodoCount)
    ? rs.activeTodoCount
    : todos.length;
  const errorCount = Number(rs.errorCount || 0);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);

  return (
    <div className="flex items-center gap-2.5 flex-1 min-w-0 text-[11px] text-(--text-muted) overflow-hidden">
      <span className="hidden xl:inline-flex items-center gap-1 whitespace-nowrap">
        {sdkLogo ? (
          <ModelLogo src={sdkLogo} />
        ) : (
          <Plug size={13} className="shrink-0 opacity-70" />
        )}
        <span>{rs.sdkProvider?.toUpperCase() || "-"}</span>
      </span>
      <span className="hidden lg:inline-flex items-center gap-1 whitespace-nowrap">
        {modelLogo ? (
          <ModelLogo src={modelLogo} />
        ) : (
          <Brain size={13} className="shrink-0 opacity-70" />
        )}
        <span>{rs.model?.toUpperCase() || "-"}</span>
      </span>

      {max > 0 && (
        <span className="hidden lg:inline-flex items-center gap-1 whitespace-nowrap">
          <ChartLine size={13} className="shrink-0 opacity-70" />
          <span>CTX</span>
          <span className="w-12 h-1 bg-(--muted) rounded-full overflow-hidden">
            <span
              className={cn(
                "block h-full rounded-full transition-all",
                contextColor,
              )}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{pct}%</span>
        </span>
      )}

      {/* 时间戳 */}
      <span
        className="hidden md:inline-flex items-center gap-1 whitespace-nowrap"
        title={absoluteTimeLabel(rs.lastActivityAt)}
      >
        <Clock size={13} className="shrink-0 opacity-70" />
        <span>{relativeTimeLabel(rs.lastActivityAt)}</span>
      </span>

      {/* todo 徽章 */}
      <StatusChip
        icon={ListChecks}
        label={t("statusBarTodos")}
        badge={activeTodoCount}
        title={t("statusBarTodos")}
      >
        {todos.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-(--text-muted)">{t("statusBarTodosEmpty")}</div>
        ) : (
          <TodoList todos={todos} />
        )}
      </StatusChip>

      {/* 工具计数徽章 */}
      <StatusChip icon={Wrench} label={t("statusBarTools")} badge={totalTools} title={t("statusBarTools")}>
        <ToolBreakdown entries={toolEntries} total={totalTools} />
      </StatusChip>

      {/* 错误徽章 */}
      <button
        type="button"
        title={t("statusBarErrors")}
        onClick={() => setErrorDialogOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] hover:bg-(--bg-hover)",
          errorCount > 0 ? "text-(--accent-red)" : "text-(--text-muted)",
        )}
      >
        <WarningCircle size={13} className="shrink-0 opacity-70" />
        <span className="hidden md:inline">{t("statusBarErrors")}</span>
        {errorCount > 0 ? (
          <span className="min-w-[15px] px-1 rounded-full bg-(--accent-red-bg) text-[10px] leading-[15px] text-center text-(--accent-red)">
            {errorCount}
          </span>
        ) : null}
      </button>

      {/* 系统环境指示器 */}
      <StatusChip icon={Info} label={t("statusBarSystem")} badge={0} title={t("statusBarSystem")}>
        <SystemInfo env={rs.systemEnv} sessionId={sessionId} />
      </StatusChip>

      <span className="inline-flex items-center gap-1 ml-auto whitespace-nowrap">
        {live ? (
          <span
            className={cn(STAGE_LIVE_CLASS, "shrink-0")}
            aria-hidden="true"
          />
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 bg-(--text-muted)"
            aria-hidden="true"
          />
        )}
        <span>{live ? stageLabel : t("idle")}</span>
      </span>

      <ErrorDialog
        open={errorDialogOpen}
        onOpenChange={setErrorDialogOpen}
        sessionId={sessionId}
        count={errorCount}
        onClearErrors={onClearErrors}
      />
    </div>
  );
}
