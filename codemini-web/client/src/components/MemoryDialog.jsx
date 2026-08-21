import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Folder,
  MagnifyingGlass,
  Moon,
  Tray,
  Trash,
  WarningCircle,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { ResourceLibraryDialog } from "@/components/ResourceLibraryDialog.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const SCOPES = ["user", "project", "global"];
const INBOX_SCOPES = ["all", ...SCOPES];

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

function capitalizeLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MEMORY_KIND_LABEL_KEYS = {
  preference: "memoryKindPreference",
  convention: "memoryKindConvention",
  lesson: "memoryKindLesson",
  note: "memoryKindNote",
};

const MEMORY_LIFECYCLE_LABEL_KEYS = {
  observed: "memoryLifecycleObserved",
  operational: "memoryLifecycleOperational",
  longterm: "memoryLifecycleLongterm",
  archived: "memoryLifecycleArchived",
};

function memoryKindLabel(kind) {
  const normalized = String(kind || "note").trim().toLowerCase() || "note";
  const key = MEMORY_KIND_LABEL_KEYS[normalized];
  return key ? t(key) : capitalizeLabel(normalized);
}

function memoryLifecycleLabel(lifecycle) {
  const normalized = String(lifecycle || "").trim().toLowerCase();
  if (!normalized) return "";
  const key = MEMORY_LIFECYCLE_LABEL_KEYS[normalized];
  return key ? t(key) : capitalizeLabel(normalized);
}

function scopeLabel(scope) {
  if (scope === "all") return t("allScopes");
  if (scope === "project") return t("projectScope");
  if (scope === "global") return t("globalScope");
  return t("userScope");
}

function memoryKey(memory, scope) {
  return `${memory?.projectDir || scope}:${memory?.id || ""}`;
}

function itemTimestamp(item, inbox) {
  return inbox ? item?.timestamp : item?.updatedAt;
}

