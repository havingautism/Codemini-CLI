import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Folder,
  MagnifyingGlass,
  Tray,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { ResourceLibraryDialog } from "@/components/ResourceLibraryDialog.jsx";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const SCOPES = ["user", "project", "global"];

function formatMemoryTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scopeLabel(scope) {
  if (scope === "project") return t("projectScope");
  if (scope === "global") return t("globalScope");
  return t("userScope");
}

function memoryKey(memory, scope) {
  return `${memory?.projectDir || scope}:${memory?.id || ""}`;
}

function projectDisplayName(value) {
  return value === "__codemini_general__" ? t("generalChat") : value;
}

function projectDirsKey(projectDirs = []) {
  return Array.isArray(projectDirs)
    ? projectDirs
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join("\n")
    : "";
}

function memoryDisplayParts(memory) {
  const summary = String(memory?.summary || "").trim();
  const content = String(memory?.content || "").trim();
  const title = summary || content || t("memory");
  const showPreview = Boolean(content && (!summary || content !== summary));
  return { title, preview: showPreview ? content : "" };
}

function MemoryCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-(--border-default) p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-10 rounded-md" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-px w-full" />
      <div className="flex items-center gap-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-7 w-7 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
    </div>
  );
}

function MemoryDetailPane({ memory, scope }) {
  if (!memory) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-(--text-muted)">
        {t("noMemories")}
      </div>
    );
  }

  const { title } = memoryDisplayParts(memory);
  const content = String(memory.content || "").trim() || t("noPreview");
  const updatedLabel = formatMemoryTime(memory.updatedAt);
  const confidenceLabel = Number.isFinite(Number(memory.confidence))
    ? `${Math.round(Number(memory.confidence) * 100)}%`
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-(--border-default) px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-[17px] font-semibold leading-6 text-(--text-primary)">
            {title}
          </h3>
          <Badge variant="outline" className="h-6 rounded-md px-2 text-[11px]">
            {memory.kind || "note"}
          </Badge>
          {memory.pinned ? (
            <Badge variant="secondary" className="h-6 rounded-md px-2 text-[11px]">
              {t("pinned")}
            </Badge>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-(--text-muted)">
          <span>{scopeLabel(scope)}</span>
          {memory.lifecycle ? <span>{memory.lifecycle}</span> : null}
          {updatedLabel ? <span>{updatedLabel}</span> : null}
          {confidenceLabel ? <span>{confidenceLabel}</span> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-5">
        <pre className="min-h-full whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-(--text-primary)">
          {content}
        </pre>
      </div>
    </div>
  );
}

function MemoryGroupHeader({ name, count, collapsed, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-1 text-left hover:bg-(--bg-hover)"
      title={title}
      aria-expanded={!collapsed}
    >
      <Folder size={13} className="shrink-0 text-(--text-muted)" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-(--text-muted)">
        {name}
      </span>
      <span className="shrink-0 text-[12px] font-medium text-[var(--input-shell-accent)]">
        {count}
      </span>
      {collapsed ? (
        <CaretRight size={12} className="shrink-0 text-(--text-muted)" />
      ) : (
        <CaretDown size={12} className="shrink-0 text-(--text-muted)" />
      )}
    </button>
  );
}

function MemoryCard({ memory, selected, deleting, onSelect, onDelete }) {
  const pinned = !!memory.pinned;
  const { title } = memoryDisplayParts(memory);
  const updatedLabel = formatMemoryTime(memory.updatedAt);

  const handleDeleteClick = () => {
    if (deleting) return;
    onDelete(memory);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(memory)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(memory);
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] focus-visible:shadow-[0_0_0_3px_var(--control-focus-ring)]",
        selected
          ? "border-transparent bg-(--bg-active)"
          : pinned
            ? "border-transparent bg-primary/5"
            : "border-transparent bg-transparent hover:bg-(--bg-hover)",
      )}
    >
      {/* Header: title + badges */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <Badge
          variant="outline"
          className="h-5 rounded-md px-1.5 text-[11px]"
        >
          {memory.kind || "note"}
        </Badge>
        {memory.lifecycle && (
          <Badge
            variant="secondary"
            className="h-5 rounded-md px-1.5 text-[11px]"
          >
            {memory.lifecycle}
          </Badge>
        )}
        {pinned && (
          <Badge
            variant="secondary"
            className="h-5 rounded-md px-1.5 text-[11px]"
          >
            {t("pinned")}
          </Badge>
        )}
      </div>

      {/* Footer: time + actions */}
      <Separator />
      <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
        {updatedLabel && (
          <span className="text-xs text-muted-foreground">{updatedLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={deleting}
            className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
            onClick={handleDeleteClick}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MemoryDialog({ open, onOpenChange, projectDirs = [] }) {
  const [scope, setScope] = useState("user");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());

  const trimmedQuery = query.trim();
  const projectKey = projectDirsKey(projectDirs);
  const requestProjectDirs = useMemo(
    () => (projectKey ? projectKey.split("\n") : []),
    [projectKey],
  );

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.fetchMemories({
        scope,
        query: trimmedQuery,
        projectDirs: requestProjectDirs,
      });
      if (result?.error)
        throw new Error(result.message || t("memoryLoadFailed"));
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (err) {
      setItems([]);
      setError(err.message || t("memoryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [scope, trimmedQuery, requestProjectDirs]);

  useEffect(() => {
    if (!open) return;
    loadMemories();
  }, [open, loadMemories]);

  const kindCounts = useMemo(() => {
    const counts = items.reduce((acc, item) => {
      const kind = item.kind || "note";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const groupedItems = useMemo(() => {
    if (scope !== "project") return { regular: items, projectGroups: [] };
    const projectGroups = [];
    const groupIndex = new Map();
    for (const item of items) {
      const key = item.projectDir || "__current_project__";
      if (!groupIndex.has(key)) {
        const group = {
          key,
          name: projectDisplayName(item.projectName || t("projectScope")),
          items: [],
        };
        groupIndex.set(key, group);
        projectGroups.push(group);
      }
      groupIndex.get(key).items.push(item);
    }
    return { regular: [], projectGroups };
  }, [items, scope]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedMemory(null);
      return;
    }
    if (!selectedMemory || !items.some((item) => memoryKey(item, scope) === memoryKey(selectedMemory, scope))) {
      setSelectedMemory(items[0]);
    }
  }, [items, scope, selectedMemory]);

  const toggleProjectGroup = useCallback((key) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleDelete = async (memory) => {
    if (!memory?.id) return;
    if (
      !confirm(
        t("confirmDeleteMemory").replace(
          "{{summary}}",
          memory.summary || memory.id,
        ),
      )
    ) {
      return;
    }
    setDeletingId(memoryKey(memory, scope));
    setError("");
    try {
      const result = await api.forgetMemory(
        scope,
        memory.id,
        memory.projectDir,
      );
      if (result?.error) throw new Error(result.message || t("deleteFailed"));
      await loadMemories();
    } catch (err) {
      setError(err.message || t("deleteFailed"));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <>
      <ResourceLibraryDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("memoryManagement")}
        description={t("memoryPanelHint")}
      >
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3 border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {items.length > 0 && (
                  <>
                    <span className="text-[12px] text-(--text-muted)">
                      {items.length} {t("items")}
                    </span>
                    {kindCounts.map(([kind, count]) => (
                      <Badge
                        key={kind}
                        variant="outline"
                        className="h-4 rounded-md px-1.5 py-0 text-[10px]"
                      >
                        {kind} {count}
                      </Badge>
                    ))}
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={loadMemories}
                disabled={loading}
                size="icon-sm"
                className="w-full shrink-0 sm:ml-auto sm:w-auto"
                title={t("refresh")}
                aria-label={t("refresh")}
              >
                <ArrowClockwise
                  size={15}
                  className={cn(loading && "animate-spin")}
                />
              </Button>
            </div>

          <div className="flex shrink-0 flex-col gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchMemories")}
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <SettingsSegmentedControl
              idPrefix="memory-scope"
              value={scope}
              onValueChange={setScope}
              options={SCOPES.map((item) => ({
                value: item,
                label: scopeLabel(item),
              }))}
              className="w-full shrink-0 [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
          </div>

          {error && (
            <div className="flex shrink-0 items-start gap-2 rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              <WarningCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="min-h-[220px] flex-1 overflow-y-auto scroll-smooth pr-2 [scrollbar-gutter:stable]">
            {loading ? (
              <div className="grid gap-2">
                <MemoryCardSkeleton />
                <MemoryCardSkeleton />
                <MemoryCardSkeleton />
              </div>
            ) : items.length === 0 ? (
              <Empty className="rounded-lg py-10">
                <Tray
                  size={28}
                  className="mb-2 text-(--text-muted)"
                  aria-hidden
                />
                <EmptyDescription className="text-[13px] text-(--text-primary)">
                  {trimmedQuery ? t("noMatches") : t("noMemories")}
                </EmptyDescription>
                <EmptyDescription className="text-[11px] text-(--text-muted)">
                  {t("noMemoriesHint")}
                </EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {groupedItems.regular.map((memory) => (
                  <MemoryCard
                    key={memoryKey(memory, scope)}
                    memory={memory}
                    selected={memoryKey(memory, scope) === memoryKey(selectedMemory, scope)}
                    deleting={deletingId === memoryKey(memory, scope)}
                    onSelect={setSelectedMemory}
                    onDelete={handleDelete}
                  />
                ))}
                {groupedItems.projectGroups.map((group) => {
                  const collapsed = collapsedProjects.has(group.key);
                  return (
                    <div key={group.key} className="flex flex-col gap-1.5">
                      <MemoryGroupHeader
                        name={group.name}
                        count={group.items.length}
                        collapsed={collapsed}
                        title={group.key}
                        onClick={() => toggleProjectGroup(group.key)}
                      />
                      {!collapsed && (
                        <div className="ml-2 grid gap-2 border-l border-(--border-default) pl-3">
                          {group.items.map((memory) => (
                            <MemoryCard
                              key={memoryKey(memory, scope)}
                              memory={memory}
                              selected={memoryKey(memory, scope) === memoryKey(selectedMemory, scope)}
                              deleting={
                                deletingId === memoryKey(memory, scope)
                              }
                              onSelect={setSelectedMemory}
                              onDelete={handleDelete}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
          <div className="hidden min-h-0 bg-(--bg-primary) lg:block">
            <MemoryDetailPane memory={selectedMemory} scope={scope} />
          </div>
        </div>
      </ResourceLibraryDialog>

    </>
  );
}
