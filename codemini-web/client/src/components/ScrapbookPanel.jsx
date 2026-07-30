import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOut,
  CaretDown,
  CircleNotch,
  DotsThreeVertical,
  GridFour,
  Globe,
  ListBullets,
  MagnifyingGlass,
  Notebook,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { t } from "../../i18n/index.js";
import {
  createManualScrapbookEntry,
  createUrlScrapbookEntry,
  deleteScrapbookEntry,
  fetchScrapbookEntries,
  fetchScrapbookEntry,
  fetchScrapbookSummaryJob,
  openScrapbookSummaryJobStream,
  summarizeScrapbookEntry,
} from "@/hooks/use-api.js";
import { useApp } from "@/context/app-context.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.jsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.jsx";

const NOTEBOOK_TONES = [
  "#c7829a",
  "#c8a74e",
  "#6e9fba",
  "#8c82c4",
  "#56a38f",
  "#b97863",
];

function entryTitle(entry) {
  return entry?.title || entry?.sourceUrl || t("scrapbookUntitled");
}

function entryPreview(entry) {
  return (
    entry?.summary ||
    entry?.contentText ||
    entry?.sourceUrl ||
    t("scrapbookNoContent")
  );
}

function splitEmojiTitle(value) {
  const fullTitle = String(value || "").trim();
  if (!fullTitle) return { emoji: "", title: "" };

  const firstGrapheme =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(fullTitle)][0]
          ?.segment || ""
      : Array.from(fullTitle)[0] || "";
  const isEmoji =
    /\p{Extended_Pictographic}/u.test(firstGrapheme) ||
    /\p{Regional_Indicator}/u.test(firstGrapheme);

  if (!isEmoji) return { emoji: "", title: fullTitle };
  return {
    emoji: firstGrapheme,
    title: fullTitle.slice(firstGrapheme.length).trimStart() || fullTitle,
  };
}

