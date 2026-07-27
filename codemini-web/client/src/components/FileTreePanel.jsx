import { useCallback, useEffect, useRef, useState } from "react";
import { Tree } from "react-arborist";
import {
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

function NodeRenderer({ node, style, dragHandle }) {
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
          if (isDirectory) {
            node.toggle();
            return;
          }
          node.activate();
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

  const loadRoot = useCallback(async () => {
    if (disabled) {
      setTreeData([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    setMode("tree");
    setPreview(null);
    try {
      const result = await fetchWorkspaceTree(sessionId, "");
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
  }, [disabled, projectCwd, sessionId]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

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
        <div className="flex shrink-0 items-center gap-2 border-b border-(--border-default) px-3 py-2">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
            onClick={() => {
              setMode("tree");
              setPreview(null);
              setPreviewError("");
            }}
          >
            {t("workspaceBackToTree")}
          </button>
          <div
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--text-muted)"
            title={preview?.path || ""}
          >
            {preview?.path || t("workspacePreview")}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {previewLoading ? (
            <div className="text-[12px] text-(--text-muted)">
              {t("workspacePreviewLoading")}
            </div>
          ) : null}
          {previewError ? (
            <div className="text-[12px] text-(--accent-red)">{previewError}</div>
          ) : null}
          {!previewLoading && !previewError && preview?.kind === "unsupported" ? (
            <div className="text-[12px] text-(--text-muted)">
              {preview.message || t("workspacePreviewUnsupported")}
            </div>
          ) : null}
          {!previewLoading && !previewError && preview?.kind === "text" ? (
            <>
              {preview.truncated ? (
                <div className="mb-2 text-[11px] text-(--text-muted)">
                  {t("workspacePreviewTruncated")}
                </div>
              ) : null}
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-(--text-secondary)">
                {preview.content || ""}
              </pre>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="shrink-0 truncate border-b border-(--border-default) px-3 py-1.5 font-mono text-[11px] text-(--text-muted)"
        title={rootPath}
      >
        {rootPath || projectCwd || "—"}
      </div>
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
            {NodeRenderer}
          </Tree>
        ) : null}
      </div>
    </div>
  );
}
