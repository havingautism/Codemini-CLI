import React, {
  Component,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/app-context.jsx";
import { useGitWorkspace } from "@/hooks/use-git-workspace.js";
import { t } from "../i18n/index.js";
import { Sidebar } from "@/components/Sidebar.jsx";
import { ChatPanel } from "@/components/ChatPanel.jsx";
import { InputBar } from "@/components/InputBar.jsx";
import { StatusBar } from "@/components/StatusBar.jsx";
import { ApprovalDialog } from "@/components/ApprovalDialog.jsx";
import { ReflectApprovalDialog } from "@/components/ReflectApprovalDialog.jsx";
import { DreamDialog } from "@/components/DreamDialog.jsx";
import { SpecApprovalDialog } from "@/components/SpecApprovalDialog.jsx";
import { RuntimeActivityStrip } from "@/components/RuntimeActivityStrip.jsx";
import { TowerProgressDock } from "@/components/TowerProgressDock.jsx";
import { SessionPanel } from "@/components/SessionPanel.jsx";
import { TodoCard } from "@/components/TodoList.jsx";
import { findLiveTodoDock } from "@/lib/live-todo-dock.js";
import { interactiveRequestForSession } from "@/lib/session-ui-state.js";
import { DotsThree, FolderSimple, GitDiff, List, SidebarSimple, Terminal } from "@/lib/icons";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrajectoryPanel } from "@/components/TrajectoryPanel.jsx";
import "../style.css";
import "./apple-design.css";

const CodeWikiPanel = lazy(() =>
  import("@/components/CodeWikiPanel.jsx").then((module) => ({
    default: module.CodeWikiPanel,
  })),
);
const ConfigDialog = lazy(() =>
  import("@/components/ConfigDialog.jsx").then((module) => ({
    default: module.ConfigDialog,
  })),
);
const ProjectSelector = lazy(() =>
  import("@/components/ProjectSelector.jsx").then((module) => ({
    default: module.ProjectSelector,
  })),
);
const SkillDialog = lazy(() =>
  import("@/components/SkillDialog.jsx").then((module) => ({
    default: module.SkillDialog,
  })),
);
const McpDialog = lazy(() =>
  import("@/components/McpDialog.jsx").then((module) => ({
    default: module.McpDialog,
  })),
);
const HooksDialog = lazy(() =>
  import("@/components/HooksDialog.jsx").then((module) => ({
    default: module.HooksDialog,
  })),
);
const MemoryDialog = lazy(() =>
  import("@/components/MemoryDialog.jsx").then((module) => ({
    default: module.MemoryDialog,
  })),
);
const ScrapbookPanel = lazy(() =>
  import("@/components/ScrapbookPanel.jsx").then((module) => ({
    default: module.ScrapbookPanel,
  })),
);
const ResearchPanel = lazy(() =>
  import("@/components/ResearchPanel.jsx").then((module) => ({
    default: module.ResearchPanel,
  })),
);
const SoulDialog = lazy(() =>
  import("@/components/SoulDialog.jsx").then((module) => ({
    default: module.SoulDialog,
  })),
);
const AboutDialog = lazy(() =>
  import("@/components/AboutDialog.jsx").then((module) => ({
    default: module.AboutDialog,
  })),
);
const WorkspaceRail = lazy(() =>
  import("@/components/WorkspaceRail.jsx").then((module) => ({
    default: module.WorkspaceRail,
  })),
);

const MemoSidebar = memo(Sidebar);
const MemoInputBar = memo(InputBar);
const MemoStatusBar = memo(StatusBar);

function projectLabelFromDir(dir, isGeneral = false) {
  if (isGeneral) return t("generalChat");
  const value = String(dir || "").trim();
  if (!value || value === "unknown") return t("unknownProject");
  return value.split(/[/\\]/).filter(Boolean).pop() || value;
}

function collectSidebarProjectTargets(
  sessions = [],
  currentDir = "",
  runtimeDir = "",
  runtimeIsGeneral = false,
) {
  const targets = new Map();
  const addTarget = (dir, isGeneral = false) => {
    const value = String(dir || "").trim();
    if (!value || value === "unknown" || targets.has(value)) return;
    targets.set(value, {
      dir: value,
      label: projectLabelFromDir(value, isGeneral),
      isGeneral: !!isGeneral,
    });
  };
  for (const session of sessions || []) {
    addTarget(session?.projectDir, session?.isGeneral);
  }
  addTarget(currentDir, false);
  addTarget(runtimeDir, runtimeIsGeneral);
  return Array.from(targets.values());
}

