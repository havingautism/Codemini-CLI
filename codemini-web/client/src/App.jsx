import React, { Component } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/app-context.jsx";
import { t } from "../i18n/index.js";
import { Sidebar } from "@/components/Sidebar.jsx";
import { ChatPanel } from "@/components/ChatPanel.jsx";
import { InputBar } from "@/components/InputBar.jsx";
import { StatusBar } from "@/components/StatusBar.jsx";
import { CodeWikiPanel } from "@/components/CodeWikiPanel.jsx";
import { ApprovalDialog } from "@/components/ApprovalDialog.jsx";
import { PlanApprovalCard } from "@/components/PlanApprovalDialog.jsx";
import { ReflectApprovalCard } from "@/components/ReflectApprovalDialog.jsx";
import { RuntimeActivityStrip } from "@/components/RuntimeActivityStrip.jsx";
import { ConfigDialog } from "@/components/ConfigDialog.jsx";
import { ProjectSelector } from "@/components/ProjectSelector.jsx";
import { SkillDialog } from "@/components/SkillDialog.jsx";
import { SoulDialog } from "@/components/SoulDialog.jsx";
import { AboutDialog } from "@/components/AboutDialog.jsx";
import { GitDiffDialog } from "@/components/GitDiffDialog.jsx";
import { PlanProgress } from "@/components/PlanProgress.jsx";
import { MoreHorizontal, Terminal, GitCompare } from "lucide-react";
import "../style.css";

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
  const rs = state.runtimeState || {};
  const currentId = rs.sessionId;

  return (
    <div className="flex h-screen bg-(--bg-primary) text-(--text-primary)">
      <Sidebar
        sessions={state.sessions}
        sessionsLoading={state.sessionsLoading}
        currentSessionId={currentId}
        onNewSession={actions.newSession}
        onSwitchSession={actions.switchSession}
        onToggleTheme={actions.toggleTheme}
        onSetTheme={actions.setTheme}
        onOpenSettings={() => actions.setConfigOpen(true)}
        onOpenSkills={() => actions.setSkillsOpen(true)}
        onOpenSouls={() => actions.setSoulsOpen(true)}
        onOpenAbout={() => actions.setAboutOpen(true)}
        gitBatch={state.gitBatch}
        versionInfo={state.versionInfo}
        onUpdate={actions.runUpdate}
        updateStatus={state.updateStatus}
        currentView={state.currentView}
        onSwitchView={actions.switchView}
        onOpenProject={actions.openProject}
        onDeleteSession={actions.deleteSession}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-(--bg-secondary)">
        {state.currentView === "codewiki" ? (
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
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-(--bg-primary) rounded-[18px] border border-(--border-default) border-b-0 relative overflow-hidden my-1 mx-1">
            {/* Titlebar */}
            <div className="flex items-center justify-between h-[52px] px-5 shrink-0 border-b border-(--border-default)">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-medium text-[14px] text-(--text-primary) truncate">
                  {state.isGeneral
                    ? t("generalChat")
                    : state.projectCwd || "qurio-coder"}
                </span>
                {state.gitInfo?.isGit && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) shrink-0">
                    <GitHubIcon size={13} />
                    <span>{state.gitInfo.branch}</span>
                  </span>
                )}
                {state.gitInfo?.isGit && state.gitInfo?.dirty && (
                  <button
                    onClick={() => actions.setGitDiffOpen(true)}
                    className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) shrink-0 border-0 bg-transparent cursor-pointer hover:text-(--text-primary) p-0"
                  >
                    <GitCompare size={13} />
                  </button>
                )}
              </div>
              <button className="border-0 bg-transparent text-(--text-muted) rounded-md p-1.5 cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) shrink-0">
                <MoreHorizontal size={16} />
              </button>
            </div>

            {/* Plan Progress (during execution) */}
            {state.planSteps?.length > 0 && !state.pendingPlanApproval && (
              <div className="px-4">
                <PlanProgress steps={state.planSteps} />
              </div>
            )}

            {/* Chat Panel */}
            <ChatPanel
              messages={state.messages}
              projectCwd={state.projectCwd}
              skills={state.skills}
              gitInfo={state.gitInfo}
              messagesLoading={state.messagesLoading}
              isGeneral={state.isGeneral}
            />

            {/* Plan Review / Input Area */}
            <div className="w-[min(980px,calc(100%-64px))] mx-auto mb-4 shrink-0 z-30 bg-transparent relative">
              <RuntimeActivityStrip activities={state.runtimeActivities} />
              {state.pendingPlanApproval && (
                <div className="mb-3">
                  <PlanApprovalCard
                    plan={state.pendingPlanApproval}
                    onAction={actions.approvePlan}
                    disabled={state.busy}
                  />
                </div>
              )}
              {state.pendingReflectApproval && (
                <div className="mb-3">
                  <ReflectApprovalCard
                    draft={state.pendingReflectApproval}
                    onAction={actions.approveReflect}
                    disabled={state.busy}
                  />
                </div>
              )}
              <InputBar
                onSubmit={actions.submit}
                onAbort={actions.abort}
                busy={state.busy}
                disabled={
                  !!state.pendingPlanApproval || !!state.pendingReflectApproval
                }
                disabledReason={
                  state.pendingReflectApproval
                    ? t("reflectReviewFirst")
                    : t("planReviewFirst")
                }
                runtimeState={state.runtimeState}
                history={state.history}
                onCompletionRequest={async (input) => {
                  try {
                    const opts = await (
                      await fetch(
                        `/api/completions?q=${encodeURIComponent(input)}`,
                      )
                    ).json();
                  } catch {}
                }}
                onOpenProject={() => actions.setProjectOpen(true)}
                projectCwd={state.projectCwd}
              />

              {/* Meta row */}
              <div className="flex items-center gap-3 pt-2 px-3 min-h-[28px] overflow-hidden">
                {state.versionInfo?.current && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-(--text-muted) shrink-0">
                    <span className="inline-flex h-2.5 w-3.5 items-center justify-center rounded-[3px] bg-black text-white dark:bg-white dark:text-black">
                      <Terminal size={12} strokeWidth={2.5} />
                    </span>
                    Codemini CLI@{state.versionInfo.current}
                  </span>
                )}
                <StatusBar
                  runtimeState={state.runtimeState}
                  live={state.live}
                  stageLabel={state.stageLabel}
                />
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

      <ConfigDialog
        open={state.configOpen}
        onOpenChange={actions.setConfigOpen}
        status={state.configStatus}
        onSaved={actions.refreshConfigStatus}
      />

      <SkillDialog
        open={state.skillsOpen}
        onOpenChange={actions.setSkillsOpen}
      />

      <SoulDialog open={state.soulsOpen} onOpenChange={actions.setSoulsOpen} />

      <AboutDialog
        open={state.aboutOpen}
        onOpenChange={actions.setAboutOpen}
        version={state.versionInfo?.current}
      />

      <GitDiffDialog
        open={state.gitDiffOpen}
        onOpenChange={actions.setGitDiffOpen}
      />

      <ProjectSelector
        open={state.projectOpen}
        onOpenChange={actions.setProjectOpen}
        onOpenProject={actions.openProject}
      />
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
