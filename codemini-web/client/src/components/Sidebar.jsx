import { useState } from "react";
import {
  Plus,
  Search,
  SunMoon,
  Settings,
  Folder,
  ChevronDown,
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

export function Sidebar({
  sessions,
  currentSessionId,
  onNewSession,
  onSwitchSession,
  onToggleTheme,
  onOpenSettings,
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

        <Separator className="my-2 bg-(--border-default)" />

        {/* Project Groups */}
        {Array.from(projectGroups.entries()).map(
          ([projectKey, projectSessions]) => {
            const isExpanded =
              expandedProjects.has(projectKey) || projectGroups.size === 1;
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
      <div className="px-2.5 py-2 flex gap-1 border-t border-(--border-default)">
        <button
          className="flex-1 border-0 bg-transparent flex items-center gap-2 h-[32px] px-2 rounded-lg cursor-pointer text-[13px] hover:bg-(--bg-hover) text-(--text-secondary)"
          onClick={onToggleTheme}
        >
          <SunMoon size={15} strokeWidth={1.8} />
          <span>{isDark ? "浅色" : "深色"}</span>
        </button>
        <button
          className="flex-1 border-0 bg-transparent flex items-center gap-2 h-[32px] px-2 rounded-lg cursor-pointer text-[13px] hover:bg-(--bg-hover) text-(--text-secondary)"
          onClick={onOpenSettings}
        >
          <Settings size={15} strokeWidth={1.8} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