function GitHubIcon({ size = 14, className, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56v-2.18c-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.67 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.03 0 0 .97-.31 3.16 1.17A10.98 10.98 0 0 1 12 6.07c.98 0 1.96.13 2.88.39 2.19-1.48 3.15-1.17 3.15-1.17.63 1.57.24 2.74.12 3.03.74.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.38-5.25 5.66.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            color: "#d84f4f",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: 8 }}>{t("renderError")}</p>
          <pre style={{ whiteSpace: "pre-wrap", opacity: 0.8 }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 12,
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid #d84f4f",
              background: "transparent",
              color: "#d84f4f",
              cursor: "pointer",
            }}
          >
            {t("retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Shell() {
  const { state, actions } = useApp();
  const approvalRequest = interactiveRequestForSession(state, "approval");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activateProject, setActivateProject] = useState({ dir: "", token: 0 });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = localStorage.getItem("codemini-sidebar-collapsed");
      return raw === "1" || raw === "true";
    } catch {
      return false;
    }
  });
  const [sideRailOpen, setSideRailOpen] = useState(false);
  const [sideRailTab, setSideRailTab] = useState("files");
  const [chatPageTab, setChatPageTab] = useState("conversation");
  const prevSessionIdRef = useRef(state.currentSessionId);
  if (prevSessionIdRef.current !== state.currentSessionId) {
    prevSessionIdRef.current = state.currentSessionId;
    setChatPageTab("conversation");
  }

  const setSidebarCollapsedAndPersist = useCallback((collapsed) => {
    const value = !!collapsed;
    setSidebarCollapsed(value);
    try {
      localStorage.setItem("codemini-sidebar-collapsed", value ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, []);
  const rs = state.runtimeState || {};
  const git = useGitWorkspace();
  const projectIsGit = git.isLoading || git.isGit === true;
  const currentId = state.currentSessionId || rs.sessionId;

  useEffect(() => {
    if (git.isReady && !git.isGit && sideRailTab === "git") {
      setSideRailTab("files");
    }
  }, [git.isReady, git.isGit, sideRailTab]);

  const reasoningSyncKey = useMemo(
    () =>
      `${rs.reasoningEnabled !== false ? "1" : "0"}:${rs.reasoningEffort || "auto"}`,
    [rs.reasoningEnabled, rs.reasoningEffort],
  );
  const openSettings = useCallback(
    () => actions.setConfigOpen(true),
    [actions],
  );
  const openSkills = useCallback(() => actions.setSkillsOpen(true), [actions]);
  const openMcp = useCallback(() => actions.setMcpOpen(true), [actions]);
  const openHooks = useCallback(() => actions.setHooksOpen(true), [actions]);
  const openMemory = useCallback(() => actions.setMemoryOpen(true), [actions]);
  const openScrapbook = useCallback(() => actions.switchView("scrapbook"), [actions]);
  const openResearch = useCallback(() => actions.openResearchHome(), [actions]);
  const openSouls = useCallback(() => actions.setSoulsOpen(true), [actions]);
  const retryMessage = useCallback((prompt) => actions.submit(prompt), [actions]);
  const openAbout = useCallback(() => actions.setAboutOpen(true), [actions]);
  const openProjectSelector = useCallback(
    () => actions.setProjectOpen(true),
    [actions],
  );
  const sidebarProjectTargets = useMemo(
    () =>
      collectSidebarProjectTargets(
        state.sessions,
        "",
        state.runtimeState?.cwd,
        state.isGeneral,
      ),
    [state.sessions, state.runtimeState?.cwd, state.isGeneral],
  );
  const sidebarProjectDirs = useMemo(
    () => sidebarProjectTargets.map((item) => item.dir),
    [sidebarProjectTargets],
  );
  const hasConversation = useMemo(
    () =>
      state.messages.some((message) =>
        ["you", "user", "agent", "assistant"].includes(message?.role),
      ),
    [state.messages],
  );
  const liveTodoDockRef = useRef(null);
  const liveTodoDock = useMemo(
    () =>
      findLiveTodoDock(state.messages, {
        busy: state.busy,
        previous: liveTodoDockRef.current,
        towerActive: Boolean(state.runtimeState?.towerActive),
      }),
    [state.busy, state.messages, state.runtimeState?.towerActive],
  );
  liveTodoDockRef.current = liveTodoDock;

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const handleNewSession = useCallback(
    async (...args) => {
      closeMobileSidebar();
      return actions.newSession(...args);
    },
    [actions, closeMobileSidebar],
  );

  const handleSwitchSession = useCallback(
    async (...args) => {
      closeMobileSidebar();
      return actions.switchSession(...args);
    },
    [actions, closeMobileSidebar],
  );

  const handleOpenProject = useCallback(
    async (path, options = {}) => {
      closeMobileSidebar();
      const openingGeneral =
        path === "__codemini_general__" || !String(path || "").trim();
      // Pin the sidebar group only after the server resolves the path, using
      // the resolved cwd so relative/`~` inputs match session project keys.
      // Pinning after success also avoids a stray empty group on failure.
      const result = await actions.openProject(path, options);
      if (!openingGeneral && result?.ok && result.cwd) {
        setActivateProject((prev) => ({
          dir: result.cwd,
          token: prev.token + 1,
        }));
      }
      return result;
    },
    [actions, closeMobileSidebar],
  );

  const handleCollapseSidebar = useCallback(() => {
    setSidebarCollapsedAndPersist(true);
  }, [setSidebarCollapsedAndPersist]);

  const sidebar = (
    <MemoSidebar
        sessions={state.sessions}
        sessionsLoading={state.sessionsLoading}
        currentSessionId={currentId}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
        onToggleTheme={actions.toggleTheme}
        onSetTheme={actions.setTheme}
        onOpenSettings={openSettings}
        onOpenSkills={openSkills}
        onOpenMcp={openMcp}
        onOpenHooks={openHooks}
        onOpenMemory={openMemory}
        onOpenScrapbook={openScrapbook}
        onOpenResearch={openResearch}
        onOpenSouls={openSouls}
        onOpenAbout={openAbout}
        gitBatch={state.gitBatch}
        versionInfo={state.versionInfo}
        onUpdate={actions.runUpdate}
        updateStatus={state.updateStatus}
        currentView={state.currentView}
        codewikiProjectPath={state.codewikiProjectPath}
        onSwitchView={actions.switchView}
        onOpenProject={handleOpenProject}
        onOpenProjectSelector={openProjectSelector}
        onRefreshSessions={actions.loadSessions}
        onRegenerateSessionTitle={actions.regenerateSessionTitle}
        onDeleteSession={actions.deleteSession}
        onCollapseSidebar={handleCollapseSidebar}
        currentProjectDir={state.runtimeState?.cwd || ""}
        isGeneral={state.isGeneral}
        activateProjectDir={activateProject.dir}
        activateProjectToken={activateProject.token}
      />
  );

  return (
    <div className="codemini-app-shell flex h-screen overflow-hidden text-(--text-primary)">
      {!sidebarCollapsed ? (
        <div className="hidden md:flex h-full shrink-0 py-2 pl-2 pr-0">
          {sidebar}
        </div>
      ) : null}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[280px] max-w-[82vw] gap-0 border-r p-0 md:hidden"
          showCloseButton
        >
          <SheetTitle className="sr-only">{t("brand")}</SheetTitle>
          <div className="codemini-app-shell h-full">{sidebar}</div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 p-1.5 sm:p-2">
        {state.currentView === "sessions" ? (
          <div className="codemini-workspace-panel flex flex-1 flex-col min-h-0 overflow-hidden">
            <SessionPanel
              sessions={state.sessions}
              sessionsLoading={state.sessionsLoading}
              currentId={currentId}
              onSwitch={actions.switchSession}
              onNew={() =>
                actions.openProject("__codemini_general__", {
                  view: "chat",
                  newSession: true,
                })
              }
              onDelete={actions.deleteSession}
              onAbort={actions.abortSession}
              onAbortAll={actions.abortAllSessions}
            />
          </div>
        ) : state.currentView === "scrapbook" ? (
          <div className="codemini-workspace-panel flex flex-1 flex-col min-h-0 overflow-hidden">
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-(--border-default) px-3 sm:px-5">
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) md:hidden"
                aria-label="Open sidebar"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <List size={17} />
              </button>
              {sidebarCollapsed ? (
                <button
                  type="button"
                  className="hidden size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) md:inline-flex"
                  aria-label={t("expandSidebar")}
                  title={t("expandSidebar")}
                  onClick={() => setSidebarCollapsedAndPersist(false)}
                >
                  <SidebarSimple size={16} />
                </button>
              ) : null}
              <span className="truncate text-[14px] font-medium text-(--text-primary)">
                {t("scrapbook")}
              </span>
            </div>
            <Suspense fallback={null}>
              <ScrapbookPanel />
            </Suspense>
          </div>
        ) : state.currentView === "research" ? (
          <div className="codemini-workspace-panel flex flex-1 flex-col min-h-0 overflow-hidden">
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-(--border-default) px-3 sm:px-5">
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) md:hidden"
                aria-label="Open sidebar"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <List size={17} />
              </button>
              {sidebarCollapsed ? (
                <button
                  type="button"
                  className="hidden size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) md:inline-flex"
                  aria-label={t("expandSidebar")}
                  title={t("expandSidebar")}
                  onClick={() => setSidebarCollapsedAndPersist(false)}
                >
                  <SidebarSimple size={16} />
                </button>
              ) : null}
              <span className="truncate text-[14px] font-medium text-(--text-primary)">
                {t("deepResearch")}
              </span>
            </div>
            <Suspense fallback={null}>
              <ResearchPanel />
            </Suspense>
          </div>
        ) : state.currentView === "codewiki" ? (
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            <Suspense fallback={null}>
              <CodeWikiPanel
                projectCwd={
                  state.codewikiProjectPath?.split(/[/\\]/).pop() ||
                  state.projectCwd
                }
                projectKey={
                  state.codewikiProjectPath ||
                  state.runtimeState?.cwd ||
                  state.projectCwd ||
                  ""
                }
                busy={state.busy}
                planSteps={state.planSteps}
                stageLabel={state.stageLabel}
                generationStatus={state.codewikiGeneration}
              />
            </Suspense>
          </div>
        ) : (
          <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2 overflow-hidden">
          <div className="codemini-workspace-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Titlebar */}
            <div className="flex items-center justify-between h-12 px-3 sm:px-5 shrink-0 border-b border-(--border-default)">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  className="md:hidden inline-flex size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  aria-label="Open sidebar"
                  onClick={() => setMobileSidebarOpen(true)}
                >
                  <List size={17} />
                </button>
                {sidebarCollapsed ? (
                  <button
                    type="button"
                    className="hidden md:inline-flex size-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                    aria-label={t("expandSidebar")}
                    title={t("expandSidebar")}
                    onClick={() => setSidebarCollapsedAndPersist(false)}
                  >
                    <SidebarSimple size={16} />
                  </button>
                ) : null}
                <span className="font-medium text-[14px] text-(--text-primary) truncate">
                  {state.isGeneral
                    ? t("generalChat")
                    : state.projectCwd || t("currentProject")}
                </span>
                {git.isReady && git.isGit && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) shrink-0">
                    <GitHubIcon size={13} />
                    {git.branch ? <span>{git.branch}</span> : null}
                  </span>
                )}
                {git.isReady &&
                  git.isGit &&
                  (git.dirty ||
                    Number(git.linesAdded) > 0 ||
                    Number(git.linesRemoved) > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSideRailTab("git");
                      setSideRailOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 text-[12px] shrink-0 border-0 bg-transparent cursor-pointer hover:text-(--text-primary) p-0 text-(--text-muted)"
                    title={t("gitDiffTitle")}
                  >
                    <GitDiff size={13} />
                    {(Number(git.linesAdded) > 0 ||
                      Number(git.linesRemoved) > 0) && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        {Number(git.linesAdded) > 0 && (
                          <span className="text-(--accent-green)">
                            +{git.linesAdded}
                          </span>
                        )}
                        {Number(git.linesRemoved) > 0 && (
                          <span className="text-(--accent-red)">
                            -{git.linesRemoved}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )}
                <Tabs
                  value={chatPageTab}
                  onValueChange={setChatPageTab}
                  className="min-w-0 shrink-0 gap-0"
                >
                  <TabsList variant="line" className="h-8 p-0">
                    <TabsTrigger value="conversation" className="px-2 text-[13px]">
                      {t("chatTabConversation")}
                    </TabsTrigger>
                    <TabsTrigger value="trajectory" className="px-2 text-[13px]">
                      {t("trajectory")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className={
                    "inline-flex size-8 items-center justify-center rounded-md border-0 cursor-pointer " +
                    (sideRailOpen && sideRailTab === "files"
                      ? "bg-(--bg-hover) text-(--text-primary)"
                      : "bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)")
                  }
                  aria-label={t("workspaceFilesTab")}
                  title={t("workspaceFilesTab")}
                  aria-pressed={sideRailOpen && sideRailTab === "files"}
                  onClick={() => {
                    if (sideRailOpen && sideRailTab === "files") {
                      setSideRailOpen(false);
                      return;
                    }
                    setSideRailTab("files");
                    setSideRailOpen(true);
                  }}
                >
                  <FolderSimple size={16} />
                </button>
                <button
                  type="button"
                  className={
                    "inline-flex size-8 items-center justify-center rounded-md border-0 cursor-pointer " +
                    (sideRailOpen && sideRailTab === "terminal"
                      ? "bg-(--bg-hover) text-(--text-primary)"
                      : "bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)")
                  }
                  aria-label={t("terminalTitle")}
                  title={t("terminalTitle")}
                  aria-pressed={sideRailOpen && sideRailTab === "terminal"}
                  onClick={() => {
                    if (sideRailOpen && sideRailTab === "terminal") {
                      setSideRailOpen(false);
                      return;
                    }
                    setSideRailTab("terminal");
                    setSideRailOpen(true);
                  }}
                >
                  <Terminal size={16} />
                </button>
                {projectIsGit ? (
                <button
                  type="button"
                  className={
                    "inline-flex size-8 items-center justify-center rounded-md border-0 cursor-pointer " +
                    (sideRailOpen && sideRailTab === "git"
                      ? "bg-(--bg-hover) text-(--text-primary)"
                      : "bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)")
                  }
                  aria-label={t("workspaceGitTab")}
                  title={t("workspaceGitTab")}
                  aria-pressed={sideRailOpen && sideRailTab === "git"}
                  onClick={() => {
                    if (sideRailOpen && sideRailTab === "git") {
                      setSideRailOpen(false);
                      return;
                    }
                    setSideRailTab("git");
                    setSideRailOpen(true);
                  }}
                >
                  <GitDiff size={16} />
                </button>
                ) : null}
              </div>
            </div>

            {/* Plan Progress (during execution) — now rendered as a chat message via plan-overview */}

            <div className="codemini-chat-session flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Chat Panel */}
            {chatPageTab === "trajectory" ? (
              <TrajectoryPanel
                messages={state.messages}
                runtimeState={state.runtimeState}
                sessionId={currentId}
              />
            ) : (
              <ChatPanel
                key={state.currentSessionId || "new-chat"}
                messages={state.messages}
                projectCwd={state.projectCwd}
                skills={state.skills}
                messagesLoading={state.messagesLoading}
                isGeneral={state.isGeneral}
                targetMessageId={state.targetMessageId}
                dockedTodoMessageId={liveTodoDock?.messageId || ""}
                busy={state.busy}
                onTargetMessageHandled={actions.clearChatMessageTarget}
                onRetryMessage={retryMessage}
              />
            )}

            {/* Plan Review / Input Area */}
            <div className="w-[calc(100%_-_32px)] max-w-[940px] sm:w-[calc(100%_-_48px)] mx-auto mb-2 sm:mb-3 shrink-0 z-30 bg-transparent relative">
              <RuntimeActivityStrip
                activities={state.runtimeActivities}
              />
              <TowerProgressDock runtimeState={state.runtimeState} />
              {liveTodoDock ? (
                <div className="mb-2">
                  <TodoCard
                    variant="dock"
                    todos={liveTodoDock.todos}
                    persistKey={liveTodoDock.card?.id || liveTodoDock.messageId}
                  />
                </div>
              ) : null}
              <ReflectApprovalDialog
                open={state.reflectDialogOpen}
                draft={state.pendingReflectApproval}
                error={state.reflectDialogError}
                result={state.reflectDialogResult}
                onOpenChange={actions.setReflectDialogOpen}
                onRetry={() => actions.runChatAction("reflect")}
                onAction={actions.approveReflect}
                onUpdate={actions.updatePendingReflect}
                disabled={state.busy}
              />
              <DreamDialog
                open={state.dreamDialogOpen}
                status={state.dreamDialogStatus}
                result={state.dreamDialogResult}
                error={state.dreamDialogError}
                onOpenChange={actions.setDreamDialogOpen}
                onRetry={() => actions.runChatAction("dream")}
              />
              <MemoInputBar
                onSubmit={actions.submit}
                onAction={actions.runChatAction}
                onActionStart={actions.prepareChatAction}
                onAbort={actions.abort}
                busy={state.busy}
                disabled={
                  !!state.pendingSpecApproval ||
                  !!state.pendingReflectApproval
                }
                disabledReason={
                  state.pendingReflectApproval
                    ? t("reflectReviewFirst")
                    : state.pendingSpecApproval
                      ? t("specReviewFirst")
                      : ""
                }
                runtimeState={state.runtimeState}
                history={state.history}
                projectCwd={state.projectCwd}
                projectDirs={sidebarProjectDirs}
                hasConversation={hasConversation}
              />

              {/* Meta row */}
              <div className="flex items-center gap-3 pt-1.5 px-1 sm:px-2 min-h-[24px] overflow-hidden">
                {state.versionInfo?.current && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-(--text-muted) shrink-0">
                    <Terminal size={12} strokeWidth={2.5} className="shrink-0" />
                    Codemini CLI@{state.versionInfo.current}
                  </span>
                )}
                <MemoStatusBar
                  runtimeState={state.runtimeState}
                  live={state.live}
                  stageLabel={state.stageLabel}
                />
              </div>
            </div>
            </div>
          </div>
            {sideRailOpen ? (
              <Suspense fallback={null}>
                <WorkspaceRail
                  tab={sideRailTab}
                  onTabChange={setSideRailTab}
                  sessionId={state.currentSessionId || ""}
                  projectCwd={
                    state.runtimeState?.cwd || state.projectCwd || ""
                  }
                  isGit={git.isReady ? git.isGit : false}
                  onClose={() => setSideRailOpen(false)}
                />
              </Suspense>
            ) : null}
          </div>
        )}
      </div>

      <ApprovalDialog
        request={approvalRequest}
        open={!!approvalRequest}
        onDecision={(id, actionName, payload) =>
          actions.approve(id, actionName, approvalRequest?.sessionId, payload)
        }
      />

      <SpecApprovalDialog
        spec={state.pendingSpecApproval}
        open={!!state.pendingSpecApproval}
        onAction={actions.approveSpec}
        onUpdate={actions.updatePendingSpec}
        disabled={state.busy}
      />

      <Suspense fallback={null}>
        {state.configOpen && (
          <ConfigDialog
            open={state.configOpen}
            onOpenChange={actions.setConfigOpen}
            status={state.configStatus}
            reasoningSyncKey={reasoningSyncKey}
            onSaved={async () => {
              await Promise.all([
                actions.refreshConfigStatus(),
                actions.refreshRuntimeState(),
              ]);
            }}
          />
        )}

        {state.skillsOpen && (
          <SkillDialog
            open={state.skillsOpen}
            onOpenChange={actions.setSkillsOpen}
            projectDirs={sidebarProjectDirs}
            projectTargets={sidebarProjectTargets}
          />
        )}

        {state.mcpOpen && (
          <McpDialog
            open={state.mcpOpen}
            onOpenChange={actions.setMcpOpen}
          />
        )}

        {state.hooksOpen && (
          <HooksDialog
            open={state.hooksOpen}
            onOpenChange={actions.setHooksOpen}
            projectDirs={sidebarProjectDirs}
          />
        )}

        {state.memoryOpen && (
          <MemoryDialog
            open={state.memoryOpen}
            onOpenChange={actions.setMemoryOpen}
            projectDirs={sidebarProjectDirs}
          />
        )}

        {state.soulsOpen && (
          <SoulDialog
            open={state.soulsOpen}
            onOpenChange={actions.setSoulsOpen}
            disabled={state.busy}
          />
        )}

        {state.aboutOpen && (
          <AboutDialog
            open={state.aboutOpen}
            onOpenChange={actions.setAboutOpen}
            version={state.versionInfo?.current}
          />
        )}

        {state.projectOpen && (
          <ProjectSelector
            open={state.projectOpen}
            onOpenChange={actions.setProjectOpen}
            onOpenProject={handleOpenProject}
          />
        )}
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")).render(<App />);