function itemKind(item, inbox) {
  return inbox ? item?.type : item?.kind;
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
            {memoryKindLabel(memory.kind || "note")}
          </Badge>
          {memory.pinned ? (
            <Badge variant="secondary" className="h-6 rounded-md px-2 text-[11px]">
              {t("pinned")}
            </Badge>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-(--text-muted)">
          <span>{scopeLabel(scope)}</span>
          {memory.lifecycle ? <span>{memoryLifecycleLabel(memory.lifecycle)}</span> : null}
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

function InboxDetailPane({ entry }) {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-(--text-muted)">
        {t("noInboxEntries")}
      </div>
    );
  }

  const { title } = memoryDisplayParts({
    summary: entry.summary,
    content: entry.details,
  });
  const details = String(entry.details || entry.summary || "").trim() || t("noPreview");
  const capturedLabel = formatMemoryTime(entry.timestamp);
  const confidence = Number(entry.evidence?.confidence);
  const confidenceLabel = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : "";
  const durableScore = Number(entry.evidence?.durableScore);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-(--border-default) px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-[17px] font-semibold leading-6 text-(--text-primary)">
            {title}
          </h3>
          <Badge variant="outline" className="h-6 rounded-md px-2 text-[11px]">
            {memoryKindLabel(entry.type || "note")}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-(--text-muted)">
          <span>{scopeLabel(entry.scope)}</span>
          {entry.source ? <span>{t("inboxSource")}: {entry.source}</span> : null}
          {capturedLabel ? <span>{capturedLabel}</span> : null}
          {confidenceLabel ? <span>{confidenceLabel}</span> : null}
          {Number.isFinite(durableScore) ? (
            <span>{t("inboxDurableScore")}: {durableScore}/10</span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-5">
        <div className="flex flex-col gap-5 text-[13px] leading-6 text-(--text-primary)">
          <pre className="whitespace-pre-wrap break-words font-sans">{details}</pre>
          {entry.suggestedAction ? (
            <section className="flex flex-col gap-1">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
                {t("inboxSuggestedAction")}
              </h4>
              <p>{entry.suggestedAction}</p>
            </section>
          ) : null}
          {entry.evidence?.reason ? (
            <section className="flex flex-col gap-1">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
                {t("inboxEvidence")}
              </h4>
              <p>{entry.evidence.reason}</p>
            </section>
          ) : null}
          {Array.isArray(entry.tags) && entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          ) : null}
        </div>
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

function MemoryCard({ memory, inbox = false, selected, deleting, onSelect, onDelete }) {
  const pinned = !!memory.pinned;
  const { title, preview } = memoryDisplayParts(
    inbox ? { summary: memory.summary, content: memory.details } : memory,
  );
  const updatedLabel = formatMemoryTime(itemTimestamp(memory, inbox));

  const handleDeleteClick = () => {
    if (deleting) return;
    onDelete(memory);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow]",
        selected
          ? "border-(--selected-edge) bg-(--selected-bg)"
          : pinned
            ? "border-transparent bg-primary/5"
            : "border-transparent bg-transparent hover:bg-(--bg-hover)",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(memory)}
        className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md text-left outline-none focus-visible:shadow-[0_0_0_3px_var(--control-focus-ring)]"
      >
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-foreground">
            {title}
          </span>
          <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[11px]">
            {memoryKindLabel(itemKind(memory, inbox) || "note")}
          </Badge>
          {memory.lifecycle ? (
            <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[11px]">
              {memoryLifecycleLabel(memory.lifecycle)}
            </Badge>
          ) : null}
          {pinned ? (
            <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[11px]">
              {t("pinned")}
            </Badge>
          ) : null}
          {preview ? (
            <span className="basis-full line-clamp-2 text-[12px] font-normal leading-5 text-(--text-muted)">
              {preview}
            </span>
          ) : null}
      </button>

      {/* Footer: time + actions */}
      <Separator />
      <div className="flex items-center gap-0.5">
        {updatedLabel && (
          <span className="text-[11px] leading-4 text-muted-foreground">{updatedLabel}</span>
        )}
        <div
          className="ml-auto flex items-center gap-0.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={deleting}
            className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
            onClick={handleDeleteClick}
            aria-label={inbox ? t("discard") : t("delete")}
            title={inbox ? t("discard") : t("delete")}
          >
            <Trash size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MemoryDialog({ open, onOpenChange, projectDirs = [] }) {
  const [view, setView] = useState("memory");
  const [memoryScope, setMemoryScope] = useState("user");
  const [inboxScope, setInboxScope] = useState("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());

  const inbox = view === "inbox";
  const scope = inbox ? inboxScope : memoryScope;
  const setScope = inbox ? setInboxScope : setMemoryScope;
  const scopeOptions = inbox ? INBOX_SCOPES : SCOPES;
  const trimmedQuery = query.trim();
  const projectKey = projectDirsKey(projectDirs);
  const requestProjectDirs = useMemo(
    () => (projectKey ? projectKey.split("\n") : []),
    [projectKey],
  );

  const refreshInboxCount = useCallback(async () => {
    try {
      const result = await api.fetchInbox({
        scope: "all",
        projectDirs: requestProjectDirs,
      });
      if (!result?.error) setInboxCount(Array.isArray(result.items) ? result.items.length : 0);
    } catch {
      // The main list surfaces actionable errors; the count is best effort.
    }
  }, [requestProjectDirs]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = inbox
        ? await api.fetchInbox({
            scope,
            query: trimmedQuery,
            projectDirs: requestProjectDirs,
          })
        : await api.fetchMemories({
            scope,
            query: trimmedQuery,
            projectDirs: requestProjectDirs,
          });
      if (result?.error) throw new Error(result.message || t("memoryLoadFailed"));
      const nextItems = Array.isArray(result.items) ? result.items : [];
      setItems(nextItems);
      if (inbox && scope === "all" && !trimmedQuery) setInboxCount(nextItems.length);
    } catch (err) {
      setItems([]);
      setError(err.message || t("memoryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [inbox, scope, trimmedQuery, requestProjectDirs]);

  useEffect(() => {
    if (!open) return;
    loadEntries();
  }, [open, loadEntries]);

  useEffect(() => {
    if (!open) return;
    refreshInboxCount();
  }, [open, refreshInboxCount]);

  const kindCounts = useMemo(() => {
    const counts = items.reduce((acc, item) => {
      const kind = itemKind(item, inbox) || "note";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [items, inbox]);

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
      setSelectedItem(null);
      return;
    }
    if (!selectedItem || !items.some((item) => memoryKey(item, scope) === memoryKey(selectedItem, scope))) {
      setSelectedItem(items[0]);
    }
  }, [items, scope, selectedItem]);

  const toggleProjectGroup = useCallback((key) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleViewChange = (nextView) => {
    setView(nextView);
    setQuery("");
    setItems([]);
    setSelectedItem(null);
    setError("");
    setNotice("");
  };

  const handleDelete = (item) => {
    if (!item?.id) return;
    setPendingDelete(item);
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item?.id || deletingId) return;
    setDeletingId(memoryKey(item, scope));
    setError("");
    try {
      const result = inbox
        ? await api.discardInboxEntry(item.id)
        : await api.forgetMemory(scope, item.id, item.projectDir);
      if (result?.error) {
        throw new Error(result.message || t(inbox ? "discardFailed" : "deleteFailed"));
      }
      setPendingDelete(null);
      await loadEntries();
      if (inbox && scope !== "all") await refreshInboxCount();
    } catch (err) {
      setError(err.message || t(inbox ? "discardFailed" : "deleteFailed"));
    } finally {
      setDeletingId("");
    }
  };

  const handleDream = async () => {
    if (organizing) return;
    setOrganizing(true);
    setError("");
    setNotice("");
    try {
      const result = await api.runInboxDream(scope);
      if (result?.error) throw new Error(result.message || t("inboxDreamFailed"));
      const promotions = Array.isArray(result.promotions) ? result.promotions.length : 0;
      const archives = (Array.isArray(result.archives) ? result.archives.length : 0)
        + (Array.isArray(result.rejections) ? result.rejections.length : 0);
      setNotice(
        t("inboxDreamComplete")
          .replace("{{promotions}}", String(promotions))
          .replace("{{archives}}", String(archives)),
      );
      await loadEntries();
      await refreshInboxCount();
    } catch (err) {
      setError(err.message || t("inboxDreamFailed"));
    } finally {
      setOrganizing(false);
    }
  };

  const renderCard = (item) => (
    <MemoryCard
      key={memoryKey(item, scope)}
      memory={item}
      inbox={inbox}
      selected={memoryKey(item, scope) === memoryKey(selectedItem, scope)}
      deleting={deletingId === memoryKey(item, scope)}
      onSelect={setSelectedItem}
      onDelete={handleDelete}
    />
  );

  return (
    <>
      <ResourceLibraryDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("memoryManagement")}
        description={t("memoryPanelHint")}
      >
        <Tabs value={view} onValueChange={handleViewChange} className="h-full min-h-0 gap-0">
          <div className="flex shrink-0 items-center border-b border-(--border-default) px-3 py-2">
            <TabsList variant="line" className="h-8">
              <TabsTrigger value="memory">{t("memoryTab")}</TabsTrigger>
              <TabsTrigger value="inbox">
                {t("memoryInboxTab")}
                {inboxCount > 0 ? <Badge variant="secondary">{inboxCount}</Badge> : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={view} className="min-h-0 flex-1">
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col gap-3 border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {items.length > 0 ? (
                    <>
                      <span className="text-[12px] text-(--text-muted)">
                        {items.length} {t("items")}
                      </span>
                      {kindCounts.map(([kind, count]) => (
                        <Badge key={kind} variant="outline" className="h-4 rounded-md px-1.5 py-0 text-[10px]">
                          {memoryKindLabel(kind)} {count}
                        </Badge>
                      ))}
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {inbox ? (
                    <Button
                      variant="outline"
                      onClick={handleDream}
                      disabled={organizing || loading || inboxCount === 0}
                    >
                      <Moon data-icon="inline-start" />
                      {t(organizing ? "organizingInbox" : "organizeInbox")}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={loadEntries}
                    disabled={loading}
                    size="icon-sm"
                    title={t("refresh")}
                    aria-label={t("refresh")}
                  >
                    <ArrowClockwise className={cn(loading && "animate-spin")} />
                  </Button>
                </div>
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
                    placeholder={t(inbox ? "searchInbox" : "searchMemories")}
                    className="h-9 pl-8 text-[13px]"
                  />
                </div>
                <SettingsSegmentedControl
                  idPrefix={`${view}-scope`}
                  value={scope}
                  onValueChange={setScope}
                  options={scopeOptions.map((item) => ({ value: item, label: scopeLabel(item) }))}
                  className="w-full shrink-0 [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
                />
              </div>

              {error ? (
                <Alert variant="destructive">
                  <WarningCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {notice ? (
                <Alert aria-live="polite">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}

              <div className="min-h-[220px] flex-1 overflow-y-auto scroll-smooth pr-2 [scrollbar-gutter:stable]">
                {loading ? (
                  <div className="grid gap-2">
                    <MemoryCardSkeleton />
                    <MemoryCardSkeleton />
                    <MemoryCardSkeleton />
                  </div>
                ) : items.length === 0 ? (
                  <Empty className="rounded-lg py-10">
                    <Tray size={28} className="mb-2 text-(--text-muted)" aria-hidden />
                    <EmptyDescription className="text-[13px] text-(--text-primary)">
                      {trimmedQuery ? t("noMatches") : t(inbox ? "noInboxEntries" : "noMemories")}
                    </EmptyDescription>
                    <EmptyDescription className="text-[11px] text-(--text-muted)">
                      {t(inbox ? "noInboxEntriesHint" : "noMemoriesHint")}
                    </EmptyDescription>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-3">
                    {groupedItems.regular.map(renderCard)}
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
                          {!collapsed ? (
                            <div className="ml-2 grid gap-2 border-l border-(--border-default) pl-3">
                              {group.items.map(renderCard)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="hidden min-h-0 bg-(--bg-primary) lg:block">
              {inbox ? (
                <InboxDetailPane entry={selectedItem} />
              ) : (
                <MemoryDetailPane memory={selectedItem} scope={scope} />
              )}
            </div>
          </div>
          </TabsContent>
        </Tabs>
      </ResourceLibraryDialog>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t(inbox ? "discardInboxEntry" : "deleteMemoryConfirm")}
        description={
          pendingDelete
            ? t(inbox ? "discardInboxDescription" : "deleteMemoryDescription").replace(
                "{{summary}}",
                pendingDelete.summary || pendingDelete.id || "",
              )
            : ""
        }
        loading={Boolean(deletingId)}
        onOpenChange={(next) => {
          if (!next && !deletingId) setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}
