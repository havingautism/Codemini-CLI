import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Folder,
  MagnifyingGlass,
  Trash,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
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

function MemoryGroupHeader({ name, count, collapsed, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12px] font-medium text-(--text-primary) hover:bg-(--bg-hover)"
      title={title}
    >
      <Folder size={14} className="shrink-0 text-(--text-muted)" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-[12px] font-medium text-[var(--input-shell-accent)]">
        {count}
      </span>
      {collapsed ? (
        <CaretRight size={13} className="shrink-0 text-(--text-muted)" />
      ) : (
        <CaretDown size={13} className="shrink-0 text-(--text-muted)" />
      )}
    </button>
  );
}

function MemoryCard({ memory, deleting, onDelete }) {
  const pinned = !!memory.pinned;
  return (
    <div
      className={cn(
        "relative rounded-lg border p-2.5 transition-colors hover:bg-(--bg-hover)",
        pinned
          ? "border-[color-mix(in_srgb,var(--input-shell-accent)_40%,transparent)] bg-[var(--input-shell-glow-soft)]"
          : "border-(--border-default) bg-(--bg-primary)",
      )}
    >
      {pinned && (
        <span
          className="absolute bottom-2.5 left-0 top-2.5 w-0.5 rounded-full bg-[var(--input-shell-accent)]"
          aria-hidden
        />
      )}
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-(--text-primary)">
              {memory.summary || memory.content || t("memory")}
            </span>
            <Badge
              variant="outline"
              className="h-4 rounded-md px-1.5 py-0 text-[10px] uppercase"
            >
              {memory.kind || "note"}
            </Badge>
            {memory.lifecycle && (
              <Badge
                variant="secondary"
                className="h-4 rounded-md px-1.5 py-0 text-[10px] uppercase"
              >
                {memory.lifecycle}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-(--text-secondary)">
            {memory.content || t("noPreview")}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-(--text-muted)">
            <span className="font-mono">{memory.id}</span>
            {memory.updatedAt && (
              <span>{formatMemoryTime(memory.updatedAt)}</span>
            )}
            {Number.isFinite(Number(memory.confidence)) && (
              <span>{Math.round(Number(memory.confidence) * 100)}%</span>
            )}
            {pinned && <span>{t("pinned")}</span>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onDelete(memory)}
          disabled={deleting}
          title={t("delete")}
          className="shrink-0 text-(--accent-red) hover:text-(--accent-red)"
        >
          <Trash size={13} />
        </Button>
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

  const kindSummary = useMemo(() => {
    const counts = items.reduce((acc, item) => {
      const kind = item.kind || "note";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(" · ");
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
      await loadMemories();
    } catch (err) {
      setError(err.message || t("deleteFailed"));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t("memoryManagement")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4 sm:px-6">
          <SettingsSection
            title={t("memoryLibrary")}
            description={t("memoryPanelHint")}
            className="shrink-0 gap-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {items.length > 0 && (
                <p className="text-[12px] text-(--text-muted)">
                  {items.length} {t("items")}
                  {kindSummary ? ` · ${kindSummary}` : ""}
                </p>
              )}
              <Button
                variant="outline"
                onClick={loadMemories}
                disabled={loading}
                size="sm"
                className="w-full sm:ml-auto sm:w-auto"
              >
                <ArrowClockwise
                  size={13}
                  className={cn(loading && "animate-spin")}
                />
                {t("refresh")}
              </Button>
            </div>
          </SettingsSection>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
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
          </div>

          {error && (
            <div className="shrink-0 rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-3 [scrollbar-gutter:stable]">
            {loading ? (
              <div className="py-8 text-center text-[12px] text-(--text-muted)">
                {t("loading")}...
              </div>
            ) : items.length === 0 ? (
              <Empty className="rounded-lg py-8">
                <EmptyDescription className="text-[13px] text-(--text-primary)">
                  {trimmedQuery ? t("noMatches") : t("noMemories")}
                </EmptyDescription>
                <EmptyDescription className="text-[11px]">
                  {t("noMemoriesHint")}
                </EmptyDescription>
              </Empty>
            ) : (
              <div className="grid gap-2">
                {groupedItems.regular.map((memory) => (
                  <MemoryCard
                    key={memoryKey(memory, scope)}
                    memory={memory}
                    deleting={deletingId === memoryKey(memory, scope)}
                    onDelete={handleDelete}
                  />
                ))}
                {groupedItems.projectGroups.map((group) => {
                  const collapsed = collapsedProjects.has(group.key);
                  return (
                    <div key={group.key} className="grid gap-1">
                      <MemoryGroupHeader
                        name={group.name}
                        count={group.items.length}
                        collapsed={collapsed}
                        title={group.key}
                        onClick={() => toggleProjectGroup(group.key)}
                      />
                      {!collapsed && (
                        <div className="grid gap-2 pl-6">
                          {group.items.map((memory) => (
                            <MemoryCard
                              key={memoryKey(memory, scope)}
                              memory={memory}
                              deleting={
                                deletingId === memoryKey(memory, scope)
                              }
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
  );
}
