import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  DotsSixVertical,
  FolderSimple,
  GitDiff as GitDiffIcon,
  Monitor,
  Plus,
  Terminal as TerminalIcon,
  X,
} from "@/lib/icons";
import { AgentTerminalPanel } from "@/components/AgentTerminalPanel.jsx";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "../../i18n/index.js";

const FileTreePanel = lazy(() => import("@/components/FileTreePanel.jsx").then(({ FileTreePanel }) => ({ default: FileTreePanel })));
const GitChangesPanel = lazy(() => import("@/components/GitChangesPanel.jsx").then(({ GitChangesPanel }) => ({ default: GitChangesPanel })));
const TerminalPanel = lazy(() => import("@/components/TerminalPanel.jsx").then(({ TerminalPanel }) => ({ default: TerminalPanel })));
const VisualFeedbackPanel = lazy(() => import("@/components/VisualFeedbackPanel.jsx").then(({ VisualFeedbackPanel }) => ({ default: VisualFeedbackPanel })));
const DEFAULT_PANEL_WIDTH = 500;
const MIN_PANEL_WIDTH = 340;
const TAB_CLASS = "h-8 shrink-0 flex-none gap-1.5 px-2 text-[12px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--accent-blue)";
const PANEL_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden";

function VisualFeedbackBetaBadge() {
  return (
    <Badge variant="outline" className="h-4 rounded-md px-1 py-0 text-[9px] font-semibold uppercase leading-none tracking-wide text-(--text-muted)">
      {t("visualFeedbackBeta")}
    </Badge>
  );
}
const WORKSPACE_TOOLS = [
  { type: "files", label: "workspaceFilesTab", icon: FolderSimple },
  { type: "terminal", label: "terminalTitle", icon: TerminalIcon },
  { type: "visual-feedback", label: "visualFeedbackTab", icon: Monitor },
  { type: "git", label: "workspaceGitTab", icon: GitDiffIcon },
];

