import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree } from "react-arborist";
import {
  ArrowUp,
  CaretDown,
  CaretRight,
  File as FileIcon,
  Folder,
  FolderOpen,
} from "@phosphor-icons/react";
import {
  fetchWorkspacePreview,
  fetchWorkspaceTree,
} from "@/hooks/use-api.js";
import { FilePreviewCode } from "@/components/FilePreviewCode.jsx";
import { t } from "../../i18n/index.js";

function markUnloaded(nodes = []) {
  return nodes.map((node) => {
    if (node.type !== "directory") return { ...node };
    return {
      ...node,
      children: [],
      _loaded: false,
    };
  });
}

function replaceChildren(nodes, targetId, children) {
  return nodes.map((node) => {
    if (node.id === targetId) {
      return {
        ...node,
        children: markUnloaded(children),
        _loaded: true,
      };
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      return {
        ...node,
        children: replaceChildren(node.children, targetId, children),
      };
    }
    return node;
  });
}

function normalizeBrowsePath(path = "") {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function parentBrowsePath(path = "") {
  const normalized = normalizeBrowsePath(path);
  if (!normalized) return "";
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

function splitBrowseSegments(path = "") {
  const normalized = normalizeBrowsePath(path);
  if (!normalized) return [];
  const parts = normalized.split("/");
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

function projectDisplayName(rootPath = "", fallback = "") {
  const normalized = String(rootPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (!normalized) return fallback || "—";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || fallback || "—";
}

function joinAbsolutePath(rootPath = "", browsePath = "") {
  const root = String(rootPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const rel = normalizeBrowsePath(browsePath);
  if (!root) return rel || "";
  if (!rel) return root;
  return `${root}/${rel}`;
}

function PathBar({
  projectName,
  segments = [],
  absoluteTitle = "",
  canGoUp = false,
  onGoUp,
  onNavigate,
}) {
  const hasDeeper = segments.length > 0;

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-(--border-default) px-2 py-1"
      title={absoluteTitle}
    >
      {canGoUp ? (
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
          aria-label={t("workspaceGoUp")}
          title={t("workspaceGoUp")}
          onClick={onGoUp}
        >
          <ArrowUp size={14} />
        </button>
      ) : null}
      <nav
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-[11px] text-(--text-muted)"
        aria-label={t("workspaceBreadcrumb")}
      >
        {hasDeeper ? (
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
            onClick={() => onNavigate?.("")}
          >
            {projectName}
          </button>
        ) : (
          <span className="shrink-0 px-1 py-0.5 text-(--text-primary)">
            {projectName}
          </span>
        )}
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <span key={segment.path} className="inline-flex shrink-0 items-center gap-0.5">
              <span className="text-(--text-muted)" aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className="px-1 py-0.5 text-(--text-primary)">
                  {segment.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded px-1 py-0.5 text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  onClick={() => onNavigate?.(segment.path)}
                >
                  {segment.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}

function NodeRenderer({ node, style, dragHandle, onEnterDirectory }) {
  const isDirectory = node.data.type === "directory";
  const isOpen = node.isOpen;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={
        "flex items-center gap-1 px-1 text-[12px] " +
        (node.isSelected
          ? "bg-(--bg-hover) text-(--text-primary)"
          : "text-(--text-secondary) hover:bg-(--bg-hover)/70")
      }
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left"
        onClick={(event) => {
          event.preventDefault();
          if (event.detail > 1) return;
          if (isDirectory) {
            node.toggle();
            return;
          }
          node.activate();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!isDirectory) return;
          const nextPath = normalizeBrowsePath(node.data.path || node.data.id || "");
          if (nextPath) onEnterDirectory?.(nextPath);
        }}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-(--text-muted)">
          {isDirectory ? (
            isOpen ? <CaretDown size={12} /> : <CaretRight size={12} />
          ) : null}
        </span>
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-(--text-muted)">
          {isDirectory ? (
            isOpen ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <FileIcon size={14} />
          )}
        </span>
        <span className="min-w-0 truncate">{node.data.name}</span>
      </button>
    </div>
  );
}

export function FileTreePanel({
  sessionId = "",
  projectCwd = "",
  disabled = false,
}) {
  const [treeData, setTreeData] = useState([]);
  const [rootPath, setRootPath] = useState(projectCwd || "");
  const [browsePath, setBrowsePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("tree");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const containerRef = useRef(null);
  const treeRef = useRef(null);
  const [treeSize, setTreeSize] = useState({ width: 280, height: 360 });
  const loadingDirsRef = useRef(new Set());

  useEffect(() => {
    setBrowsePath("");
  }, [sessionId, projectCwd, disabled]);

  const exitPreview = useCallback(() => {
    setMode("tree");
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
  }, []);

  const loadBrowse = useCallback(async () => {
    if (disabled) {
      setTreeData([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    setMode("tree");
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
    loadingDirsRef.current.clear();
    try {
      const result = await fetchWorkspaceTree(sessionId, browsePath);
      if (result?.error) {
        throw new Error(result.message || t("workspaceTreeFailed"));
      }
      setRootPath(result.rootPath || projectCwd || "");
      setTreeData(markUnloaded(Array.isArray(result.entries) ? result.entries : []));
    } catch (err) {
      setTreeData([]);
      setError(String(err?.message || t("workspaceTreeFailed")));
    } finally {
      setLoading(false);
    }
  }, [browsePath, disabled, projectCwd, sessionId]);

  useEffect(() => {
    loadBrowse();
  }, [loadBrowse]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(180, Math.floor(entry.contentRect.width));
      const height = Math.max(160, Math.floor(entry.contentRect.height));
      setTreeSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [mode]);

  const ensureDirectoryLoaded = useCallback(
    async (id, data) => {
      if (!data || data.type !== "directory" || data._loaded) return;
      if (loadingDirsRef.current.has(id)) return;
      loadingDirsRef.current.add(id);
      try {
        const result = await fetchWorkspaceTree(sessionId, data.path || id);
        if (result?.error) {
          setError(result.message || t("workspaceTreeFailed"));
          return;
        }
        const children = Array.isArray(result.entries) ? result.entries : [];
        setTreeData((current) => replaceChildren(current, id, children));
      } catch (err) {
        setError(String(err?.message || t("workspaceTreeFailed")));
      } finally {
        loadingDirsRef.current.delete(id);
      }
    },
    [sessionId],
  );

  const handleActivate = useCallback(
    async (node) => {
      const data = node?.data;
      if (!data || data.type !== "file") return;
      setMode("preview");
      setPreview(null);
      setPreviewError("");
      setPreviewLoading(true);
      try {
        const result = await fetchWorkspacePreview(sessionId, data.path || data.id);
        if (result?.error) {
          throw new Error(result.message || t("workspacePreviewFailed"));
        }
        setPreview(result);
      } catch (err) {
        setPreviewError(String(err?.message || t("workspacePreviewFailed")));
      } finally {
        setPreviewLoading(false);
      }
    },
    [sessionId],
  );

  const navigateToBrowsePath = useCallback(
    (path) => {
      const next = normalizeBrowsePath(path);
      exitPreview();
      setBrowsePath((current) => (current === next ? current : next));
      // Same folder as current browsePath: still leave preview (exitPreview above).
    },
    [exitPreview],
  );

  const handleEnterDirectory = useCallback((path) => {
    navigateToBrowsePath(path);
  }, [navigateToBrowsePath]);

  const handleGoUp = useCallback(() => {
    if (mode === "preview") {
      const parent = parentBrowsePath(preview?.path || "");
      navigateToBrowsePath(parent);
      return;
    }
    setBrowsePath((current) => parentBrowsePath(current));
  }, [mode, navigateToBrowsePath, preview?.path]);

  const projectName = useMemo(
    () => projectDisplayName(rootPath || projectCwd, t("workspaceProjectRoot")),
    [projectCwd, rootPath],
  );
  const browseSegments = useMemo(
    () => splitBrowseSegments(browsePath),
    [browsePath],
  );
  const previewSegments = useMemo(
    () => splitBrowseSegments(preview?.path || ""),
    [preview?.path],
  );
  const absoluteBrowsePath = useMemo(
    () => joinAbsolutePath(rootPath || projectCwd, browsePath),
    [browsePath, projectCwd, rootPath],
  );
  const absolutePreviewPath = useMemo(
    () => joinAbsolutePath(rootPath || projectCwd, preview?.path || ""),
    [preview?.path, projectCwd, rootPath],
  );
  const treeCanGoUp = Boolean(normalizeBrowsePath(browsePath));
  // Show up only when leaving a nested path (not project root / root-level file).
  const previewCanGoUp = Boolean(parentBrowsePath(preview?.path || ""));

  const renderNode = useCallback(
    (props) => (
      <NodeRenderer {...props} onEnterDirectory={handleEnterDirectory} />
    ),
    [handleEnterDirectory],
  );

  if (disabled) {
    return (
      <div className="p-3 text-[12px] text-(--text-muted)">
        {t("workspaceNeedsProject")}
      </div>
    );
  }

  if (mode === "preview") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PathBar
          projectName={projectName}
          segments={previewSegments}
          absoluteTitle={absolutePreviewPath}
          canGoUp={previewCanGoUp}
          onGoUp={handleGoUp}
          onNavigate={navigateToBrowsePath}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {previewLoading ? (
            <div className="p-3 text-[12px] text-(--text-muted)">
              {t("workspacePreviewLoading")}
            </div>
          ) : null}
          {previewError ? (
            <div className="p-3 text-[12px] text-(--accent-red)">{previewError}</div>
          ) : null}
          {!previewLoading && !previewError && preview?.kind === "unsupported" ? (
            <div className="p-3 text-[12px] text-(--text-muted)">
              {preview.message || t("workspacePreviewUnsupported")}
            </div>
          ) : null}
          {!previewLoading && !previewError && preview?.kind === "text" ? (
            <FilePreviewCode
              path={preview.path}
              content={preview.content || ""}
              truncated={Boolean(preview.truncated)}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PathBar
        projectName={projectName}
        segments={browseSegments}
        absoluteTitle={absoluteBrowsePath}
        canGoUp={treeCanGoUp}
        onGoUp={handleGoUp}
        onNavigate={navigateToBrowsePath}
      />
      {error ? (
        <div className="shrink-0 px-3 py-2 text-[12px] text-(--accent-red)">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="p-3 text-[12px] text-(--text-muted)">
          {t("workspaceTreeLoading")}
        </div>
      ) : null}
      {!loading && !error && treeData.length === 0 ? (
        <div className="p-3 text-[12px] text-(--text-muted)">
          {t("workspaceTreeEmpty")}
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
        {!loading && treeData.length > 0 ? (
          <Tree
            ref={treeRef}
            data={treeData}
            width={treeSize.width}
            height={treeSize.height}
            rowHeight={28}
            indent={14}
            openByDefault={false}
            disableDrag
            disableDrop
            disableEdit
            onActivate={handleActivate}
            onToggle={(id) => {
              const node = treeRef.current?.get?.(id);
              if (node?.isOpen) {
                ensureDirectoryLoaded(id, node.data);
              }
            }}
            childrenAccessor={(node) =>
              node.type === "directory" ? node.children || [] : null
            }
          >
            {renderNode}
          </Tree>
        ) : null}
      </div>
    </div>
  );
}
