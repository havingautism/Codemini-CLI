import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Tree } from "react-arborist";
import {
  ArrowClockwise,
  ArrowLeft,
  CaretDown,
  CaretRight,
  CaretUp,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  X,
} from "@/lib/icons";
import {
  fetchWorkspacePreview,
  fetchWorkspaceTree,
} from "@/hooks/use-api.js";
import { FileTypeIcon } from "@/components/FileTypeIcon.jsx";
import { FilePreviewCode } from "@/components/FilePreviewCode.jsx";
import { ImagePreviewDialog } from "@/components/MarkdownLightboxImage.jsx";
import { Input } from "@/components/ui/input";
import { LinearRing } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";

const WORKSPACE_IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

function isWorkspaceImagePath(filePath = "") {
  return WORKSPACE_IMAGE_EXT.test(String(filePath || ""));
}

function workspaceFileUrl(sessionId, relativePath = "") {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  params.set("path", String(relativePath || "").trim());
  return `/api/workspace/file?${params.toString()}`;
}

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

function countTreeItems(nodes = []) {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children) && node.children.length > 0) {
      count += countTreeItems(node.children);
    }
  }
  return count;
}

function countTreeMatches(nodes = [], term = "") {
  const query = String(term || "").trim().toLocaleLowerCase();
  if (!query) return 0;
  let count = 0;
  for (const node of nodes) {
    if (String(node.name || "").toLocaleLowerCase().includes(query)) {
      count += 1;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      count += countTreeMatches(node.children, query);
    }
  }
  return count;
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
      className="flex h-10 shrink-0 items-center gap-1 px-3"
      title={absoluteTitle}
    >
      {canGoUp ? (
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent-blue)"
          aria-label={t("workspaceGoUp")}
          title={t("workspaceGoUp")}
          onClick={onGoUp}
        >
          <ArrowLeft size={14} />
        </button>
      ) : null}
      <nav
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[12px] text-(--text-muted) [scrollbar-width:none]"
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
          <span className="shrink-0 px-1 py-0.5 font-medium text-(--text-primary)">
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
      className="group flex items-center px-2 text-[13px] text-(--text-secondary)"
    >
      <button
        type="button"
        className={
          "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left transition-[background-color,color] focus-visible:bg-(--bg-hover) focus-visible:text-(--text-primary) focus-visible:outline-none " +
          (node.isSelected
            ? "bg-(--selected-bg) text-(--text-primary)"
            : "hover:bg-(--bg-hover) hover:text-(--text-primary)")
        }
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
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-(--text-muted)">
          {isDirectory ? (
            isOpen ? (
              <FolderOpen size={15} weight="fill" />
            ) : (
              <Folder size={15} weight="fill" />
            )
          ) : (
            <FileTypeIcon path={node.data.path || node.data.name} size="sm" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
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
  const [searchTerm, setSearchTerm] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const containerRef = useRef(null);
  const treeRef = useRef(null);
  const [treeSize, setTreeSize] = useState({ width: 280, height: 360 });
  const loadingDirsRef = useRef(new Set());
  const treeGenerationRef = useRef(0);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    setBrowsePath("");
    setSearchTerm("");
  }, [sessionId, projectCwd, disabled]);

  const exitPreview = useCallback(() => {
    previewRequestRef.current += 1;
    setMode("tree");
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
  }, []);

  const loadBrowse = useCallback(async () => {
    const generation = treeGenerationRef.current + 1;
    treeGenerationRef.current = generation;
    if (disabled) {
      setTreeData([]);
      setError("");
      setLoading(false);
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
      if (treeGenerationRef.current !== generation) return;
      if (result?.error) {
        throw new Error(result.message || t("workspaceTreeFailed"));
      }
      setRootPath(result.rootPath || projectCwd || "");
      setTreeData(markUnloaded(Array.isArray(result.entries) ? result.entries : []));
    } catch (err) {
      if (treeGenerationRef.current !== generation) return;
      setTreeData([]);
      setError(String(err?.message || t("workspaceTreeFailed")));
    } finally {
      if (treeGenerationRef.current === generation) setLoading(false);
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
      const generation = treeGenerationRef.current;
      loadingDirsRef.current.add(id);
      try {
        const result = await fetchWorkspaceTree(sessionId, data.path || id);
        if (treeGenerationRef.current !== generation) return;
        if (result?.error) {
          setError(result.message || t("workspaceTreeFailed"));
          return;
        }
        const children = Array.isArray(result.entries) ? result.entries : [];
        setTreeData((current) => replaceChildren(current, id, children));
      } catch (err) {
        if (treeGenerationRef.current !== generation) return;
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
      const relativePath = data.path || data.id || "";
      if (isWorkspaceImagePath(relativePath) || isWorkspaceImagePath(data.name)) {
        setImagePreview({
          src: workspaceFileUrl(sessionId, relativePath),
          alt: data.name || relativePath,
        });
        return;
      }
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      setMode("preview");
      setPreview(null);
      setPreviewError("");
      setPreviewLoading(true);
      try {
        const result = await fetchWorkspacePreview(sessionId, relativePath);
        if (previewRequestRef.current !== requestId) return;
        if (result?.error) {
          throw new Error(result.message || t("workspacePreviewFailed"));
        }
        if (result?.kind === "image") {
          setMode("tree");
          setPreviewLoading(false);
          setImagePreview({
            src: workspaceFileUrl(sessionId, result.path || relativePath),
            alt: data.name || result.path || relativePath,
          });
          return;
        }
        setPreview(result);
      } catch (err) {
        if (previewRequestRef.current !== requestId) return;
        setPreviewError(String(err?.message || t("workspacePreviewFailed")));
      } finally {
        if (previewRequestRef.current === requestId) setPreviewLoading(false);
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
      // Root-level files → ""; nested files → their parent folder.
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
  // Preview always offers up/back: root files return to project tree, nested files to parent folder.
  const previewCanGoUp = true;

  const renderNode = useCallback(
    (props) => (
      <NodeRenderer {...props} onEnterDirectory={handleEnterDirectory} />
    ),
    [handleEnterDirectory],
  );
  const loadedItemCount = useMemo(
    () => countTreeItems(treeData),
    [treeData],
  );
  const matchedItemCount = useMemo(
    () => countTreeMatches(treeData, deferredSearchTerm),
    [deferredSearchTerm, treeData],
  );
  const searchMatch = useCallback(
    (node, term) =>
      String(node?.data?.name || "")
        .toLocaleLowerCase()
        .includes(String(term || "").trim().toLocaleLowerCase()),
    [],
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
      <>
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
        {imagePreview ? (
          <ImagePreviewDialog
            src={imagePreview.src}
            alt={imagePreview.alt}
            caption={imagePreview.alt}
            onClose={() => setImagePreview(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
      <PathBar
        projectName={projectName}
        segments={browseSegments}
        absoluteTitle={absoluteBrowsePath}
        canGoUp={treeCanGoUp}
        onGoUp={handleGoUp}
        onNavigate={navigateToBrowsePath}
      />
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-2">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
            aria-hidden="true"
          />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-8 pl-8 pr-8 text-[12px]"
            placeholder={t("workspaceSearchPlaceholder")}
            aria-label={t("workspaceSearchPlaceholder")}
            spellCheck={false}
          />
          {searchTerm ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              onClick={() => setSearchTerm("")}
              aria-label={t("workspaceClearFilter")}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent-blue)"
          onClick={() => treeRef.current?.closeAll?.()}
          title={t("workspaceCollapseAll")}
          aria-label={t("workspaceCollapseAll")}
        >
          <CaretUp size={13} />
        </button>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent-blue) disabled:opacity-50"
          onClick={loadBrowse}
          title={t("refresh")}
          aria-label={t("refresh")}
          disabled={loading}
        >
          {loading ? <LinearRing size="sm" /> : <ArrowClockwise size={13} />}
        </button>
      </div>
      {error ? (
        <div className="shrink-0 px-3 py-2 text-[12px] text-(--accent-red)">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="flex flex-col gap-2 px-3 py-3" aria-label={t("workspaceTreeLoading")}>
          {[72, 58, 81, 64, 76].map((width, index) => (
            <div key={width} className="flex h-5 items-center gap-2" style={{ paddingLeft: `${(index % 3) * 12}px` }}>
              <span className="size-3.5 animate-pulse rounded bg-(--bg-hover)" />
              <span
                className="h-2.5 animate-pulse rounded bg-(--bg-hover)"
                style={{ width: `${width}%` }}
              />
            </div>
          ))}
        </div>
      ) : null}
      {!loading && !error && treeData.length === 0 ? (
        <div className="p-3 text-[12px] text-(--text-muted)">
          {t("workspaceTreeEmpty")}
        </div>
      ) : null}
      {!loading &&
      treeData.length > 0 &&
      deferredSearchTerm.trim() &&
      matchedItemCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-[12px] text-(--text-muted)">
          <MagnifyingGlass size={20} />
          <span>{t("workspaceNoMatches")}</span>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden [&_[role=treeitem]:focus]:outline-none"
      >
        {!loading &&
        treeData.length > 0 &&
        (!deferredSearchTerm.trim() || matchedItemCount > 0) ? (
          <Tree
            ref={treeRef}
            data={treeData}
            width={treeSize.width}
            height={treeSize.height}
            rowHeight={32}
            indent={14}
            openByDefault={false}
            searchTerm={deferredSearchTerm}
            searchMatch={searchMatch}
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
      {!loading && treeData.length > 0 ? (
        <div className="flex h-7 shrink-0 items-center px-3 text-[10px] text-(--text-muted)">
          {deferredSearchTerm.trim()
            ? t("workspaceMatchCount").replace("{{count}}", matchedItemCount)
            : t("workspaceLoadedCount").replace("{{count}}", loadedItemCount)}
        </div>
      ) : null}
      </div>
      {imagePreview ? (
        <ImagePreviewDialog
          src={imagePreview.src}
          alt={imagePreview.alt}
          caption={imagePreview.alt}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </>
  );
}
