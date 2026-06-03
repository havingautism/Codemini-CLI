import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Sun,
  Moon,
  Monitor,
  Settings,
  Folder,
  Hammer,
  User,
  Info,
  BookOpenText,
  MoreHorizontal,
  Globe,
  Check,
  Palette,
  PencilLine,
  Drama,
  Brain,
  X,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { t, setLocale, getLocale } from "../../i18n/index.js";
import {
  fetchWebuiActiveProjects,
  patchWebuiActiveProject,
  replaceWebuiActiveProjects,
} from "@/hooks/use-api.js";

const GENERAL_PROJECT_MARKER = "__codemini_general__";
const PROJECT_SESSION_PREVIEW_LIMIT = 5;
const GENERAL_SESSION_PREVIEW_LIMIT = 10;
const LEGACY_PINNED_PROJECTS_KEY = "codemini-sidebar-pinned-projects";
const LEGACY_HIDDEN_PROJECTS_KEY = "codemini-sidebar-hidden-projects";

function readLegacySidebarKeys() {
  const pinned = readLegacyProjectKeys(LEGACY_PINNED_PROJECTS_KEY);
  const hidden = readLegacyProjectKeys(LEGACY_HIDDEN_PROJECTS_KEY);
  if (!pinned.length) return [];
  const hiddenSet = new Set(hidden);
  return pinned.filter((key) => !hiddenSet.has(key));
}

function readLegacyProjectKeys(key) {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item)
      : [];
  } catch {
    return [];
  }
}

function clearLegacyProjectKeys() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_PINNED_PROJECTS_KEY);
  localStorage.removeItem(LEGACY_HIDDEN_PROJECTS_KEY);
}

function getProjectKey(session) {
  return session?.projectKey || session?.projectDir || "unknown";
}

function SidebarEmptyPlaceholder({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-md border border-(--border-default) bg-(--bg-primary)/35 px-2.5 py-3 text-center text-[11px] leading-relaxed text-(--text-muted)",
        className,
      )}
    >
      {children}
    </div>
  );
}

