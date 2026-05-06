import { useState } from "react";
import {
  Plus,
  Search,
  SunMoon,
  Settings,
  Folder,
  ChevronDown,
  Sparkles,
  Heart,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
  currentProjectDir,
  gitInfo,
}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set());

  const allSessions = Array.isArray(sessions) ? sessions : [];

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
  const normalizedCurrentProject = currentProjectDir
    ? String(currentProjectDir).replace(/\\/g, "/").toLowerCase()
    : "";

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
          <Heart
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
            const normalizedProjectKey = String(projectKey || "")
              .replace(/\\/g, "/")
              .toLowerCase();
            const isCurrentGitProject =
              Boolean(gitInfo?.isGit) &&
              normalizedCurrentProject &&
              normalizedProjectKey === normalizedCurrentProject;
            return (
              <div key={projectKey}>
                <button
                  className="w-full border-0 bg-transparent flex items-center gap-2 h-[28px] px-1.5 rounded-md cursor-pointer text-left text-[12px] font-medium tracking-[0.2px] text-(--text-muted) hover:text-(--text-secondary) hover:bg-(--bg-hover)"
                  onClick={() => toggleProject(projectKey)}
                  title={projectKey === "unknown" ? "" : projectKey}
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="truncate flex-1">
                    {getProjectName(projectKey)}
                  </span>
                  {isCurrentGitProject && (
                    <GitHubIcon
                      size={12}
                      className="shrink-0 text-(--text-muted)"
                      aria-label="GitHub repository"
                    />
                  )}
                  <span className="text-[11px]">{projectSessions.length}</span>
                  <ChevronDown
                    size={13}
                    className={cn(
                      "transition-transform",
                      !isExpanded && "-rotate-90",
                    )}
                  />
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-1.5 py-1 pl-2">
                    {projectSessions.slice(0, 30).map((session) => (
                      <button
                        key={session.id}
                        onClick={() =>
                          session.id !== currentSessionId &&
                          onSwitchSession(session.id)
                        }
                        className={cn(
                          "w-full border-0 bg-transparent flex items-center gap-2 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] truncate",
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
                      </button>
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
      <div className="px-2.5 py-2 flex justify-center gap-1 border-t border-(--border-default)">
        <button
          className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
          onClick={onToggleTheme}
          title={isDark ? "浅色" : "深色"}
          aria-label={isDark ? "切换浅色模式" : "切换深色模式"}
        >
          <SunMoon size={15} strokeWidth={1.8} />
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
    </aside>
  );
}
