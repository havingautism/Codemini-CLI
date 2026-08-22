import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Article,
  ArrowsOutSimple,
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CircleNotch,
  DotsThreeVertical,
  FileText,
  GridFour,
  Globe,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  Notebook,
  Plus,
  Sparkle,
  TreeStructure,
  Trash,
  UploadSimple,
} from "@/lib/icons";
import { t } from "../../i18n/index.js";
import {
  addScrapbookSource,
  createMultiSourceScrapbookEntry,
  deleteScrapbookEntry,
  fetchScrapbookEntries,
  fetchScrapbookEntry,
  fetchScrapbookSummaryJob,
  generateScrapbookArtifact,
  openScrapbookSummaryJobStream,
  removeScrapbookSource,
  summarizeScrapbookEntry,
  uploadScrapbookSources,
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
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            fullTitle,
          ),
        ][0]?.segment || ""
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
  return NOTEBOOK_TONES[
    Math.abs(Number(toneIndex) || 0) % NOTEBOOK_TONES.length
  ];
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
      className="relative overflow-hidden rounded-2xl border border-(--message-edge) bg-(--bg-primary) px-5 py-6 shadow-[var(--shadow-sm)]"
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
                    index === 0
                      ? "bg-primary animate-pulse"
                      : "bg-(--border-strong)"
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
  onDelete,
}) {
  const isList = viewMode === "list";
  const SourceIcon = entry.sourceType === "url" ? Globe : Notebook;
  const sourceLabel = scrapbookSourceLabel(entry);
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
          <PopoverContent align="end" sideOffset={4} className="w-40 rounded-md p-1">
            <button
              type="button"
              onClick={() => onDelete(entry)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-accent-red hover:bg-(--accent-red-bg)"
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
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerFiles, setComposerFiles] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [sortMode, setSortMode] = useState("recent");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuEntryId, setMenuEntryId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceAdding, setSourceAdding] = useState(false);
  const [openSource, setOpenSource] = useState(null);
  const [studioKind, setStudioKind] = useState("mindmap");
  const [studioGenerating, setStudioGenerating] = useState(false);
  const [mindmapExpanded, setMindmapExpanded] = useState(false);
  const [sourcePaneWidth, setSourcePaneWidth] = useState(280);
  const [studioPaneWidth, setStudioPaneWidth] = useState(380);
  const [detailPane, setDetailPane] = useState("summary");
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
      setDetailPane("summary");
      return;
    }
    setSelectedEntry(null);
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
            current?.id === selectedEntry.id
              ? { ...current, latestJob: payload.job }
              : current,
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
      const urls = form.url
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await createMultiSourceScrapbookEntry({
        title: form.title,
        urls,
        contentText: form.content,
        files: composerFiles,
      });
      const entry = result?.entry || result;
      if (!entry?.id) {
        throw new Error(result?.message || t("scrapbookSaveFailed"));
      }
      await loadEntries();
      setComposerOpen(false);
      actions.openScrapbookEntry(entry.id);
      setForm({ url: "", title: "", content: "", sourceUrl: "" });
      setComposerFiles([]);
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
        current?.id === selectedEntry.id
          ? { ...current, latestJob: started.job }
          : current,
      );
    }
    await loadEntries();
  };

  const applyNotebookMutation = (result) => {
    if (!result?.entry) return;
    setSelectedEntry({
      ...result.entry,
      latestJob: result.job || result.entry.latestJob || null,
    });
  };

  const handleAddUrlSource = async () => {
    const url = sourceDraft.trim();
    if (!selectedEntry || !url) return;
    setSourceAdding(true);
    setError("");
    try {
      const result = await addScrapbookSource(selectedEntry.id, {
        type: "url",
        url,
        name: url,
      });
      if (result?.error) throw new Error(result.message);
      applyNotebookMutation(result);
      setSourceDraft("");
      await loadEntries();
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookSourceAddFailed")));
    } finally {
      setSourceAdding(false);
    }
  };

  const handleUploadSources = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedEntry || !files.length) return;
    setSourceAdding(true);
    setError("");
    try {
      const result = await uploadScrapbookSources(selectedEntry.id, files);
      if (result?.error) throw new Error(result.message);
      applyNotebookMutation(result);
      await loadEntries();
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookSourceUploadFailed")));
    } finally {
      setSourceAdding(false);
    }
  };

  const handleRemoveSource = async (sourceId) => {
    if (!selectedEntry) return;
    setError("");
    try {
      const result = await removeScrapbookSource(selectedEntry.id, sourceId);
      if (result?.error) throw new Error(result.message);
      applyNotebookMutation(result);
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookSourceUpdateFailed")));
    }
  };

  const handleGenerateStudio = async (kind) => {
    if (!selectedEntry) return;
    setStudioKind(kind);
    setStudioGenerating(true);
    setError("");
    try {
      const result = await generateScrapbookArtifact(selectedEntry.id, kind);
      if (result?.error) throw new Error(result.message);
      if (result?.entry) {
        setSelectedEntry((current) => ({
          ...current,
          ...result.entry,
          latestJob: current?.latestJob,
        }));
      }
    } catch (nextError) {
      setError(String(nextError?.message || t("scrapbookStudioFailed")));
    } finally {
      setStudioGenerating(false);
    }
  };

  const handlePaneResizeStart = (event, pane) => {
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = pane === "sources" ? sourcePaneWidth : studioPaneWidth;
    const containerWidth =
      event.currentTarget.parentElement?.getBoundingClientRect().width ||
      window.innerWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (pane === "sources") {
        const maxWidth = Math.max(
          220,
          Math.min(420, containerWidth - studioPaneWidth - 352),
        );
        setSourcePaneWidth(
          Math.min(maxWidth, Math.max(220, initialWidth + delta)),
        );
      } else {
        const maxWidth = Math.max(
          280,
          Math.min(640, containerWidth - sourcePaneWidth - 352),
        );
        setStudioPaneWidth(
          Math.min(maxWidth, Math.max(280, initialWidth - delta)),
        );
      }
    };
    const handleEnd = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleEnd);
  };

  const handlePaneResizeKeyDown = (event, pane) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (pane === "sources") {
      setSourcePaneWidth((width) =>
        Math.min(420, Math.max(220, width + direction * 20)),
      );
    } else {
      setStudioPaneWidth((width) =>
        Math.min(640, Math.max(280, width - direction * 20)),
      );
    }
  };

  const isDetailView = !!scrapbookEntryId;
  const summaryJob = selectedEntry?.latestJob || null;
  const summaryBusy =
    summaryJob && ["pending", "running"].includes(summaryJob.status);
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
      const leftTime = new Date(
        left.updatedAt || left.createdAt || 0,
      ).getTime();
      const rightTime = new Date(
        right.updatedAt || right.createdAt || 0,
      ).getTime();
      return rightTime - leftTime;
    });
  }, [activeFilter, entries, sortMode]);
  const listEmpty = !loading && visibleEntries.length === 0;
  const filteredCountLabel = `${visibleEntries.length} ${t("scrapbookItems")}`;

  const createDisabled =
    saving ||
    (!form.url.trim() && !form.content.trim() && composerFiles.length === 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
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
                className={`flex h-10 items-center overflow-hidden rounded-full border border-(--border-strong) bg-(--bg-primary) transition-[width,border-color] ${
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

              <div className="inline-flex h-10 overflow-hidden rounded-full border border-(--border-strong)">
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
                  className={`flex w-10 items-center justify-center border-l border-(--border-strong) transition ${
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
                  className="h-10 appearance-none rounded-full border border-(--border-strong) bg-(--bg-primary) pl-4 pr-9 text-[12px] font-medium text-(--text-secondary) outline-none hover:bg-(--bg-hover)"
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
              <Notebook
                size={32}
                weight="duotone"
                className="text-(--text-muted)"
              />
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
                  className="group flex min-h-52 flex-col items-center justify-center rounded-2xl border border-(--border-strong) bg-transparent text-(--text-secondary) transition hover:border-[color-mix(in_srgb,var(--text-primary)_28%,transparent)] hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
        <DialogContent className="grid h-[calc(100dvh-0.5rem)] max-h-[1040px] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(96vh,1040px)] sm:max-w-[calc(100vw-1rem)] lg:grid-rows-[auto_minmax(0,1fr)] xl:max-w-[1560px]">
          <DialogHeader className="px-6">
            <DialogTitle className="pr-2 text-[20px] leading-7">
              {selectedEntry
                ? entryTitle(selectedEntry)
                : t("scrapbookLoading")}
            </DialogTitle>
            {selectedEntry ? (
              <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  {(selectedEntry.sources || []).length} {t("scrapbookSources")}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatEntryDate(selectedEntry)}</span>
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-3 sm:px-6 lg:absolute lg:right-14 lg:top-4 lg:z-10 lg:p-0">
            <div className="flex min-w-0 flex-1 rounded-xl bg-(--bg-secondary) p-1 lg:hidden">
              {[
                ["sources", t("scrapbookSources")],
                ["summary", t("scrapbookOverview")],
                ["studio", t("scrapbookStudio")],
              ].map(([pane, label]) => (
                <button
                  key={pane}
                  type="button"
                  onClick={() => setDetailPane(pane)}
                  className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                    detailPane === pane
                      ? "bg-(--bg-primary) text-(--text-primary) shadow-sm"
                      : "text-(--text-muted)"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {error ? (
              <span className="order-3 w-full truncate text-[11px] text-accent-red sm:order-none sm:w-auto sm:max-w-56">
                {error}
              </span>
            ) : null}
          </div>

          <div
            className="grid min-h-0 bg-(--bg-primary) lg:grid-cols-[var(--scrapbook-source-width)_6px_minmax(300px,1fr)_6px_var(--scrapbook-studio-width)]"
            style={{
              "--scrapbook-source-width": `${sourcePaneWidth}px`,
              "--scrapbook-studio-width": `${studioPaneWidth}px`,
            }}
          >
            <aside
              className={`${detailPane === "sources" ? "flex" : "hidden"} min-h-0 flex-col bg-(--bg-primary) lg:flex`}
            >
              <div className="shrink-0 px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-(--text-primary)">
                    <LinkSimple size={15} />
                    {t("scrapbookSources")}
                  </div>
                  <span className="text-[11px] text-(--text-muted)">
                    {(selectedEntry?.sources || []).length}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={sourceDraft}
                    onChange={(event) => setSourceDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleAddUrlSource();
                    }}
                    placeholder="https://"
                    className="h-9 min-w-0 flex-1 rounded-lg bg-(--bg-secondary) px-3 text-[12px] text-(--text-primary) outline-none ring-1 ring-transparent transition focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={handleAddUrlSource}
                    disabled={sourceAdding || !sourceDraft.trim()}
                    aria-label={t("scrapbookAddSource")}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--text-primary) text-(--bg-primary) disabled:opacity-40"
                  >
                    {sourceAdding ? (
                      <CircleNotch size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} weight="bold" />
                    )}
                  </button>
                </div>
                <label className="mt-2 flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--bg-secondary) text-[12px] font-medium text-(--text-secondary) transition hover:bg-(--bg-hover) hover:text-(--text-primary)">
                  <UploadSimple size={14} />
                  {t("scrapbookUploadDocuments")}
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.markdown"
                    multiple
                    className="sr-only"
                    onChange={handleUploadSources}
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
                {(selectedEntry?.sources || []).map((source) => {
                  const SourceIcon =
                    source.type === "url"
                      ? Globe
                      : source.type === "chat_answer"
                        ? Article
                        : FileText;
                  const canOpenSource = Boolean(source.url);
                  const jumpSessionId =
                    source.sessionId ||
                    (source.type === "chat_answer"
                      ? selectedEntry?.sourceSessionId
                      : "");
                  const jumpMessageId =
                    source.messageId ||
                    (source.type === "chat_answer"
                      ? selectedEntry?.sourceMessageId
                      : "");
                  const canJumpToMessage = Boolean(
                    jumpSessionId && jumpMessageId,
                  );
                  return (
                    <div
                      key={source.id}
                      className="group flex items-center gap-2 rounded-xl px-2 py-2.5 hover:bg-(--bg-hover)"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenSource(source)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        aria-label={`${t("scrapbookOpenOriginalSource")}: ${source.name || source.url || t("scrapbookUntitled")}`}
                      >
                        <SourceIcon
                          size={15}
                          className="shrink-0 text-(--text-muted)"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-(--text-secondary)">
                            {source.name || source.url || t("scrapbookUntitled")}
                          </div>
                          {source.status && source.status !== "ready" ? (
                            <div className="mt-0.5 text-[10px] text-(--text-muted)">
                              {t("scrapbookSourcePending")}
                            </div>
                          ) : null}
                        </div>
                      </button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("scrapbookSourceActions")}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-(--text-muted) opacity-0 transition hover:bg-(--bg-secondary) hover:text-(--text-primary) group-hover:opacity-100 focus:opacity-100"
                          >
                            <DotsThreeVertical size={14} weight="bold" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          sideOffset={4}
                          className="w-40 rounded-md p-1"
                        >
                          {canOpenSource ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(
                                  source.url,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                            >
                              <ArrowSquareOut size={14} />
                              {t("scrapbookJumpToOriginalLink")}
                            </button>
                          ) : null}
                          {canJumpToMessage ? (
                            <button
                              type="button"
                              onClick={() =>
                                void actions.openChatMessage(
                                  jumpSessionId,
                                  jumpMessageId,
                                )
                              }
                              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                            >
                              <ArrowSquareOut size={14} />
                              {t("scrapbookJumpToMessage")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleRemoveSource(source.id)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-accent-red hover:bg-(--accent-red-bg)"
                          >
                            <Trash size={14} />
                            {t("scrapbookDelete")}
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                })}
              </div>
            </aside>

            <button
              type="button"
              role="separator"
              aria-label={t("scrapbookResizeSources")}
              aria-orientation="vertical"
              aria-valuemin={220}
              aria-valuemax={420}
              aria-valuenow={Math.round(sourcePaneWidth)}
              onPointerDown={(event) => handlePaneResizeStart(event, "sources")}
              onKeyDown={(event) => handlePaneResizeKeyDown(event, "sources")}
              onDoubleClick={() => setSourcePaneWidth(280)}
              className="group relative hidden min-h-0 cursor-col-resize items-stretch justify-center outline-none lg:flex"
            >
              <span className="w-px bg-(--border-default)/45 transition group-hover:bg-primary/55 group-focus-visible:bg-primary" />
            </button>

            <main
              className={`${detailPane === "summary" ? "flex" : "hidden"} min-h-0 flex-col bg-(--bg-secondary) lg:flex`}
            >
              <div className="flex shrink-0 items-center gap-3 px-5 py-4 sm:px-7">
                <div>
                  <div className="text-[13px] font-semibold text-(--text-primary)">
                    {t("scrapbookOverview")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-(--text-muted)">
                    {t("scrapbookAutoSummaryHint")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSummarize}
                  disabled={!selectedEntry || summaryBusy}
                  aria-label={t("scrapbookResummarize")}
                  className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-40"
                >
                  <ArrowsClockwise
                    size={15}
                    className={summaryBusy ? "animate-spin" : ""}
                  />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 sm:px-7">
                <div className="codemini-chat-session mx-auto max-w-3xl">
                  {!selectedEntry ? (
                    <div className="flex min-h-56 items-center justify-center text-[12px] text-(--text-muted)">
                      <CircleNotch size={18} className="mr-2 animate-spin" />
                      {t("scrapbookLoading")}
                    </div>
                  ) : summaryBusy && !summaryPartialText ? (
                    <ScrapbookSummaryLoading />
                  ) : (
                    <article className="rounded-2xl border border-(--message-edge) bg-(--bg-primary) px-5 py-5 shadow-[var(--shadow-sm)] sm:px-6 sm:py-6">
                      <StreamdownRenderer
                        text={summaryText}
                        streaming={summaryBusy}
                        inlineEmbeds={false}
                        className="codemini-assistant-markdown text-(--text-primary)"
                      />
                    </article>
                  )}
                </div>
              </div>
            </main>

            <button
              type="button"
              role="separator"
              aria-label={t("scrapbookResizeStudio")}
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={640}
              aria-valuenow={Math.round(studioPaneWidth)}
              onPointerDown={(event) => handlePaneResizeStart(event, "studio")}
              onKeyDown={(event) => handlePaneResizeKeyDown(event, "studio")}
              onDoubleClick={() => setStudioPaneWidth(380)}
              className="group relative hidden min-h-0 cursor-col-resize items-stretch justify-center outline-none lg:flex"
            >
              <span className="w-px bg-(--border-default)/45 transition group-hover:bg-primary/55 group-focus-visible:bg-primary" />
            </button>

            <aside
              className={`${detailPane === "studio" ? "flex" : "hidden"} min-h-0 flex-col bg-(--bg-primary) lg:flex`}
            >
              <div className="shrink-0 px-4 py-4">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-(--text-primary)">
                  <TreeStructure size={15} />
                  {t("scrapbookStudio")}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ["mindmap", TreeStructure, t("scrapbookMindMap")],
                    ["report", Article, t("scrapbookReport")],
                  ].map(([kind, Icon, label]) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setStudioKind(kind)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium transition ${
                        studioKind === kind
                          ? "bg-primary/12 text-primary ring-1 ring-primary/25"
                          : "bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-hover)"
                      }`}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
                {selectedEntry?.artifacts?.[studioKind]?.content ? (
                  studioKind === "mindmap" ? (
                    <div className="scrapbook-mindmap-preview relative">
                      <StreamdownRenderer
                        text={selectedEntry.artifacts.mindmap.content}
                        streaming={false}
                        inlineEmbeds={false}
                        className="text-[13px] leading-6 text-(--text-secondary)"
                      />
                      <button
                        type="button"
                        onClick={() => setMindmapExpanded(true)}
                        aria-label={t("scrapbookExpandMindMap")}
                        title={t("scrapbookExpandMindMap")}
                        data-scrapbook-mindmap-action="expand"
                        className="absolute right-8 top-[19px] z-20 inline-flex size-7 items-center justify-center rounded-md text-(--text-secondary) transition hover:bg-(--bg-hover) hover:text-(--text-primary)"
                      >
                        <ArrowsOutSimple size={16} />
                      </button>
                    </div>
                  ) : (
                    <StreamdownRenderer
                      text={selectedEntry.artifacts.report.content}
                      streaming={false}
                      inlineEmbeds={false}
                      className="text-[13px] leading-6 text-(--text-secondary)"
                    />
                  )
                ) : (
                  <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
                    {studioKind === "mindmap" ? (
                      <TreeStructure
                        size={30}
                        weight="duotone"
                        className="text-primary"
                      />
                    ) : (
                      <Article
                        size={30}
                        weight="duotone"
                        className="text-primary"
                      />
                    )}
                    <div className="mt-3 text-[12px] leading-5 text-(--text-muted)">
                      {t("scrapbookStudioEmpty")}
                    </div>
                  </div>
                )}
              </div>
              <div className="shrink-0 p-4">
                <button
                  type="button"
                  onClick={() => void handleGenerateStudio(studioKind)}
                  disabled={!selectedEntry || studioGenerating || summaryBusy}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-(--text-primary) text-[12px] font-semibold text-(--bg-primary) transition hover:opacity-90 disabled:opacity-40"
                >
                  {studioGenerating ? (
                    <CircleNotch size={15} className="animate-spin" />
                  ) : studioKind === "mindmap" ? (
                    <TreeStructure size={15} />
                  ) : (
                    <Article size={15} />
                  )}
                  {studioGenerating
                    ? t("scrapbookStudioGenerating")
                    : t("scrapbookGenerateStudio")}
                </button>
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(openSource)}
        onOpenChange={(open) => {
          if (!open) setOpenSource(null);
        }}
      >
        <DialogContent className="grid max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-(--border-default) px-6">
            <DialogTitle className="pr-8 text-[16px]">
              {openSource?.name || openSource?.url || t("scrapbookUntitled")}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <span>{t("scrapbookOriginalContent")}</span>
              {openSource?.url ? (
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      openSource.url,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ArrowSquareOut size={12} />
                  {t("scrapbookJumpToOriginalLink")}
                </button>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto bg-(--bg-secondary) p-5 sm:p-6">
            {openSource?.contentText ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-(--text-secondary)">
                {openSource.contentText}
              </pre>
            ) : (
              <div className="flex min-h-40 items-center justify-center text-[12px] text-(--text-muted)">
                {openSource?.status === "pending_fetch"
                  ? t("scrapbookSourcePending")
                  : t("scrapbookNoContent")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mindmapExpanded} onOpenChange={setMindmapExpanded}>
        <DialogContent className="grid h-[calc(100dvh-1rem)] max-h-[1100px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(96vh,1100px)] sm:max-w-[calc(100vw-1rem)] xl:max-w-[1700px]">
          <DialogHeader className="px-6">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <TreeStructure size={18} />
              {t("scrapbookMindMap")}
            </DialogTitle>
            <DialogDescription>
              {selectedEntry ? entryTitle(selectedEntry) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 items-center overflow-auto bg-(--bg-secondary) p-4 sm:p-7">
            {selectedEntry?.artifacts?.mindmap?.content ? (
              <StreamdownRenderer
                text={selectedEntry.artifacts.mindmap.content}
                streaming={false}
                inlineEmbeds={false}
                className="scrapbook-mindmap-expanded mx-auto w-full min-w-[760px] text-[14px] leading-6 text-(--text-secondary)"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setComposerOpen(open);
          if (!open) {
            setError("");
            setComposerFiles([]);
          }
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{t("scrapbookNewNotebook")}</DialogTitle>
            <DialogDescription>
              {t("scrapbookCreateDescription")}
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!createDisabled) void handleCreate();
            }}
          >
            <label className="grid gap-2">
              <span className="text-[12px] font-medium text-(--text-secondary)">
                {t("scrapbookTitlePlaceholder")}
              </span>
              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={t("scrapbookGeneratedTitleHint")}
                className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 text-[13px] text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
                autoFocus
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[12px] font-medium text-(--text-secondary)">
                {t("scrapbookMultipleUrls")}
              </span>
              <textarea
                value={form.url}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder={
                  "https://example.com/article\nhttps://example.com/report"
                }
                className="min-h-24 w-full resize-y rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 py-3 font-mono text-[12px] leading-5 text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-[12px] font-medium text-(--text-secondary)">
                {t("scrapbookDocuments")}
              </span>
              <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--border-default) bg-(--bg-secondary) px-4 py-3 text-center text-[12px] text-(--text-muted) transition hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-secondary)">
                <UploadSimple size={18} />
                <span>{t("scrapbookChooseMultipleDocuments")}</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.markdown"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    setComposerFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />
              </label>
              {composerFiles.length ? (
                <div className="grid gap-1">
                  {composerFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-(--bg-secondary) px-3 py-2 text-[11px] text-(--text-secondary)"
                    >
                      <FileText
                        size={13}
                        className="shrink-0 text-(--text-muted)"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setComposerFiles((current) =>
                            current.filter(
                              (_, fileIndex) => fileIndex !== index,
                            ),
                          )
                        }
                        aria-label={t("scrapbookRemoveSource")}
                        className="inline-flex size-6 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--accent-red-bg) hover:text-accent-red"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="grid gap-2">
              <span className="text-[12px] font-medium text-(--text-secondary)">
                {t("scrapbookOptionalNote")}
              </span>
              <textarea
                value={form.content}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder={t("scrapbookOptionalNotePlaceholder")}
                className="min-h-24 w-full resize-y rounded-xl border border-(--border-default) bg-(--bg-primary) px-3.5 py-3 text-[13px] leading-6 text-(--text-primary) outline-none transition focus:border-(--border-strong) focus:ring-2 focus:ring-primary/15"
              />
            </label>

            <div className="flex items-start gap-2.5 rounded-xl bg-primary/8 px-3.5 py-3 text-[12px] leading-5 text-(--text-secondary)">
              <Sparkle
                size={16}
                weight="fill"
                className="mt-0.5 shrink-0 text-primary"
              />
              <span>{t("scrapbookAiTitleDescription")}</span>
            </div>

            {error ? (
              <div className="text-[12px] text-accent-red">{error}</div>
            ) : null}

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
