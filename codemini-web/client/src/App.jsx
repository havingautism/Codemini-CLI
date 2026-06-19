import React, {
  Component,
  Suspense,
  lazy,
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/app-context.jsx";
import { t } from "../i18n/index.js";
import { Sidebar } from "@/components/Sidebar.jsx";
import { ChatPanel } from "@/components/ChatPanel.jsx";
import { InputBar } from "@/components/InputBar.jsx";
import { StatusBar } from "@/components/StatusBar.jsx";
import { ApprovalDialog } from "@/components/ApprovalDialog.jsx";
import { UserInputDialog } from "@/components/UserInputDialog.jsx";
import { ReflectApprovalCard } from "@/components/ReflectApprovalDialog.jsx";
import { SpecApprovalDialog } from "@/components/SpecApprovalDialog.jsx";
import { RuntimeActivityStrip } from "@/components/RuntimeActivityStrip.jsx";
import { DotsThree, GitDiff, List, Terminal } from "@phosphor-icons/react";
import "../style.css";

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
const MemoryDialog = lazy(() =>
  import("@/components/MemoryDialog.jsx").then((module) => ({
    default: module.MemoryDialog,
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
const GitDiffDialog = lazy(() =>
  import("@/components/GitDiffDialog.jsx").then((module) => ({
    default: module.GitDiffDialog,
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const rs = state.runtimeState || {};
  const currentId = rs.sessionId;
  const openSettings = useCallback(
    () => actions.setConfigOpen(true),
    [actions],
  );
  const openSkills = useCallback(() => actions.setSkillsOpen(true), [actions]);
  const openMemory = useCallback(() => actions.setMemoryOpen(true), [actions]);
  const openSouls = useCallback(() => actions.setSoulsOpen(true), [actions]);
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

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const sidebar = (
    <MemoSidebar
        sessions={state.sessions}
        sessionsLoading={state.sessionsLoading}
        currentSessionId={currentId}
        onNewSession={async (...args) => {
          closeMobileSidebar();
          return actions.newSession(...args);
        }}
        onSwitchSession={async (...args) => {
          closeMobileSidebar();
          return actions.switchSession(...args);
        }}
        onToggleTheme={actions.toggleTheme}
        onSetTheme={actions.setTheme}
        onOpenSettings={openSettings}
        onOpenSkills={openSkills}
        onOpenMemory={openMemory}
        onOpenSouls={openSouls}
        onOpenAbout={openAbout}
        gitBatch={state.gitBatch}
        versionInfo={state.versionInfo}
        onUpdate={actions.runUpdate}
        updateStatus={state.updateStatus}
        currentView={state.currentView}
        onSwitchView={actions.switchView}
        onOpenProject={async (...args) => {
          closeMobileSidebar();
          return actions.openProject(...args);
        }}
        onOpenProjectSelector={openProjectSelector}
        onRefreshSessions={actions.loadSessions}
        onDeleteSession={actions.deleteSession}
      />
  );

  return (
    <div className="codemini-app-shell flex h-screen overflow-hidden text-(--text-primary)">
      <div className="hidden md:flex h-full shrink-0 py-2 pl-2 pr-0">
        {sidebar}
      </div>
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
        {state.currentView === "codewiki" ? (
          <div className="codemini-workspace-panel flex flex-1 flex-col min-h-0 overflow-hidden">
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
          <div className="codemini-workspace-panel flex flex-1 flex-col min-h-0 overflow-hidden">
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
                <span className="font-medium text-[14px] text-(--text-primary) truncate">
                  {state.isGeneral
                    ? t("generalChat")
                    : state.projectCwd || "qurio-coder"}
                </span>
                {state.gitInfo?.isGit && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) shrink-0">
                    <GitHubIcon size={13} />
                    {state.gitInfo.branch ? (
                      <span>{state.gitInfo.branch}</span>
                    ) : null}
                  </span>
                )}
                {state.gitInfo?.isGit &&
                  (state.gitInfo.dirty ||
                    Number(state.gitInfo.linesAdded) > 0 ||
                    Number(state.gitInfo.linesRemoved) > 0) && (
                  <button
                    type="button"
                    onClick={() => actions.setGitDiffOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] shrink-0 border-0 bg-transparent cursor-pointer hover:text-(--text-primary) p-0 text-(--text-muted)"
                    title={t("gitDiffTitle")}
                  >
                    <GitDiff size={13} />
                    {(Number(state.gitInfo.linesAdded) > 0 ||
                      Number(state.gitInfo.linesRemoved) > 0) && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        {Number(state.gitInfo.linesAdded) > 0 && (
                          <span className="text-(--accent-green)">
                            +{state.gitInfo.linesAdded}
                          </span>
                        )}
                        {Number(state.gitInfo.linesRemoved) > 0 && (
                          <span className="text-(--accent-red)">
                            -{state.gitInfo.linesRemoved}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )}
              </div>
              {/* <button className="border-0 bg-transparent text-(--text-muted) rounded-md p-1.5 cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) shrink-0">
                <DotsThree size={16} />
              </button> */}
            </div>

            {/* Plan Progress (during execution) — now rendered as a chat message via plan-overview */}

            <div className="codemini-chat-session flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
            {/* Chat Panel */}
            <ChatPanel
              messages={state.messages}
              projectCwd={state.projectCwd}
              skills={state.skills}
              gitInfo={state.gitInfo}
              messagesLoading={state.messagesLoading}
              isGeneral={state.isGeneral}
              onRetryMessage={(prompt) => actions.submit(prompt)}
            />

            {/* Plan Review / Input Area */}
            <div className="w-[calc(100%_-_32px)] max-w-[940px] sm:w-[calc(100%_-_48px)] mx-auto mb-2 sm:mb-3 shrink-0 z-30 bg-transparent relative">
              <RuntimeActivityStrip activities={state.runtimeActivities} />
              {state.pendingReflectApproval && (
                <div className="mb-3">
                  <ReflectApprovalCard
                    draft={state.pendingReflectApproval}
                    onAction={actions.approveReflect}
                    onUpdate={actions.updatePendingReflect}
                    disabled={state.busy}
                  />
                </div>
              )}
              <MemoInputBar
                onSubmit={actions.submit}
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
                onOpenSpec={actions.openSpecReview}
                projectCwd={state.projectCwd}
              />

              {/* Meta row */}
              <div className="flex items-center gap-3 pt-1.5 px-1 sm:px-2 min-h-[24px] overflow-hidden">
                {state.versionInfo?.current && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-(--text-muted) shrink-0">
                    <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] bg-foreground text-background">
                      <Terminal size={12} strokeWidth={2.5} />
                    </span>
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
        )}
      </div>

      <ApprovalDialog
        request={state.approvalRequest}
        open={!!state.approvalRequest}
        onDecision={actions.approve}
      />

      <UserInputDialog
        request={state.userInputRequest}
        open={!!state.userInputRequest}
        onRespond={actions.respondToUserInput}
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
            onSaved={actions.refreshConfigStatus}
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

        {state.gitDiffOpen && (
          <GitDiffDialog
            open={state.gitDiffOpen}
            onOpenChange={actions.setGitDiffOpen}
          />
        )}

        {state.projectOpen && (
          <ProjectSelector
            open={state.projectOpen}
            onOpenChange={actions.setProjectOpen}
            onOpenProject={actions.openProject}
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
