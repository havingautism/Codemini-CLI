import { useState } from "react";
import {
  Plus,
  Sun,
  Moon,
  Settings,
  Folder,
  ChevronDown,
  Hammer,
  User,
  Info,
  BookOpenText,
  MoreHorizontal,
  Globe,
  Check,
  Palette,
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

function getProjectKey(session) {
  return session?.projectDir || "unknown";
}

function getProjectName(projectDir) {
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
  const [themePalette, setThemePaletteState] = useState(() => {
    if (typeof document === "undefined") return "default";
    return document.documentElement.dataset.palette || "default";
  });

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
    <aside className="w-[260px] shrink-0 flex flex-col bg-(--bg-secondary)">
      {/* Fixed top action buttons */}
      <div className="shrink-0 px-2.5 pt-3 flex flex-col gap-0.5">
        <button
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
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
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
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
          className="w-full border-0 bg-transparent flex items-center gap-2.5 h-[32px] px-2 rounded-lg cursor-pointer text-left text-[13px] hover:bg-(--bg-hover) text-(--text-primary)"
          onClick={onOpenSouls}
        >
          <User
            size={15}
            strokeWidth={2}
            className="text-(--text-secondary) shrink-0"
          />
          <span className="truncate">{t("souls")}</span>
        </button>

        <Separator className="my-2 bg-(--border-default)" />
      </div>

      {/* Scrollable project history */}
      <nav
        className="flex-1 min-h-0 flex flex-col px-2.5 pb-2 gap-0.5 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
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
                  <button
                    type="button"
                    className="border-0 bg-transparent inline-flex size-5 shrink-0 items-center justify-center rounded-md text-inherit cursor-pointer hover:bg-(--bg-active)"
                    onClick={() => toggleProject(projectKey)}
                    aria-label={
                      isExpanded ? t("collapseProject") : t("expandProject")
                    }
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
                          title={
                            session.title ||
                            session.preview ||
                            (session.messageCount > 0
                              ? `${session.messageCount} ${t("messages")}`
                              : t("emptyChat"))
                          }
                        >
                          {session.title ||
                            session.preview ||
                            (session.messageCount > 0
                              ? `${session.messageCount} ${t("messages")}`
                              : t("emptyChat"))}
                        </span>
                        {session.updatedAt && (
                          <span className="text-[11px] text-(--text-muted) shrink-0 tabular-nums">
                            {new Date(session.updatedAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "numeric",
                                day: "numeric",
                              },
                            )}
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
                  </div>
                )}
              </div>
            );
          },
        )}

        {sessionsLoading && allSessions.length === 0 && (
          <div className="px-3 py-4 text-center">
            <Spinner className="justify-center" />
          </div>
        )}
        {!sessionsLoading && allSessions.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-(--text-muted) text-center">
            {t("noSessions")}
          </div>
        )}
      </nav>

      {/* Footer */}

      <div className="px-2.5 py-2 flex flex-col gap-0">
        <Separator className="my-2 bg-(--border-default)" />
        {versionInfo?.latest && versionInfo.latest !== versionInfo.current && (
          <button
            className="w-full border-0 bg-(--bg-tertiary) rounded-md px-2.5 py-1.5 cursor-pointer text-[11px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) flex items-center justify-center gap-1.5"
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
              className="w-28 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
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
          <button
            className="border-0 bg-transparent inline-flex items-center justify-center size-8 rounded-lg cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary) text-(--text-secondary)"
            onClick={onToggleTheme}
            title={isDark ? t("lightMode") : t("darkMode")}
            aria-label={isDark ? t("switchToLightMode") : t("switchToDarkMode")}
          >
            {isDark ? (
              <Moon size={15} strokeWidth={1.8} />
            ) : (
              <Sun size={15} strokeWidth={1.8} />
            )}
          </button>
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
    </aside>
  );
}
