import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Eye,
  Folder,
  MagnifyingGlass,
  Tray,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
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

function MemoryMetaRow({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="w-20 shrink-0 text-(--text-muted)">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 break-all text-(--text-primary)",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MemoryViewDialog({
  memory,
  scope,
  open,
  onOpenChange,
  onDelete,
  deleting,
}) {
  if (!memory) return null;

  const { title } = memoryDisplayParts(memory);
  const content = String(memory.content || "").trim() || t("noPreview");
  const updatedLabel = formatMemoryTime(memory.updatedAt);
  const confidenceLabel = Number.isFinite(Number(memory.confidence))
    ? `${Math.round(Number(memory.confidence) * 100)}%`
    : "";

  const handleDelete = () => {
    if (deleting) return;
    onDelete(memory);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-1.5 pr-6">
            <span className="truncate">{title}</span>
            <Badge
              variant="outline"
              className="h-4 shrink-0 rounded-md px-1.5 py-0 text-[10px]"
            >
              {memory.kind || "note"}
            </Badge>
            {memory.pinned && (
              <Badge
                variant="secondary"
                className="h-4 shrink-0 rounded-md px-1.5 py-0 text-[10px]"
              >
                {t("pinned")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 pb-4 sm:px-6">
          <pre className="rounded-lg border border-(--border-default) bg-(--bg-subtle) p-3 font-sans text-[13px] leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
            {content}
          </pre>

          <div className="mt-4 grid gap-2 rounded-lg border border-(--border-default) bg-(--bg-primary) p-3">
            <MemoryMetaRow label={t("memoryScope")} value={scopeLabel(scope)} />
            {scope === "project" && memory.projectName ? (
              <MemoryMetaRow
                label={t("projectScope")}
                value={projectDisplayName(memory.projectName)}
              />
            ) : null}
            {memory.lifecycle ? (
              <MemoryMetaRow label="lifecycle" value={memory.lifecycle} />
            ) : null}
            {updatedLabel ? (
              <MemoryMetaRow label={t("memoryUpdatedAt")} value={updatedLabel} />
            ) : null}
            {confidenceLabel ? (
              <MemoryMetaRow
                label={t("memoryConfidence")}
                value={confidenceLabel}
              />
            ) : null}
            {memory.id ? (
              <MemoryMetaRow label="id" value={memory.id} mono />
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-(--border-default) px-4 py-4 sm:px-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            {t("close")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
            size="sm"
          >
            <Trash size={13} />
            {deleting ? t("deleting") : t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function MemoryCard({ memory, deleting, onView, onDelete }) {
  const pinned = !!memory.pinned;
  const { title, preview } = memoryDisplayParts(memory);
  const updatedLabel = formatMemoryTime(memory.updatedAt);

  const handleView = () => onView(memory);

  const handleDeleteClick = () => {
    if (deleting) return;
    onDelete(memory);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        pinned
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background hover:bg-muted/50",
      )}
    >
      {/* Header: title + badges */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={handleView}
          className="cursor-pointer text-left text-sm font-semibold text-foreground hover:underline"
        >
          {title}
        </button>
        <Badge
          variant="outline"
          className="h-4 rounded-md px-1.5 py-0 text-[11px]"
        >
          {memory.kind || "note"}
        </Badge>
        {memory.lifecycle && (
          <Badge
            variant="secondary"
            className="h-4 rounded-md px-1.5 py-0 text-[11px]"
          >
            {memory.lifecycle}
          </Badge>
        )}
        {pinned && (
          <Badge
            variant="secondary"
            className="h-4 rounded-md px-1.5 py-0 text-[11px]"
          >
            {t("pinned")}
          </Badge>
        )}
      </div>

      {/* Body: preview */}
      {preview ? (
        <p className="line-clamp-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {preview}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60">{t("noPreview")}</p>
      )}

      {/* Footer: time + actions */}
      <Separator />
      <div className="flex items-center gap-0.5">
        {updatedLabel && (
          <span className="text-xs text-muted-foreground">{updatedLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleView}
            aria-label={t("view")}
            title={t("view")}
          >
            <Eye size={15} />
          </Button>
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
  const [viewMemory, setViewMemory] = useState(null);
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
      setViewMemory((current) =>
        current?.id === memory.id ? null : current,
      );
      await loadMemories();
    } catch (err) {
      setError(err.message || t("deleteFailed"));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-h-[82vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t("memoryManagement")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 sm:px-6">
          <SettingsSection
            description={t("memoryPanelHint")}
            className="shrink-0 gap-2"
          >
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
          </SettingsSection>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
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
              className="w-full shrink-0 sm:min-w-[240px] sm:w-auto [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
          </div>

          {error && (
            <div className="flex shrink-0 items-start gap-2 rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              <WarningCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-3 [scrollbar-gutter:stable]">
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
                    deleting={deletingId === memoryKey(memory, scope)}
                    onView={setViewMemory}
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
                              deleting={
                                deletingId === memoryKey(memory, scope)
                              }
                              onView={setViewMemory}
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
      </DialogContent>
    </Dialog>

      <MemoryViewDialog
        memory={viewMemory}
        scope={scope}
        open={!!viewMemory}
        onOpenChange={(next) => !next && setViewMemory(null)}
        onDelete={handleDelete}
        deleting={
          viewMemory
            ? deletingId === memoryKey(viewMemory, scope)
            : false
        }
      />
    </>
  );
}
