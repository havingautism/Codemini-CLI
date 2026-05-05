import React, { Component } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/context/app-context.jsx";
import { Sidebar } from "@/components/Sidebar.jsx";
import { ChatPanel } from "@/components/ChatPanel.jsx";
import { InputBar } from "@/components/InputBar.jsx";
import { StatusBar } from "@/components/StatusBar.jsx";
import { ApprovalDialog } from "@/components/ApprovalDialog.jsx";
import { ConfigDialog } from "@/components/ConfigDialog.jsx";
import { ProjectSelector } from "@/components/ProjectSelector.jsx";
import { PlanProgress } from "@/components/PlanProgress.jsx";
import { SessionPanel } from "@/components/SessionPanel.jsx";
import { MoreHorizontal, Folder } from "lucide-react";
import "../style.css";

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
          <p style={{ fontWeight: 600, marginBottom: 8 }}>渲染错误</p>
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
            重试
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
        currentSessionId={currentId}
        onNewSession={actions.newSession}
        onSwitchSession={actions.switchSession}
        onToggleTheme={actions.toggleTheme}
        onOpenSettings={() => actions.setConfigOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-(--bg-secondary)">
        {state.currentView === "sessions" ? (
          <SessionPanel
            sessions={state.sessions}
            currentId={currentId}
            onSwitch={actions.switchSession}
            onNew={actions.newSession}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-(--bg-primary) rounded-t-[18px] border border-(--border-default) border-b-0 relative overflow-hidden mt-1 mx-1">
            {/* Titlebar */}
            <div className="flex items-center justify-between h-[52px] px-5 shrink-0 border-b border-(--border-default)">
              <span className="font-medium text-[14px] text-(--text-primary)">
                {state.projectCwd || "qurio-coder"}
              </span>
              <button className="border-0 bg-transparent text-(--text-muted) rounded-md p-1.5 cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary)">
                <MoreHorizontal size={16} />
              </button>
            </div>

            {/* Plan Progress */}
            {state.planSteps?.length > 0 && (
              <div className="px-4">
                <PlanProgress steps={state.planSteps} />
              </div>
            )}

            {/* Chat Panel */}
            <ChatPanel
              messages={state.messages}
              projectCwd={state.projectCwd}
            />

            {/* Input Area */}
            <div className="w-[min(980px,calc(100%-64px))] mx-auto mb-4 shrink-0 z-30 bg-transparent relative">
              <InputBar
                onSubmit={actions.submit}
                onAbort={actions.abort}
                busy={state.busy}
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
              />

              {/* Meta row */}
              <div className="flex items-center gap-3 pt-2 px-3 min-h-[28px] overflow-hidden">
                <button
                  className="border-0 bg-transparent text-(--text-muted) inline-flex items-center gap-1.5 max-w-[180px] h-6 px-1 rounded-md cursor-pointer text-[12px] whitespace-nowrap hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  onClick={() => actions.setProjectOpen(true)}
                >
                  <Folder size={13} style={{ flexShrink: 0 }} />
                  <span className="overflow-hidden text-ellipsis">
                    {state.projectCwd || "..."}
                  </span>
                </button>
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