function ClosableWorkspaceTab({ tab, name, title, onClose, children }) {
  const closeLabel = t(tab.type === "agent" ? "workspaceHideAgentTab" : "workspaceCloseTab").replace("{{name}}", name);
  return (
    <div className="relative flex shrink-0 items-center">
      <TabsTrigger value={tab.id} title={title} className={`${TAB_CLASS} pr-7`} onKeyDown={(event) => {
        if (event.key === "Delete") {
          event.preventDefault();
          void onClose(tab);
        }
      }}>
        {children}
      </TabsTrigger>
      <button
        type="button"
        className="absolute right-1 inline-flex size-5 items-center justify-center rounded text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--accent-blue)"
        title={closeLabel}
        aria-label={closeLabel}
        onClick={() => onClose(tab)}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

function WorkspacePicker({ onChooseTool, disabled, isGit }) {
  return (
    <div className="flex min-h-0 flex-1 items-center overflow-auto px-5 py-8">
      <div className="mx-auto w-full max-w-[26rem]">
        <h2 className="mb-3 text-sm font-medium text-(--text-primary)">{t("workspaceOpenTool")}</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {WORKSPACE_TOOLS.map(({ type, label, icon: Icon }) => {
            const unavailable = disabled ? t("workspaceNeedsProject") : type === "git" && !isGit ? t("workspaceGitNeedsRepo") : "";
            return (
              <button
                key={type}
                type="button"
                disabled={Boolean(unavailable)}
                title={unavailable || t(label)}
                className="flex min-h-24 flex-col items-start gap-3 rounded-lg border border-(--border-default) px-3.5 py-3.5 text-left text-[13px] text-(--text-primary) hover:bg-(--bg-hover) focus-visible:outline-2 focus-visible:outline-(--accent-blue) disabled:opacity-50"
                onClick={() => onChooseTool(type)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="flex w-full flex-wrap items-center gap-1.5">
                  <span>{t(label)}</span>
                  {type === "visual-feedback" ? <VisualFeedbackBetaBadge /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceRail({
  locale,
  tabState,
  onTabChange,
  onNewTab,
  onChooseTool,
  onCloseTab,
  sessionId = "",
  projectCwd = "",
  isGit = false,
  commands = [],
  onAddReference,
  onClose,
}) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [closeError, setCloseError] = useState("");
  const [filesVisited, setFilesVisited] = useState(false);
  const resizingRef = useRef(false);
  const tabsRef = useRef(null);
  const { tabs, activeId } = tabState;
  const command = commands.find((item) => item.id === activeId);
  const activeTool = tabs.find((tab) => tab.id === activeId) || (!command ? tabs.at(-1) : null);
  const activeTab = activeTool?.id || command?.id;
  const filesOpened = tabs.some((tab) => tab.type === "files");
  const workspaceDisabled = !String(projectCwd || "").trim();

  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (activeTab === "files") setFilesVisited(true);
  }, [activeTab]);

  async function closeTab(tab) {
    setCloseError("");
    try {
      await onCloseTab(tab);
      if (tab.type === "files") setFilesVisited(false);
      requestAnimationFrame(() => tabsRef.current?.querySelector('[aria-selected="true"]')?.focus());
    } catch (error) {
      setCloseError(error?.message || t("terminalDisconnected"));
    }
  }

  const updatePanelWidth = (clientX) => {
    const maxWidth = Math.max(
      MIN_PANEL_WIDTH,
      Math.floor(window.innerWidth * 0.72),
    );
    setPanelWidth(
      Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, window.innerWidth - clientX)),
    );
  };

  return (
    <aside
      id="chat-workspace-rail"
      lang={locale}
      className="codemini-workspace-rail relative z-20 flex min-h-0 shrink-0 flex-col max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-full! max-md:shadow-xl"
      style={{ width: `${panelWidth}px` }}
      aria-label={t("workspaceRailTitle")}
    >
      <div
        className="codemini-terminal-resizer absolute inset-y-0 -left-2 z-30 flex w-2 cursor-col-resize touch-none select-none items-center justify-center border-0! max-md:hidden"
        role="separator"
        aria-label={t("workspaceRailResize")}
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
            setPanelWidth((value) => Math.max(MIN_PANEL_WIDTH, value - 24));
          }
        }}
      >
        <span className="codewiki-resizer-handle">
          <DotsSixVertical size={10} aria-hidden="true" />
        </span>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} activationMode="manual" className="codemini-workspace-rail-body min-h-0 flex-1 gap-0 overflow-hidden">
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-(--border-default) px-2">
          <TabsList ref={tabsRef} aria-label={t("workspaceRailTitle")} className="codemini-workspace-tabs w-auto min-w-0 flex-1 justify-start gap-1 overflow-x-scroll overflow-y-hidden bg-transparent">
            {tabs.map((tab) => {
              const tool = WORKSPACE_TOOLS.find(({ type }) => tab.type === type);
              const Icon = tool?.icon || Plus;
              const name = tab.type === "terminal" ? `${t("terminalTitle")} ${tab.number}` : t(tool?.label || "workspaceNewTab");
              return (
                <ClosableWorkspaceTab key={tab.id} tab={tab} name={name} onClose={closeTab}>
                  <Icon size={14} aria-hidden="true" />
                  {name}
                  {tab.type === "visual-feedback" ? <VisualFeedbackBetaBadge /> : null}
                </ClosableWorkspaceTab>
              );
            })}
            {commands.map((item, index) => {
              const status = t("terminalRunning");
              return (
                <ClosableWorkspaceTab key={item.id} tab={{ id: item.id, type: "agent" }} name={item.command} title={`${item.command} · ${status}`} onClose={closeTab}>
                  <TerminalIcon size={14} />
                  <span className="text-[11px] tabular-nums text-(--text-muted)">{index + 1}</span>
                  <span className="max-w-36 truncate">{item.command}</span>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--accent-blue)" />
                  <span className="sr-only">{status}</span>
                </ClosableWorkspaceTab>
              );
            })}
          </TabsList>
          <button type="button" className="codemini-terminal-action" aria-label={t("workspaceNewTab")} title={t("workspaceNewTab")} onClick={onNewTab}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="codemini-terminal-action"
            title={t("workspaceCollapseRail")}
            aria-label={t("workspaceCollapseRail")}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {closeError ? <p role="status" className="px-3 py-2 text-[12px] text-(--accent-red)">{closeError}</p> : null}
        <Suspense fallback={<p role="status" className="px-3 py-3 text-[12px] text-(--text-muted)">{t("workspaceToolLoading")}</p>}>
        {activeTool?.type === "new" ? (
          <TabsContent value={activeTab} className={PANEL_CLASS}>
            <WorkspacePicker onChooseTool={onChooseTool} disabled={workspaceDisabled} isGit={isGit} />
          </TabsContent>
        ) : null}
        {filesOpened && (activeTab === "files" || filesVisited) ? (
          <TabsContent value="files" forceMount className={PANEL_CLASS}>
            <FileTreePanel sessionId={sessionId} projectCwd={projectCwd} disabled={workspaceDisabled} visible={activeTab === "files"} onAddReference={onAddReference} />
          </TabsContent>
        ) : null}
        {activeTool?.type === "terminal" ? (
          <TabsContent value={activeTab} className={PANEL_CLASS}>
            <TerminalPanel key={activeTab} terminalId={activeTab} sessionId={sessionId} projectCwd={projectCwd} disabled={workspaceDisabled} embedded />
          </TabsContent>
        ) : null}
        {activeTool?.type === "visual-feedback" ? (
          <TabsContent value="visual-feedback" className={PANEL_CLASS}>
            <VisualFeedbackPanel sessionId={sessionId} projectCwd={projectCwd} disabled={workspaceDisabled} />
          </TabsContent>
        ) : null}
        {activeTool?.type === "git" ? (
          <TabsContent value="git" className={PANEL_CLASS}>
            <GitChangesPanel sessionId={sessionId} projectCwd={projectCwd} />
          </TabsContent>
        ) : null}
        </Suspense>
        {command ? (
          <TabsContent value={command.id} className={PANEL_CLASS}>
            <AgentTerminalPanel key={`${sessionId}:${command.id}`} sessionId={sessionId} command={command} />
          </TabsContent>
        ) : null}
      </Tabs>
    </aside>
  );
}
