import { useRef, useState } from "react";
import {
  DotsSixVertical,
  FolderSimple,
  Terminal as TerminalIcon,
  X,
} from "@/lib/icons";
import { FileTreePanel } from "@/components/FileTreePanel.jsx";
import { TerminalPanel } from "@/components/TerminalPanel.jsx";
import { t } from "../../i18n/index.js";

const DEFAULT_PANEL_WIDTH = 500;
const MIN_PANEL_WIDTH = 340;

export function WorkspaceRail({
  tab = "files",
  onTabChange,
  sessionId = "",
  projectCwd = "",
  onClose,
}) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const resizingRef = useRef(false);
  const activeTab = tab === "terminal" ? "terminal" : "files";
  const workspaceDisabled = !String(projectCwd || "").trim();

  const updatePanelWidth = (clientX) => {
    const maxWidth = Math.max(
      MIN_PANEL_WIDTH,
      Math.floor(window.innerWidth * 0.72),
    );
    setPanelWidth(
      Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, window.innerWidth - clientX)),
    );
  };

  const tabButtonClass = (selected) =>
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] " +
    (selected
      ? "bg-(--bg-hover) text-(--text-primary)"
      : "text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)");

  return (
    <aside
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

      <div className="codemini-workspace-rail-body flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-1 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              className={tabButtonClass(activeTab === "files")}
              aria-pressed={activeTab === "files"}
              disabled={workspaceDisabled}
              title={
                workspaceDisabled
                  ? t("workspaceNeedsProject")
                  : t("workspaceFilesTab")
              }
              onClick={() => onTabChange?.("files")}
            >
              <FolderSimple size={14} />
              <span>{t("workspaceFilesTab")}</span>
            </button>
            <button
              type="button"
              className={tabButtonClass(activeTab === "terminal")}
              aria-pressed={activeTab === "terminal"}
              title={t("terminalTitle")}
              onClick={() => onTabChange?.("terminal")}
            >
              <TerminalIcon size={14} />
              <span>{t("terminalTitle")}</span>
            </button>
          </div>
          <button
            type="button"
            className="codemini-terminal-action"
            title={t("close")}
            aria-label={t("close")}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={
              activeTab === "files"
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "hidden"
            }
          >
            <FileTreePanel
              sessionId={sessionId}
              projectCwd={projectCwd}
              disabled={workspaceDisabled}
            />
          </div>
          <div
            className={
              activeTab === "terminal"
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "hidden"
            }
          >
            <TerminalPanel
              sessionId={sessionId}
              projectCwd={projectCwd}
              disabled={workspaceDisabled}
              embedded
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
