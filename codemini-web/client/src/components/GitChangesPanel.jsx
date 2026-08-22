import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { fetchGitDiff } from "@/hooks/use-api";
import { FileTypeIcon } from "@/components/FileTypeIcon.jsx";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const statusColors = {
  M: "text-(--accent-orange)",
  A: "text-(--accent-green)",
  D: "text-(--accent-red)",
  "?": "text-(--text-muted)",
};

const diffScrollCss = `
  [data-code] {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  [data-code]::-webkit-scrollbar {
    width: var(--scrollbar-size);
    height: var(--scrollbar-size);
  }

  [data-code]::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
  }

  [data-code]::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 3px;
  }

  [data-code]::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  [data-code]::-webkit-scrollbar-corner {
    background: var(--scrollbar-track);
  }
`;

function formatDiffPath(filePath) {
  if (!filePath) return "";
  const value = filePath.replace(/\\/g, "/").trim();
  if (!value) return "";
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join("/")}`;
}

export function GitChangesPanel({ sessionId, projectCwd = "", showHeader = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diffContentWidth, setDiffContentWidth] = useState(null);
  const diffPanelRef = useRef(null);

  const getIsDark = useCallback(
    () =>
      document.documentElement.classList.contains("dark") ||
      document.documentElement.dataset.theme === "dark",
    [],
  );
  const [isDark, setIsDark] = useState(getIsDark);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ob = new MutationObserver(() => setIsDark(getIsDark()));
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => ob.disconnect();
  }, [getIsDark]);

  const getPatchForFile = useCallback(
    (filePath) => {
      if (!data?.patch || !filePath) return "";
      const lines = data.patch.split("\n");
      const result = [];
      let inFile = false;
      for (const line of lines) {
        if (line.startsWith("diff --git ")) {
          const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
          if (match && (match[1] === filePath || match[2] === filePath)) {
            inFile = true;
            result.push(line);
          } else {
            inFile = false;
          }
        } else if (inFile) {
          result.push(line);
        }
      }
      return result.join("\n");
    },
    [data?.patch],
  );

  const filesWithDiff = useMemo(() => {
    if (!Array.isArray(data?.files)) return [];
    return data.files.filter((file) => getPatchForFile(file.path).trim());
  }, [data?.files, getPatchForFile]);

  useEffect(() => {
    if (!String(projectCwd || "").trim()) {
      setData(null);
      setSelectedFile(null);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    fetchGitDiff(sessionId)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, projectCwd]);

  useEffect(() => {
    if (!filesWithDiff.length) {
      setSelectedFile(null);
      return;
    }
    if (
      !selectedFile ||
      !filesWithDiff.some((file) => file.path === selectedFile)
    ) {
      setSelectedFile(filesWithDiff[0].path);
    }
  }, [filesWithDiff, selectedFile]);

  const patchForFile = useMemo(() => {
    return getPatchForFile(selectedFile);
  }, [getPatchForFile, selectedFile]);

  useEffect(() => {
    setDiffContentWidth(null);
    if (!patchForFile) return undefined;

    const panel = diffPanelRef.current;
    if (!panel) return undefined;

    let rafId = 0;
    let timeoutId = 0;
    let disposed = false;

    const measure = () => {
      if (disposed) return;

      const host = panel.querySelector("diffs-container");
      const code = host?.shadowRoot?.querySelector("[data-code]");
      if (!code) {
        rafId = window.requestAnimationFrame(measure);
        return;
      }

      const nextWidth = Math.ceil(code.scrollWidth);
      setDiffContentWidth(
        nextWidth > panel.clientWidth ? nextWidth : null,
      );
      timeoutId = window.setTimeout(() => {
        if (!disposed) setDiffContentWidth(null);
      }, 200);
    };

    rafId = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", measure);
    };
  }, [patchForFile]);

  const content = loading ? (
    <div className="flex-1 flex items-center justify-center py-12 text-(--text-muted) text-[13px]">
      {t("gitDiffLoading")}
    </div>
  ) : !filesWithDiff.length ? (
    <div className="flex-1 flex items-center justify-center py-12 text-(--text-muted) text-[13px]">
      {t("gitDiffNoChanges")}
    </div>
  ) : (
    <div className="flex-1 flex min-h-0 gap-2 border-t border-(--border-default) p-2">
      {/* File list sidebar */}
      <div className="w-[200px] shrink-0 overflow-y-auto rounded-md border border-(--border-default) bg-(--bg-primary) py-1">
        {filesWithDiff.map((f) => {
          const displayPath = formatDiffPath(f.path);
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelectedFile(f.path)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] rounded-md border-0 bg-transparent",
                selectedFile === f.path
                  ? "bg-(--bg-hover) text-(--text-primary)"
                  : "text-(--text-secondary) hover:bg-(--bg-hover)",
              )}
              title={f.path}
            >
              <span
                className={cn(
                  "shrink-0 text-[11px] font-mono w-[14px] text-center",
                  statusColors[f.status] || "",
                )}
              >
                {f.status}
              </span>
              <FileTypeIcon path={f.path} size="sm" />
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
            </button>
          );
        })}
      </div>

      {/* Diff content */}
      <div
        ref={diffPanelRef}
        className="min-w-0 flex-1 overflow-auto rounded-md border border-(--border-default) bg-(--bg-secondary)"
      >
        {patchForFile ? (
          <PatchDiff
            className="block min-w-full"
            patch={patchForFile}
            style={
              diffContentWidth
                ? { minWidth: `${diffContentWidth}px` }
                : undefined
            }
            options={{
              theme: { dark: "pierre-dark", light: "pierre-light" },
              themeType: isDark ? "dark" : "light",
              diffStyle: "unified",
              overflow: "scroll",
              unsafeCSS: diffScrollCss,
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-(--text-muted) text-[12px]">
            {t("gitDiffNoDiffAvailable")}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Panel header */}
      {showHeader && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-[12px] font-medium text-(--text-secondary)">
            {t("gitDiffTitle")}
          </span>
          {!String(projectCwd || "").trim() && (
            <span className="text-[11px] text-(--text-muted)">
              {t("gitDiffNoChanges")}
            </span>
          )}
        </div>
      )}
      {content}
    </div>
  );
}