function getProjectName(projectDir, isGeneral) {
  if (isGeneral) return t("generalChat");
  if (!projectDir || projectDir === "unknown") return t("unknownProject");
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

function getSessionLabel(session) {
  return (
    session?.title ||
    session?.preview ||
    (session?.messageCount > 0
      ? `${session.messageCount} ${t("messages")}`
      : t("emptyChat"))
  );
}

function formatRelativeTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return t("justNow");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}${t("minutesAgo")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t("hoursAgo")}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}${t("daysAgo")}`;
  return new Date(time).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

const THEME_PALETTES = [
  {
    id: "default",
    labelKey: "themeDefault",
    swatches: ["#0a0a0a", "#f5f5f5", "#60a5fa"],
  },
  {
    id: "catppuccin",
    labelKey: "themeCatppuccin",
    swatches: ["#1e1e2e", "#cba6f7", "#89b4fa"],
  },
  {
    id: "tokyonight",
    labelKey: "themeTokyoNight",
    swatches: ["#1a1b26", "#7aa2f7", "#bb9af7"],
  },
  {
    id: "one",
    labelKey: "themeOne",
    swatches: ["#282c34", "#61afef", "#c678dd"],
  },
  {
    id: "github",
    labelKey: "themeGithub",
    swatches: ["#ffffff", "#0969da", "#24292f"],
  },
  {
    id: "vscode",
    labelKey: "themeVSCode",
    swatches: ["#1e1e1e", "#007acc", "#d4d4d4"],
  },
];

export function Sidebar({
  sessions,
  sessionsLoading,
  currentSessionId,
  onNewSession,
  onSwitchSession,
  onToggleTheme,
  onSetTheme,
  onOpenSettings,
  onOpenSkills,
  onOpenMemory,
  onOpenSouls,
  onOpenAbout,
  gitBatch,
  versionInfo,
  onUpdate,
  updateStatus,
  currentView,
  onSwitchView,
  onOpenProject,
  onOpenProjectSelector,
  onRefreshSessions,
  onDeleteSession,
}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [projectSessionLimits, setProjectSessionLimits] = useState({});
  const [generalSessionLimit, setGeneralSessionLimit] = useState(
    GENERAL_SESSION_PREVIEW_LIMIT,
  );
  const [activeProjectDirs, setActiveProjectDirs] = useState([]);
  const [activeProjectsReady, setActiveProjectsReady] = useState(false);
  const [sessionsSnapshotReady, setSessionsSnapshotReady] = useState(false);
  const [showActiveProjectsEmpty, setShowActiveProjectsEmpty] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openProjectMenuKey, setOpenProjectMenuKey] = useState(null);
  const [pendingRemoveActive, setPendingRemoveActive] = useState(null);
  const [removingFromActive, setRemovingFromActive] = useState(false);
  const [themePalette, setThemePaletteState] = useState(() => {
    if (typeof document === "undefined") return "default";
    return document.documentElement.dataset.palette || "default";
  });
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme || "light";
  });
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("codemini-theme") || "auto";
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchWebuiActiveProjects();
        if (cancelled) return;
        let active = Array.isArray(remote?.active) ? remote.active : [];
        const legacyActive = readLegacySidebarKeys();
        if (!active.length && legacyActive.length) {
          const migrated = await replaceWebuiActiveProjects(legacyActive);
          if (!cancelled && Array.isArray(migrated?.active)) {
            active = migrated.active;
          } else {
            active = legacyActive;
          }
          clearLegacyProjectKeys();
        }
        if (!cancelled) setActiveProjectDirs(active);
      } catch {
        if (!cancelled) setActiveProjectDirs([]);
      } finally {
        if (!cancelled) setActiveProjectsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionsLoading) setSessionsSnapshotReady(true);
  }, [sessionsLoading]);

  useEffect(() => {
    const mq =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      setResolvedTheme(document.documentElement.dataset.theme || "light");
      setThemeMode(localStorage.getItem("codemini-theme") || "auto");
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    if (mq) mq.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      if (mq) mq.removeEventListener("change", sync);
    };
  }, []);
  const isDark = resolvedTheme === "dark";

  const {
    allSessions,
    currentSession,
    activeIsGeneral,
    activeProjectKey,
    generalSessions,
    projectSessionsOnly,
    projectGroups,
    visibleProjectGroupEntries,
  } = useMemo(() => {
    const all = Array.isArray(sessions) ? sessions : [];
    const current = all.find((s) => s.id === currentSessionId);
    const general = [];
    const projectOnly = [];
    const groups = new Map();
    for (const session of all) {
      if (session.isGeneral) {
        general.push(session);
        continue;
      }
      projectOnly.push(session);
      const key = getProjectKey(session);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    }
    const entries = Array.from(groups.entries());
    if (activeProjectsReady && activeProjectDirs.length) {
      const order = new Map(
        activeProjectDirs.map((projectKey, index) => [projectKey, index]),
      );
      entries.sort((a, b) => {
        const aIndex = order.has(a[0])
          ? order.get(a[0])
          : Number.MAX_SAFE_INTEGER;
        const bIndex = order.has(b[0])
          ? order.get(b[0])
          : Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });
    }
    return {
      allSessions: all,
      currentSession: current,
      activeIsGeneral: !!current?.isGeneral,
      activeProjectKey: current ? getProjectKey(current) : null,
      generalSessions: general,
      projectSessionsOnly: projectOnly,
      projectGroups: groups,
      visibleProjectGroupEntries: entries,
    };
  }, [sessions, currentSessionId, activeProjectDirs, activeProjectsReady]);

  const projectsAreaEmpty = visibleProjectGroupEntries.length === 0;

  useEffect(() => {
    if (!activeProjectsReady || !sessionsSnapshotReady) return;
    if (sessionsLoading) return;
    setShowActiveProjectsEmpty(projectsAreaEmpty);
  }, [
    activeProjectsReady,
    sessionsSnapshotReady,
    sessionsLoading,
    projectsAreaEmpty,
  ]);

  const toggleProject = (key) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyActiveProjects = (next) => {
    if (Array.isArray(next?.active)) setActiveProjectDirs(next.active);
  };

  const requestRemoveFromActive = (projectKey) => {
    if (!projectKey || projectKey === "unknown") return;
    setOpenProjectMenuKey(null);
    setPendingRemoveActive({
      projectKey,
      label: getProjectName(projectKey),
    });
  };

  const refreshAfterActiveChange = async () => {
    const remote = await fetchWebuiActiveProjects().catch(() => null);
    if (remote) applyActiveProjects(remote);
    await onRefreshSessions?.({ force: true });
  };

  const removeFromActive = async (projectKey) => {
    setActiveProjectDirs((prev) => prev.filter((key) => key !== projectKey));
    setExpandedProjects((prev) => {
      if (!prev.has(projectKey)) return prev;
      const next = new Set(prev);
      next.delete(projectKey);
      return next;
    });
    try {
      await patchWebuiActiveProject("deactivate", projectKey);
      await refreshAfterActiveChange();
    } catch {
      await refreshAfterActiveChange();
    }
  };

  const confirmRemoveFromActive = async () => {
    if (!pendingRemoveActive || removingFromActive) return;
    setRemovingFromActive(true);
    try {
      await removeFromActive(pendingRemoveActive.projectKey);
      setPendingRemoveActive(null);
    } finally {
      setRemovingFromActive(false);
    }
  };

  const loadMoreProjectSessions = (projectKey, total) => {
    setProjectSessionLimits((prev) => {
      const current = prev[projectKey] || PROJECT_SESSION_PREVIEW_LIMIT;
      return {
        ...prev,
        [projectKey]: Math.min(current + PROJECT_SESSION_PREVIEW_LIMIT, total),
      };
    });
  };

  const loadMoreGeneralSessions = () => {
    setGeneralSessionLimit((current) =>
      Math.min(current + GENERAL_SESSION_PREVIEW_LIMIT, generalSessions.length),
    );
  };

  const setThemePalette = (palette) => {
    const next = THEME_PALETTES.some((item) => item.id === palette)
      ? palette
      : "default";
    document.documentElement.dataset.palette = next;
    localStorage.setItem("codemini-theme-palette", next);
    window.dispatchEvent(
      new CustomEvent("codemini-theme-palette-change", {
        detail: { palette: next },
      }),
    );
    setThemePaletteState(next);
  };

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
    await onOpenProject?.(projectKey, { view: "chat", newSession: true });
  };

  const openGeneralNewSession = async () => {
    if (activeIsGeneral) {
      await onNewSession?.();
      return;
    }
    await onOpenProject?.(GENERAL_PROJECT_MARKER, {
      view: "chat",
      newSession: true,
    });
  };

  const confirmDeleteSession = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await onDeleteSession?.(pendingDelete.id);
    setDeleting(false);
    if (!result?.error) setPendingDelete(null);
  };

  return (
    <aside className="h-full w-[260px] shrink-0 flex flex-col border-r border-(--border-default) bg-(--bg-secondary)">
      {/* Fixed top action buttons */}
      <div className="shrink-0 px-2.5 pt-2.5 flex flex-col gap-0.5">
        <div className="mb-1.5 flex h-9 items-center gap-2 px-2">
          <img
            src="/logos/codemini_logo.png"
            alt=""
            className="size-5 shrink-0 rounded-[5px]"
            draggable={false}
          />
          <div className="min-w-0 truncate text-[17px] font-semibold leading-5 text-(--text-primary)">
            {t("brand")}
          </div>
        </div>
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onNewSession}
        >
          <Plus
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">{t("newChat")}</span>
        </button>

        {/* <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={() => {}}
        >
          <Search
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">搜索</span>
        </button> */}

        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenSkills}
        >
          <Hammer
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">{t("skills")}</span>
        </button>

        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenSouls}
        >
          <Drama
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">{t("souls")}</span>
        </button>
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenMemory}
        >
          <Brain
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">{t("memory")}</span>
        </button>
        <Separator className="my-1.5 bg-transparent" />
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto scroll-smooth"
        // style={{ scrollbarWidth: "thin" }}
      >
        {/* Scrollable project history */}
        <div className="flex items-center gap-1 px-4 pb-1.5">
          <span className="min-w-0 flex-1 text-[12px] font-medium text-(--text-muted)">
            {t("projects")}
          </span>
          <button
            type="button"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary)"
            title={t("openProjectDialog")}
            aria-label={t("openProjectDialog")}
            onClick={() => onOpenProjectSelector?.()}
          >
            <Plus size={14} strokeWidth={2.1} />
          </button>
        </div>
        <nav className="flex flex-col px-2.5 pb-1 gap-0.5">
          {showActiveProjectsEmpty && (
            <SidebarEmptyPlaceholder className="mb-1">
              {t("activeProjectsEmpty")}
            </SidebarEmptyPlaceholder>
          )}
          {visibleProjectGroupEntries.map(([projectKey, projectSessions]) => {
            const isExpanded =
              expandedProjects.has(projectKey) ||
              visibleProjectGroupEntries.length === 1;
            const projectSessionLimit =
              projectSessionLimits[projectKey] || PROJECT_SESSION_PREVIEW_LIMIT;
            const visibleProjectSessions = projectSessions.slice(
              0,
              projectSessionLimit,
            );
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
                      title={t("newSessionInProject")}
                      aria-label={`${t("newSessionInProject")} ${getProjectName(projectKey)}`}
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
                      title={t("openCodeWiki")}
                      aria-label={`${t("openCodeWiki")} ${getProjectName(projectKey)}`}
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
                  <span className="text-[11px] px-2">
                    {projectSessions.length}
                  </span>
                  <Popover
                    open={openProjectMenuKey === projectKey}
                    onOpenChange={(open) =>
                      setOpenProjectMenuKey(open ? projectKey : null)
                    }
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) cursor-pointer hover:bg-(--bg-active) hover:text-(--text-primary)"
                        aria-label={t("projectActions")}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-44 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-(--text-secondary) transition-colors hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          requestRemoveFromActive(projectKey);
                        }}
                      >
                        <X size={14} className="shrink-0" />
                        <span>{t("removeActiveProject")}</span>
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
                {isExpanded && (
                  <div className="flex flex-col gap-1.5 py-1 pl-2">
                    {visibleProjectSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => {
                          if (session.id !== currentSessionId) {
                            onSwitchSession(session.id);
                          } else if (currentView !== "chat") {
                            onSwitchView?.("chat");
                          }
                        }}
                        className={cn(
                          "group w-full border-0 bg-transparent flex items-center gap-2 h-[30px] px-2 rounded-md cursor-pointer text-left text-[13px] truncate",
                          session.id === currentSessionId
                            ? "bg-(--bg-active) text-(--text-primary)"
                            : "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                        )}
                      >
                        <span
                          className="truncate flex-1"
                          title={getSessionLabel(session)}
                        >
                          {getSessionLabel(session)}
                        </span>
                        {session.updatedAt && (
                          <span className="text-[11px] text-(--text-muted) shrink-0 tabular-nums">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) opacity-0 hover:bg-(--bg-active) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                              onClick={(event) => event.stopPropagation()}
                              aria-label={t("sessionActions")}
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
                              {t("deleteSession")}
                            </button>
                          </PopoverContent>
                        </Popover>
                      </div>
                    ))}
                    {projectSessionLimit < projectSessions.length && (
                      <button
                        type="button"
                        className="h-[26px] rounded-md border-0 bg-transparent px-2 text-left text-[12px] font-medium text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                        onClick={() =>
                          loadMoreProjectSessions(
                            projectKey,
                            projectSessions.length,
                          )
                        }
                      >
                        {t("showMoreSessions")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {sessionsLoading && allSessions.length === 0 && (
            <div className="px-3 py-4 text-center">
              <Spinner className="justify-center" />
            </div>
          )}
          {!sessionsLoading &&
            projectSessionsOnly.length === 0 &&
            generalSessions.length === 0 &&
            !showActiveProjectsEmpty && (
              <SidebarEmptyPlaceholder className="mb-1">
                {t("noSessions")}
              </SidebarEmptyPlaceholder>
            )}
        </nav>

        <section className="px-2.5 pb-2">
          <Separator className="my-2 bg-transparent" />
          <div className="flex items-center gap-2 px-1.5 pb-1.5">
            <span className="min-w-0 flex-1 text-[12px] font-medium text-(--text-muted)">
              {t("conversations")}
            </span>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary)"
              title={t("newChat")}
              aria-label={t("newChat")}
              onClick={openGeneralNewSession}
            >
              <Plus size={14} strokeWidth={1.9} />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {sessionsLoading && generalSessions.length === 0 && (
              <div className="flex h-[34px] items-center justify-center px-3 text-(--text-muted)">
                <Spinner />
              </div>
            )}
            {generalSessions.slice(0, generalSessionLimit).map((session) => {
              const active =
                session.id === currentSessionId && currentView === "chat";
              return (
                <div
                  key={session.id}
                  onClick={() => {
                    if (session.id !== currentSessionId) {
                      onSwitchSession(session.id);
                    } else if (currentView !== "chat") {
                      onSwitchView?.("chat");
                    }
                  }}
                  className={cn(
                    "group flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-2 text-left text-[13px]",
                    active
                      ? "bg-(--bg-active) text-(--text-primary)"
                      : "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                  )}
                >
                  <span
                    className="min-w-0 flex-1 truncate font-medium"
                    title={getSessionLabel(session)}
                  >
                    {getSessionLabel(session)}
                  </span>
                  {session.updatedAt && (
                    <span className="shrink-0 text-[11px] tabular-nums text-(--text-muted)">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) opacity-0 hover:bg-(--bg-active) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={t("sessionActions")}
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
                        {t("deleteSession")}
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
            {generalSessionLimit < generalSessions.length && (
              <button
                type="button"
                className="h-[28px] rounded-md border-0 bg-transparent px-2 text-left text-[12px] font-medium text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                onClick={loadMoreGeneralSessions}
              >
                {t("showMoreSessions")}
              </button>
            )}
            {!sessionsLoading && generalSessions.length === 0 && (
              <button
                type="button"
                onClick={openGeneralNewSession}
                className="h-[34px] rounded-lg border-0 bg-transparent px-2 text-left text-[13px] text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              >
                {t("noConversations")}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Footer */}

      <div className="mt-auto px-2.5 py-2 flex flex-col gap-0">
        <Separator className="my-2 bg-transparent" />
        {versionInfo?.latest && versionInfo.latest !== versionInfo.current && (
          <button
            className="w-full border-0 bg-(--bg-tertiary) rounded-md mb-2 px-2.5 py-1.5 cursor-pointer text-[11px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) flex items-center justify-center gap-1.5"
            onClick={updateStatus === "updating" ? undefined : onUpdate}
            disabled={updateStatus === "updating"}
          >
            {updateStatus === "updating" ? (
              <>{t("updating")}</>
            ) : updateStatus === "done" ? (
              <>{t("updatedRestart")}</>
            ) : (
              <>{t("updateAvailable")}</>
            )}
          </button>
        )}
        <div className="flex items-center justify-center gap-1">
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onOpenAbout}
            title={t("about")}
            aria-label={t("about")}
          >
            <Info size={15} strokeWidth={1.8} />
          </button>
          <a
            href="https://github.com/havingautism/Codemini-CLI"
            target="_blank"
            rel="noreferrer"
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            title={t("projectRepository")}
            aria-label={t("projectRepository")}
          >
            <GitHubIcon size={15} />
          </a>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
                title={t("switchThemePalette")}
                aria-label={t("switchThemePalette")}
              >
                <Palette size={15} strokeWidth={1.8} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              side="top"
              className="w-44 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
            >
              {THEME_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  type="button"
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left text-[13px] flex items-center gap-2 hover:bg-(--bg-hover)",
                    themePalette === palette.id &&
                      "text-(--text-primary) font-medium",
                  )}
                  onClick={() => setThemePalette(palette.id)}
                >
                  <span className="flex shrink-0 -space-x-1">
                    {palette.swatches.map((color) => (
                      <span
                        key={color}
                        className="size-3 rounded-full border border-(--border-default)"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t(palette.labelKey)}
                  </span>
                  {themePalette === palette.id && <Check size={13} />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
                title={t("switchLanguage")}
                aria-label={t("switchLanguage")}
              >
                <Globe size={15} strokeWidth={1.8} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              side="top"
              className="w-30 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
            >
              {["zh", "en"].map((locale) => (
                <button
                  key={locale}
                  type="button"
                  className={cn(
                    "w-full rounded-md px-2.5 py-1.5 text-left text-[13px] flex items-center justify-between hover:bg-(--bg-hover)",
                    getLocale() === locale &&
                      "text-(--text-primary) font-medium",
                  )}
                  onClick={() => {
                    if (getLocale() !== locale) {
                      setLocale(locale);
                      window.location.reload();
                    }
                  }}
                >
                  <span>{locale === "zh" ? "中文" : "English"}</span>
                  {getLocale() === locale && <Check size={13} />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
                title={t("switchTheme")}
                aria-label={t("switchTheme")}
              >
                {isDark ? (
                  <Moon size={15} strokeWidth={1.8} />
                ) : (
                  <Sun size={15} strokeWidth={1.8} />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              side="top"
              className="w-40 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
            >
              {[
                { mode: "light", icon: Sun, label: t("lightMode") },
                { mode: "dark", icon: Moon, label: t("darkMode") },
                { mode: "auto", icon: Monitor, label: t("autoModeTheme") },
              ].map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "w-full rounded-md px-2.5 py-1.5 text-left text-[13px] flex items-center justify-between hover:bg-(--bg-hover)",
                    themeMode === mode && "text-(--text-primary) font-medium",
                  )}
                  onClick={() => onSetTheme(mode)}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon size={13} strokeWidth={1.8} />
                    <span>{label}</span>
                  </span>
                  {themeMode === mode && <Check size={13} />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onOpenSettings}
            title={t("settings")}
            aria-label={t("settings")}
          >
            <Settings size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title={t("deleteSessionConfirm")}
        description={
          pendingDelete
            ? t("deleteSessionDescription").replace(
                "{{session}}",
                pendingDelete.title ||
                  pendingDelete.preview ||
                  pendingDelete.id ||
                  "",
              )
            : ""
        }
        loading={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={confirmDeleteSession}
      />
      <ConfirmDialog
        open={!!pendingRemoveActive}
        title={t("removeActiveProjectConfirm")}
        description={
          pendingRemoveActive
            ? t("removeActiveProjectDescription").replace(
                "{{project}}",
                pendingRemoveActive.label || pendingRemoveActive.projectKey,
              )
            : ""
        }
        confirmLabel={t("removeActiveProject")}
        loadingLabel={t("removingFromActive")}
        loading={removingFromActive}
        onOpenChange={(open) =>
          !open && !removingFromActive && setPendingRemoveActive(null)
        }
        onConfirm={confirmRemoveFromActive}
      />
    </aside>
  );
}
