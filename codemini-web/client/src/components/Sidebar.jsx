import { useState } from "react";
import {
  Plus,
  Search,
  Sun,
  Moon,
  Settings,
  Folder,
  ChevronDown,
  Sparkles,
  User,
  Info,
  BookOpenText,
  MoreHorizontal,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { cn } from "@/lib/utils";

function getProjectKey(session) {
  return session?.projectDir || "unknown";
}

function getProjectName(projectDir) {
  if (!projectDir || projectDir === "unknown") return "未知项目";
  return String(projectDir).split(/[/\\]/).filter(Boolean).pop() || projectDir;
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

export function Sidebar({
  sessions,
  currentSessionId,
  onNewSession,
  onSwitchSession,
  onToggleTheme,
  onOpenSettings,
  onOpenSkills,
  onOpenSouls,
  onOpenAbout,
  gitBatch,
  versionInfo,
  onUpdate,
  updateStatus,
  currentView,
  onSwitchView,
  onOpenProject,
  onDeleteSession,
}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const allSessions = Array.isArray(sessions) ? sessions : [];
  const currentSession = allSessions.find((s) => s.id === currentSessionId);
  const activeProjectKey = currentSession
    ? getProjectKey(currentSession)
    : null;

  const projectGroups = new Map();
  for (const session of allSessions) {
    const key = getProjectKey(session);
    if (!projectGroups.has(key)) projectGroups.set(key, []);
    projectGroups.get(key).push(session);
  }

  const toggleProject = (key) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark";

  const openProjectCodeWiki = async (event, projectKey) => {
    event.stopPropagation();
    if (
      projectKey &&
      projectKey !== "unknown" &&
      projectKey !== activeProjectKey &&
      onOpenProject
    ) {
      await onOpenProject(projectKey, { view: "codewiki" });
      return;
    }
    onSwitchView?.("codewiki", { projectPath: projectKey });
  };

  const openProjectNewSession = async (event, projectKey) => {
    event.stopPropagation();
    if (!projectKey || projectKey === "unknown") return;
    if (projectKey === activeProjectKey) {
      await onNewSession?.();
      return;
    }
    await onOpenProject?.(projectKey, { view: "chat" });
  };

  const confirmDeleteSession = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await onDeleteSession?.(pendingDelete.id);
    setDeleting(false);
    if (!result?.error) setPendingDelete(null);
  };

  return (
    <aside className="w-[260px] shrink-0 border-r border-(--border-default) flex flex-col bg-(--bg-secondary)">
      <nav
        className="flex-1 flex flex-col px-2.5 pt-3 pb-2 gap-0.5 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        {/* New Session */}
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onNewSession}
        >
          <Plus
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">新对话</span>
        </button>

        {/* Search */}
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={() => {}}
        >
          <Search
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">搜索</span>
        </button>

        {/* Skills */}
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenSkills}
        >
          <Sparkles
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">Skills</span>
        </button>

        {/* Souls */}
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenSouls}
        >
          <User
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">Souls</span>
        </button>

        <Separator className="my-2 bg-(--border-default)" />

        {/* Project Groups */}
        {Array.from(projectGroups.entries()).map(
          ([projectKey, projectSessions]) => {
            const isExpanded =
              expandedProjects.has(projectKey) || projectGroups.size === 1;
            const git = gitBatch?.[projectKey];
            const isActive = projectKey === activeProjectKey;
            const canOpenCodeWiki = projectKey !== "unknown";
            return (
              <div key={projectKey}>
                <div
                  className={cn(
                    "w-full border-0 bg-transparent flex items-center gap-1 h-[28px] px-1.5 rounded-md text-left text-[12px] font-medium tracking-[0.2px] hover:bg-(--bg-hover)",
                    isActive
                      ? "text-(--text-primary)"
                      : "text-(--text-muted) hover:text-(--text-secondary)",
                  )}
                  title={projectKey === "unknown" ? "" : projectKey}
                >
                  <button
                    className="min-w-0 flex-1 border-0 bg-transparent flex items-center gap-2 text-left text-inherit cursor-pointer"
                    onClick={() => toggleProject(projectKey)}
                  >
                    <Folder size={13} className="shrink-0" />
                    <span className="truncate flex-1">
                      {getProjectName(projectKey)}
                    </span>
                  </button>
                  {canOpenCodeWiki && (
                    <button
                      type="button"
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) cursor-pointer hover:bg-(--bg-active) hover:text-(--text-primary)"
                      title="在此项目中新建对话"
                      aria-label={`在 ${getProjectName(projectKey)} 中新建对话`}
                      onClick={(event) =>
                        openProjectNewSession(event, projectKey)
                      }
                    >
                      <Plus size={13} strokeWidth={2.1} />
                    </button>
                  )}
                  {canOpenCodeWiki && (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) cursor-pointer hover:bg-(--bg-active) hover:text-(--text-primary)",
                        currentView === "codewiki" &&
                          isActive &&
                          "bg-(--bg-active) text-(--text-primary)",
                      )}
                      title="打开 CodeWiki"
                      aria-label={`打开 ${getProjectName(projectKey)} 的 CodeWiki`}
                      onClick={(event) =>
                        openProjectCodeWiki(event, projectKey)
                      }
                    >
                      <BookOpenText size={13} strokeWidth={1.9} />
                    </button>
                  )}
                  {git?.isGit && (
                    <GitHubIcon
                      size={11}
                      className="shrink-0 text-(--text-muted)"
                    />
                  )}
                  <span className="text-[11px]">{projectSessions.length}</span>
                  <button
                    type="button"
                    className="border-0 bg-transparent inline-flex size-5 shrink-0 items-center justify-center rounded-md text-inherit cursor-pointer hover:bg-(--bg-active)"
                    onClick={() => toggleProject(projectKey)}
                    aria-label={isExpanded ? "折叠项目" : "展开项目"}
                  >
                    <ChevronDown
                      size={13}
                      className={cn(
                        "transition-transform",
                        !isExpanded && "-rotate-90",
                      )}
                    />
                  </button>
                </div>
                {isExpanded && (
                  <div className="flex flex-col gap-1.5 py-1 pl-2">
                    {projectSessions.slice(0, 30).map((session) => (
                      <div
                        key={session.id}
                        onClick={() =>
                          session.id !== currentSessionId &&
                          onSwitchSession(session.id)
                        }
                        className={cn(
                          "group w-full border-0 bg-transparent flex items-center gap-2 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] truncate",
                          session.id === currentSessionId
                            ? "bg-(--bg-active) text-(--text-primary)"
                            : "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                        )}
                      >
                        <span className="truncate flex-1">
                          {session.title ||
                            session.preview ||
                            (session.messageCount > 0
                              ? `${session.messageCount} 条消息`
                              : "空对话")}
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) opacity-0 hover:bg-(--bg-active) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                              onClick={(event) => event.stopPropagation()}
                              aria-label="会话操作"
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
                              onClick={() => setPendingDelete(session)}
                            >
                              删除
                            </button>
                          </PopoverContent>
                        </Popover>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          },
        )}

        {allSessions.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-(--text-muted) text-center">
            暂无对话
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-t border-(--border-default)">
        {versionInfo?.latest && versionInfo.latest !== versionInfo.current && (
          <button
            className="w-full border-0 bg-(--bg-tertiary) rounded-md px-2.5 py-1.5 cursor-pointer text-[11px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) flex items-center justify-center gap-1.5"
            onClick={updateStatus === "updating" ? undefined : onUpdate}
            disabled={updateStatus === "updating"}
          >
            {updateStatus === "updating" ? (
              <>更新中...</>
            ) : updateStatus === "done" ? (
              <>已更新，请重启</>
            ) : (
              <>新版本 {versionInfo.latest} 可用，点击更新</>
            )}
          </button>
        )}
        <div className="flex items-center justify-center gap-1">
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onOpenAbout}
            title="关于"
            aria-label="关于"
          >
            <Info size={15} strokeWidth={1.8} />
          </button>
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onToggleTheme}
            title={isDark ? "浅色" : "深色"}
            aria-label={isDark ? "切换浅色模式" : "切换深色模式"}
          >
            {isDark ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
          </button>
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onOpenSettings}
            title="设置"
            aria-label="打开设置"
          >
            <Settings size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除会话？"
        description={`会话「${pendingDelete?.title || pendingDelete?.preview || pendingDelete?.id || ""}」会从历史记录中移除，此操作不可撤销。`}
        loading={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={confirmDeleteSession}
      />
    </aside>
  );
}