function sourceHostname(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function scrapbookSourceLabel(entry) {
  if (entry?.sourceType === "chat_answer") return t("scrapbookChatAnswer");
  if (entry?.sourceType === "url") {
    return sourceHostname(entry.sourceUrl) || t("scrapbookWebSource");
  }
  return t("scrapbookManualEntry");
}

function notebookTone(toneIndex) {
  return NOTEBOOK_TONES[Math.abs(Number(toneIndex) || 0) % NOTEBOOK_TONES.length];
}

function formatEntryDate(entry) {
  const raw = entry?.updatedAt || entry?.createdAt;
  if (!raw) return t("scrapbookRecentlyUpdated");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return t("scrapbookRecentlyUpdated");
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function ScrapbookSummaryLoading() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.045] px-5 py-6"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/55 to-transparent" />
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <CircleNotch size={23} weight="bold" className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-(--text-primary)">
            {t("scrapbookPreparingSummary")}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-(--text-muted)">
            {t("scrapbookPreparingDescription")}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-(--bg-hover)">
            <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/70" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              t("scrapbookLoadingSource"),
              t("scrapbookLoadingTitle"),
              t("scrapbookLoadingSummary"),
            ].map((label, index) => (
              <div
                key={label}
                className="flex items-center gap-2 text-[11px] text-(--text-muted)"
              >
                <span
                  className={`size-1.5 rounded-full ${
                    index === 0 ? "bg-primary animate-pulse" : "bg-(--border-strong)"
                  }`}
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScrapbookLibraryCard({
  entry,
  toneIndex,
  viewMode,
  menuOpen,
  onOpen,
  onMenuOpenChange,
  onOpenOrigin,
  onDelete,
}) {
  const isList = viewMode === "list";
  const SourceIcon = entry.sourceType === "url" ? Globe : Notebook;
  const sourceLabel = scrapbookSourceLabel(entry);
  const canJumpToMessage = entry.sourceType === "chat_answer" && entry.sourceSessionId && entry.sourceMessageId;
  const canOpenSource = entry.sourceType === "url" && entry.sourceUrl;
  const titleParts = splitEmojiTitle(entryTitle(entry));

  return (
    <article
      className={`group relative isolate overflow-visible rounded-2xl border border-white/4 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition duration-200 hover:-translate-y-0.5 hover:border-white/10 hover:shadow-[0_14px_36px_rgba(0,0,0,0.14)] ${
        isList ? "min-h-24" : "min-h-52"
      }`}
      style={{
        "--notebook-tint": notebookTone(toneIndex),
        backgroundColor:
          "color-mix(in srgb, var(--notebook-tint) 22%, var(--bg-secondary))",
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label={`${t("scrapbookOpenNotebook")}: ${entryTitle(entry)}`}
      />

      <div
        className={`pointer-events-none relative z-[1] flex h-full ${
          isList
            ? "items-center gap-4 px-5 py-4 pr-14"
            : "min-h-52 flex-col px-5 pb-5 pt-5"
        }`}
      >
        {titleParts.emoji ? (
          <span
            className={`flex shrink-0 items-center justify-center ${
              isList ? "size-11 text-[30px]" : "size-14 text-[42px]"
            }`}
            aria-hidden="true"
          >
            {titleParts.emoji}
          </span>
        ) : (
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: "var(--notebook-tint)",
              backgroundColor:
                "color-mix(in srgb, var(--notebook-tint) 20%, transparent)",
            }}
          >
            <SourceIcon size={25} weight="duotone" aria-hidden="true" />
          </span>
        )}
        <div className={isList ? "min-w-0 flex-1" : "mt-auto min-w-0"}>
          <h3
            className={`line-clamp-2 break-words font-medium tracking-[-0.015em] text-(--text-primary) ${
              isList ? "text-[15px] leading-5" : "text-[18px] leading-6"
            }`}
          >
            {titleParts.title}
          </h3>
          {isList ? (
            <p className="mt-1 line-clamp-1 text-[12px] text-(--text-secondary)">
              {entryPreview(entry)}
            </p>
          ) : null}
          <div className="mt-3 flex min-w-0 items-center gap-1.5 text-[11px] text-(--text-muted)">
            <span className="shrink-0">{formatEntryDate(entry)}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{sourceLabel}</span>
          </div>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-10">
        <Popover
          open={menuOpen}
          onOpenChange={(open) => onMenuOpenChange(open ? entry.id : "")}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="flex size-8 items-center justify-center rounded-full text-(--text-secondary) transition hover:bg-black/10 hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-label={t("scrapbookNotebookActions")}
            >
              <DotsThreeVertical size={18} weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={4} className="w-40 p-1">
            {canOpenSource ? (
              <button
                type="button"
                onClick={() => onOpenOrigin(entry)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              >
                <ArrowSquareOut size={14} />
                {t("scrapbookOpenSource")}
              </button>
            ) : null}
            {canJumpToMessage ? (
              <button
                type="button"
                onClick={() => onOpenOrigin(entry)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              >
                <ArrowSquareOut size={14} />
                {t("scrapbookJumpToMessage")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDelete(entry)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-accent-red hover:bg-(--accent-red-bg)"
            >
              <Trash size={14} />
              {t("scrapbookDelete")}
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </article>
  );
}

export function ScrapbookPanel() {
  const { state, actions } = useApp();
  const [entries, setEntries] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState("url");
  const [activeFilter, setActiveFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [sortMode, setSortMode] = useState("recent");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuEntryId, setMenuEntryId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [form, setForm] = useState({
    url: "",
    title: "",
    content: "",
    sourceUrl: "",
  });
  const scrapbookEntryId = String(state?.scrapbookEntryId || "").trim();

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchScrapbookEntries(query);
      const list = Array.isArray(result?.entries) ? result.entries : [];
      setEntries(list);
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadSelectedEntry = useCallback(async (entryId) => {
    if (!entryId) {
      setSelectedEntry(null);
      return;
    }
    const result = await fetchScrapbookEntry(entryId);
    setSelectedEntry(result?.entry || null);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (scrapbookEntryId) {
      loadSelectedEntry(scrapbookEntryId);
      setContentExpanded(false);
      return;
    }
    setSelectedEntry(null);
    setContentExpanded(false);
  }, [loadSelectedEntry, scrapbookEntryId]);

  useEffect(() => {
    const jobId = selectedEntry?.latestJob?.id;
    const status = selectedEntry?.latestJob?.status;
    if (!jobId || !["pending", "running"].includes(status)) return undefined;
    const source = openScrapbookSummaryJobStream(jobId);
    source.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        if (payload?.type === "delta") {
          setSelectedEntry((current) =>
            current?.id === selectedEntry.id
              ? {
                  ...current,
                  latestJob: {
                    ...(current.latestJob || {}),
                    id: jobId,
                    status: "running",
                    partialText: payload.partialText || "",
                  },
                }
              : current,
          );
          return;
        }
        if (payload?.job) {
          setSelectedEntry((current) =>
            current?.id === selectedEntry.id ? { ...current, latestJob: payload.job } : current,
          );
          if (["completed", "failed"].includes(payload.job.status)) {
            const latest = await fetchScrapbookSummaryJob(jobId);
            await loadSelectedEntry(selectedEntry.id);
            setSelectedEntry((current) => {
              if (current?.id !== selectedEntry.id) return current;
              return {
                ...(current || {}),
                summary: latest?.job?.resultSummary || current.summary || "",
                latestJob: latest?.job || payload.job,
              };
            });
            source.close();
            await loadEntries();
          }
        }
      } catch {}
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [loadEntries, loadSelectedEntry, selectedEntry]);

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const result =
        composerMode === "url"
          ? await createUrlScrapbookEntry({
              sourceUrl: form.url,
            })
          : await createManualScrapbookEntry({
              title: form.title,
              contentText: form.content,
              sourceUrl: form.sourceUrl,
            });
      const entry = result?.entry || result;
      if (!entry?.id) {
        throw new Error(result?.message || t("scrapbookSaveFailed"));
      }
      const started = await summarizeScrapbookEntry(entry.id);
      if (started?.job) {
        setSelectedEntry((current) =>
          current?.id === entry.id ? { ...current, latestJob: started.job } : current,
        );
      }
      await loadEntries();
      setComposerOpen(false);
      actions.openScrapbookEntry(entry.id);
      setForm({ url: "", title: "", content: "", sourceUrl: "" });
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (entry) => {
    if (!entry?.id) return;
    setDeleteTarget(entry);
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      await deleteScrapbookEntry(deleteTarget.id);
      if (scrapbookEntryId === deleteTarget.id) {
        setSelectedEntry(null);
        actions.openScrapbookHome();
      }
      await loadEntries();
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleSummarize = async () => {
    if (!selectedEntry) return;
    const started = await summarizeScrapbookEntry(selectedEntry.id);
    if (started?.job) {
      setSelectedEntry((current) =>
        current?.id === selectedEntry.id ? { ...current, latestJob: started.job } : current,
      );
    }
    await loadEntries();
  };

  const handleAsk = async () => {
    if (!selectedEntry) return;
    setAsking(true);
    setError("");
    try {
      const result = await actions.askScrapbookEntry(selectedEntry.id);
      if (result?.error) throw new Error(result.message || "Failed to ask about scrapbook entry");
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookAskFailed")));
    } finally {
      setAsking(false);
    }
  };

  const isUrlMode = composerMode === "url";
  const isDetailView = !!scrapbookEntryId;
  const summaryJob = selectedEntry?.latestJob || null;
  const summaryBusy = summaryJob && ["pending", "running"].includes(summaryJob.status);
  const summaryPartialText = String(summaryJob?.partialText || "").trim();
  const summaryText =
    (summaryBusy ? summaryPartialText : "") ||
    selectedEntry?.summary ||
    summaryJob?.resultSummary ||
    t("scrapbookNoSummary");
  const visibleEntries = useMemo(() => {
    const filtered =
      activeFilter === "all"
        ? entries
        : entries.filter((entry) => entry.sourceType === activeFilter);
    return [...filtered].sort((left, right) => {
      if (sortMode === "title") {
        return entryTitle(left).localeCompare(entryTitle(right));
      }
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
  }, [activeFilter, entries, sortMode]);
  const listEmpty = !loading && visibleEntries.length === 0;
  const filteredCountLabel = `${visibleEntries.length} ${t("scrapbookItems")}`;

  const createDisabled =
    saving || (isUrlMode ? !form.url.trim() : !form.content.trim());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg-primary)">
      <div className="mx-auto w-full max-w-[1540px] px-4 pb-12 pt-5 sm:px-7 lg:px-10 lg:pt-8">
          <header className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <nav
                aria-label={t("scrapbookFilters")}
                className="flex min-w-0 items-center gap-1 overflow-x-auto"
              >
                {[
                  ["all", t("scrapbookFilterAll")],
                  ["manual", t("scrapbookFilterNotes")],
                  ["url", t("scrapbookFilterWeb")],
                ].map(([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                    className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-medium transition ${
                      activeFilter === filter
                        ? "bg-primary/16 text-(--text-primary)"
                        : "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                    }`}
                    aria-current={activeFilter === filter ? "page" : undefined}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={`flex h-10 items-center overflow-hidden rounded-full border border-(--border-default) bg-(--bg-primary) transition-[width,border-color] ${
                    searchOpen || query ? "w-full sm:w-56" : "w-10"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSearchOpen((current) => !current)}
                    className="flex size-10 shrink-0 items-center justify-center text-(--text-secondary) hover:text-(--text-primary)"
                    aria-label={t("scrapbookSearchPlaceholder")}
                    aria-expanded={searchOpen || !!query}
                  >
                    <MagnifyingGlass size={17} weight="bold" />
                  </button>
                  {searchOpen || query ? (
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("scrapbookSearchPlaceholder")}
                      className="min-w-0 flex-1 bg-transparent pr-3 text-[12px] text-(--text-primary) outline-none placeholder:text-(--text-muted)"
                      autoFocus
                    />
                  ) : null}
                </div>

                <div className="inline-flex h-10 overflow-hidden rounded-full border border-(--border-default)">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`flex w-10 items-center justify-center transition ${
                      viewMode === "grid"
                        ? "bg-primary/16 text-primary"
                        : "text-(--text-secondary) hover:bg-(--bg-hover)"
                    }`}
                    aria-label={t("scrapbookGridView")}
                    aria-pressed={viewMode === "grid"}
                  >
                    <GridFour size={17} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`flex w-10 items-center justify-center border-l border-(--border-default) transition ${
                      viewMode === "list"
                        ? "bg-primary/16 text-primary"
                        : "text-(--text-secondary) hover:bg-(--bg-hover)"
                    }`}
                    aria-label={t("scrapbookListView")}
                    aria-pressed={viewMode === "list"}
                  >
                    <ListBullets size={17} weight="bold" />
                  </button>
                </div>

                <label className="relative">
                  <span className="sr-only">{t("scrapbookSortLabel")}</span>
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value)}
                    className="h-10 appearance-none rounded-full border border-(--border-default) bg-(--bg-primary) pl-4 pr-9 text-[12px] font-medium text-(--text-secondary) outline-none hover:bg-(--bg-hover)"
                  >
                    <option value="recent">{t("scrapbookSortRecent")}</option>
                    <option value="title">{t("scrapbookSortTitle")}</option>
                  </select>
                  <CaretDown
                    size={12}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setComposerOpen(true);
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) shadow-sm transition hover:opacity-90"
                >
                  <Plus size={15} weight="bold" />
                  {t("scrapbookNewNotebook")}
                </button>
              </div>
            </div>
          </header>

          <section className="mt-9">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-[24px] font-medium tracking-[-0.025em] text-(--text-primary)">
                  {t("scrapbookLibraryTitle")}
                </h1>
                <p className="mt-1.5 text-[12px] text-(--text-muted)">
                  {filteredCountLabel}
                </p>
              </div>
              {loading ? (
                <span className="text-[12px] text-(--text-muted)">
                  {t("scrapbookLoading")}
                </span>
              ) : null}
            </div>

            {error && !composerOpen ? (
              <div className="mt-5 rounded-xl bg-(--accent-red-bg) px-4 py-3 text-[12px] text-accent-red">
                {error}
              </div>
            ) : null}

            {listEmpty ? (
              <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-(--border-default) px-6 text-center">
                <Notebook size={32} weight="duotone" className="text-(--text-muted)" />
                <div className="mt-3 text-[13px] font-medium text-(--text-secondary)">
                  {query ? t("scrapbookNoResults") : t("scrapbookEmpty")}
                </div>
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-(--text-primary) px-4 py-2 text-[12px] font-semibold text-(--bg-primary)"
                >
                  <Plus size={14} />
                  {t("scrapbookNewNotebook")}
                </button>
              </div>
            ) : (
              <div
                className={`mt-6 ${
                  viewMode === "grid"
                    ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
                    : "flex flex-col gap-3"
                }`}
              >
                {viewMode === "grid" ? (
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className="group flex min-h-52 flex-col items-center justify-center rounded-2xl border border-(--border-default) bg-transparent text-(--text-secondary) transition hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="flex size-14 items-center justify-center rounded-full bg-primary/14 text-primary transition group-hover:scale-105">
                      <Plus size={23} weight="bold" />
                    </span>
                    <span className="mt-4 text-[14px] font-medium">
                      {t("scrapbookNewNotebook")}
                    </span>
                  </button>
                ) : null}
                {visibleEntries.map((entry, index) => (
                  <ScrapbookLibraryCard
                    key={entry.id}
                    entry={entry}
                    toneIndex={index}
                    viewMode={viewMode}
                    menuOpen={menuEntryId === entry.id}
                    onOpen={actions.openScrapbookEntry}
                    onMenuOpenChange={setMenuEntryId}
                    onOpenOrigin={(target) => {
                      setMenuEntryId("");
                      if (target?.sourceType === "chat_answer") {
                        void actions.openChatMessage(target.sourceSessionId, target.sourceMessageId);
                        return;
                      }
                      if (target?.sourceUrl) {
                        window.open(target.sourceUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    onDelete={(target) => {
                      setMenuEntryId("");
                      requestDelete(target);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
      </div>

      <Dialog
        open={isDetailView}
        onOpenChange={(open) => {
          if (!open) actions.openScrapbookHome();
        }}
      >
        <DialogContent className="grid h-[calc(100dvh-1rem)] max-h-[860px] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(86vh,860px)] sm:max-w-[780px]">
          <DialogHeader className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-2 text-[20px] leading-7">
              {selectedEntry
                ? entryTitle(selectedEntry)
                : t("scrapbookLoading")}
            </DialogTitle>
            {selectedEntry ? (
              <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span>{scrapbookSourceLabel(selectedEntry)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatEntryDate(selectedEntry)}</span>
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
            <button
              type="button"
              onClick={handleAsk}
              disabled={!selectedEntry || asking}
              className="inline-flex items-center gap-2 rounded-lg bg-(--text-primary) px-3 py-2 text-[12px] font-medium text-(--bg-primary) hover:opacity-90 disabled:opacity-50"
            >
              <Sparkle size={14} />
              {asking ? t("scrapbookAsking") : t("scrapbookAsk")}
            </button>
            <button
              type="button"
              onClick={handleSummarize}
              disabled={!selectedEntry || summaryBusy}
              className="rounded-lg border border-(--control-border) px-3 py-2 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-50"
            >
              {summaryBusy
                ? t("scrapbookSummarizing")
                : selectedEntry?.summary
                  ? t("scrapbookResummarize")
                  : t("scrapbookSummarize")}
            </button>
            <button
              type="button"
              onClick={() => requestDelete(selectedEntry)}
              disabled={!selectedEntry}
              className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-accent-red hover:bg-(--accent-red-bg) disabled:opacity-50"
            >
              <Trash size={14} />
              {t("scrapbookDelete")}
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
            {!selectedEntry ? (
              <div className="flex min-h-56 items-center justify-center text-[12px] text-(--text-muted)">
                <CircleNotch size={18} className="mr-2 animate-spin" />
                {t("scrapbookLoading")}
              </div>
            ) : (
              <div className="grid gap-4">
                {selectedEntry.sourceType === "url" &&
                selectedEntry.sourceUrl ? (
                  <a
                    href={selectedEntry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-2 rounded-xl bg-(--bg-secondary) px-4 py-3 text-[12px] text-(--text-muted) hover:text-(--text-primary)"
                  >
                    <Globe size={14} className="shrink-0" />
                    <span className="truncate">{selectedEntry.sourceUrl}</span>
                    <ArrowSquareOut size={13} className="ml-auto shrink-0" />
                  </a>
                ) : null}
                {selectedEntry.sourceType === "chat_answer" &&
                selectedEntry.sourceSessionId &&
                selectedEntry.sourceMessageId ? (
                  <button
                    type="button"
                    onClick={() =>
                      actions.openChatMessage(
                        selectedEntry.sourceSessionId,
                        selectedEntry.sourceMessageId,
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-xl bg-(--bg-secondary) px-4 py-3 text-left text-[12px] text-(--text-muted) hover:text-(--text-primary)"
                  >
                    <ArrowSquareOut size={14} />
                    {t("scrapbookJumpToMessage")}
                  </button>
                ) : null}

                <section className="rounded-2xl bg-(--bg-secondary) p-5">
                  <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)">
                    {t("scrapbookSummary")}
                  </div>
                  {summaryBusy && !summaryPartialText ? (
                    <ScrapbookSummaryLoading />
                  ) : (
                    <StreamdownRenderer
                      text={summaryText}
                      streaming={summaryBusy}
                      inlineEmbeds={false}
                      className="text-[14px] leading-7 text-(--text-secondary)"
                    />
                  )}
                </section>

                <section className="rounded-2xl bg-(--bg-secondary) p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)">
                      {t("scrapbookContent")}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setContentExpanded((current) => !current)
                      }
                      className="rounded-lg px-3 py-1.5 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                    >
                      {contentExpanded ? "收起原文" : "展开原文"}
                    </button>
                  </div>
                  {contentExpanded ? (
                    <div className="mt-4 whitespace-pre-wrap wrap-break-word text-[14px] leading-7 text-(--text-secondary)">
                      {selectedEntry.contentText || t("scrapbookNoContent")}
                    </div>
                  ) : (
                    <div className="mt-4 text-[12px] text-(--text-muted)">
                      默认折叠原始抓取内容，按需展开查看。
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setComposerOpen(open);
          if (!open) setError("");
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{t("scrapbookNewNotebook")}</DialogTitle>
            <DialogDescription>{t("scrapbookCreateDescription")}</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!createDisabled) void handleCreate();
            }}
          >
            <div className="inline-flex w-fit rounded-xl bg-(--bg-hover) p-1 text-[12px]">
              <button
                type="button"
                className={`rounded-lg px-4 py-2 transition ${
                  isUrlMode
                    ? "bg-(--bg-primary) text-(--text-primary) shadow-sm"
                    : "text-(--text-muted) hover:text-(--text-primary)"
                }`}
                onClick={() => setComposerMode("url")}
              >
                {t("scrapbookUrlImport")}
              </button>
              <button
                type="button"
                className={`rounded-lg px-4 py-2 transition ${
                  !isUrlMode
                    ? "bg-(--bg-primary) text-(--text-primary) shadow-sm"
                    : "text-(--text-muted) hover:text-(--text-primary)"
                }`}
                onClick={() => setComposerMode("manual")}
              >
                {t("scrapbookManualEntry")}
              </button>
            </div>

            {isUrlMode ? (
              <label className="grid gap-2">
                <span className="text-[12px] font-medium text-(--text-secondary)">
                  {t("scrapbookSourceUrlPlaceholder")}
                </span>
                <input
                  value={form.url}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, url: event.target.value }))
                  }
                  placeholder="https://"
                  className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 text-[13px] text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
                  autoFocus
                />
              </label>
            ) : (
              <>
                <label className="grid gap-2">
                  <span className="text-[12px] font-medium text-(--text-secondary)">
                    {t("scrapbookTitlePlaceholder")}
                  </span>
                  <input
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder={t("scrapbookGeneratedTitleHint")}
                    className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 text-[13px] text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-[12px] font-medium text-(--text-secondary)">
                    {t("scrapbookContent")}
                  </span>
                  <textarea
                    value={form.content}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        content: event.target.value,
                      }))
                    }
                    placeholder={t("scrapbookContentPlaceholder")}
                    className="min-h-44 w-full resize-y rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 py-3 text-[13px] leading-6 text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
                    autoFocus
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-[12px] font-medium text-(--text-secondary)">
                    {t("scrapbookOptionalSource")}
                  </span>
                  <input
                    value={form.sourceUrl}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sourceUrl: event.target.value,
                      }))
                    }
                    placeholder="https://"
                    className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 text-[13px] text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
                  />
                </label>
              </>
            )}

            <div className="flex items-start gap-2.5 rounded-xl bg-primary/8 px-3.5 py-3 text-[12px] leading-5 text-(--text-secondary)">
              <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
              <span>{t("scrapbookAiTitleDescription")}</span>
            </div>

            {error ? <div className="text-[12px] text-accent-red">{error}</div> : null}

            <DialogFooter>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                disabled={saving}
                className="h-10 rounded-xl border border-(--border-default) px-4 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover) disabled:opacity-60"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={createDisabled}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} weight="bold" />
                {saving ? t("scrapbookSaving") : t("scrapbookCreate")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleteTarget}
        title={t("scrapbookDelete")}
        description={t("scrapbookDeleteDescription")}
        loading={deleting}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
