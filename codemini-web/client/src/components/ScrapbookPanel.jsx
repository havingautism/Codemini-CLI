import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  Globe,
  NotePencil,
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

function sourceHostname(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
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
  const [composerMode, setComposerMode] = useState("url");
  const [saveWithSummary, setSaveWithSummary] = useState(true);
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
      if (saveWithSummary) {
        const started = await summarizeScrapbookEntry(entry.id);
        if (started?.job) {
          setSelectedEntry((current) =>
            current?.id === entry.id ? { ...current, latestJob: started.job } : current,
          );
        }
      }
      await loadEntries();
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

  const listEmpty = !loading && entries.length === 0;
  const isUrlMode = composerMode === "url";
  const isDetailView = !!scrapbookEntryId;
  const summaryJob = selectedEntry?.latestJob || null;
  const summaryBusy = summaryJob && ["pending", "running"].includes(summaryJob.status);
  const summaryText =
    selectedEntry?.summary ||
    summaryJob?.resultSummary ||
    summaryJob?.partialText ||
    t("scrapbookNoSummary");
  const filteredCountLabel = useMemo(
    () => `${entries.length} ${t("scrapbookItems")}`,
    [entries.length],
  );

  const composer = (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-secondary) p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-(--text-primary)">
            {t("scrapbook")}
          </div>
          <div className="mt-1 text-[12px] text-(--text-muted)">
            {t("scrapbookSelectHint")}
          </div>
        </div>
        <div className="inline-flex rounded-lg bg-(--bg-hover) p-1 text-[12px]">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 ${isUrlMode ? "bg-(--bg-primary) text-(--text-primary)" : "text-(--text-muted)"}`}
            onClick={() => setComposerMode("url")}
          >
            {t("scrapbookUrlImport")}
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 ${!isUrlMode ? "bg-(--bg-primary) text-(--text-primary)" : "text-(--text-muted)"}`}
            onClick={() => setComposerMode("manual")}
          >
            {t("scrapbookManualEntry")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {isUrlMode ? (
          <input
            value={form.url}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            placeholder={t("scrapbookSourceUrlPlaceholder")}
            className="w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] outline-none"
          />
        ) : (
          <>
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder={t("scrapbookTitlePlaceholder")}
              className="w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] outline-none"
            />
            <textarea
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              placeholder={t("scrapbookContentPlaceholder")}
              className="min-h-36 w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] outline-none"
            />
            <input
              value={form.sourceUrl}
              onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
              placeholder={t("scrapbookSourceUrlPlaceholder")}
              className="w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] outline-none"
            />
          </>
        )}
        <label className="inline-flex items-center gap-2 text-[12px] text-(--text-secondary)">
          <input
            type="checkbox"
            checked={saveWithSummary}
            onChange={(event) => setSaveWithSummary(event.target.checked)}
          />
          {t("scrapbookSaveWithSummary")}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-(--text-primary) px-3 py-2 text-[12px] font-medium text-(--bg-primary) disabled:opacity-60"
          >
            <Plus size={14} />
            {saving ? t("scrapbookSaving") : t("scrapbookSave")}
          </button>
          {error ? (
            <div className="text-[12px] text-accent-red">{error}</div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg-primary)">
      {!isDetailView ? (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6">
          {composer}
          <section className="rounded-xl border border-(--border-default) bg-(--bg-secondary) p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold text-(--text-primary)">
                  {t("scrapbook")}
                </div>
                <div className="mt-1 text-[12px] text-(--text-muted)">
                  {filteredCountLabel}
                </div>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("scrapbookSearchPlaceholder")}
                className="w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2 text-[13px] outline-none sm:max-w-72"
              />
            </div>

            <div className="mt-4">
              {loading ? (
                <div className="text-[12px] text-(--text-muted)">
                  {t("scrapbookLoading")}
                </div>
              ) : null}
              {listEmpty ? (
                <div className="rounded-lg border border-dashed border-(--border-default) px-4 py-8 text-center text-[12px] text-(--text-muted)">
                  {t("scrapbookEmpty")}
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {entries.map((entry) => (
                    <div
                    key={entry.id}
                      className="group rounded-xl border border-(--border-default) bg-(--bg-primary) p-4 transition hover:border-(--border-strong) hover:bg-(--bg-hover)"
                  >
                      <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                              <button
                            type="button"
                            onClick={() => actions.openScrapbookEntry(entry.id)}
                                className="line-clamp-2 break-all text-left text-[14px] font-semibold text-(--text-primary)"
                          >
                            {entryTitle(entry)}
                          </button>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-(--text-muted)">
                          {entry.sourceType === "url" ? (
                            <span className="inline-flex items-center gap-1">
                              <Globe size={12} />
                              URL
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <NotePencil size={12} />
                              Note
                            </span>
                          )}
                          {sourceHostname(entry.sourceUrl) ? (
                            <span className="inline-flex items-center rounded-full border border-(--border-default) bg-(--bg-secondary) px-2 py-0.5 text-[10px] text-(--text-secondary)">
                              {sourceHostname(entry.sourceUrl)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          {entry.sourceUrl ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                window.open(entry.sourceUrl, "_blank", "noopener,noreferrer");
                              }}
                              className="inline-flex size-8 items-center justify-center rounded-lg border border-(--border-default) text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                              aria-label="Open source link"
                            >
                              <ArrowSquareOut size={14} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                                  requestDelete(entry);
                            }}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-(--border-default) text-accent-red hover:bg-(--accent-red-bg)"
                            aria-label="Delete scrapbook entry"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                    </div>
                      <button
                        type="button"
                        onClick={() => actions.openScrapbookEntry(entry.id)}
                        className="mt-3 block w-full text-left"
                      >
                            <div className="line-clamp-4 break-all text-[12px] leading-5 text-(--text-secondary)">
                          {entryPreview(entry)}
                        </div>
                      </button>
                    </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => actions.openScrapbookHome()}
              className="inline-flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
            >
              <ArrowLeft size={14} />
              {t("scrapbook")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAsk}
                disabled={asking}
                className="inline-flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-60"
              >
                <Sparkle size={14} />
                {asking ? t("scrapbookAsking") : t("scrapbookAsk")}
              </button>
              <button
                type="button"
                onClick={handleSummarize}
                disabled={summaryBusy}
                className="rounded-lg border border-(--border-default) px-3 py-2 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-60"
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
                className="inline-flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-[12px] text-accent-red hover:bg-(--accent-red-bg)"
              >
                <Trash size={14} />
                {t("scrapbookDelete")}
              </button>
            </div>
          </div>

          {!selectedEntry ? (
            <div className="rounded-xl border border-dashed border-(--border-default) px-4 py-10 text-center text-[12px] text-(--text-muted)">
              {t("scrapbookLoading")}
            </div>
          ) : (
            <>
              <section className="rounded-xl border border-(--border-default) bg-(--bg-secondary) p-5 shadow-sm">
                <div className="text-[24px] font-semibold leading-8 text-(--text-primary)">
                  {entryTitle(selectedEntry)}
                </div>
                {sourceHostname(selectedEntry.sourceUrl) ? (
                  <div className="mt-3">
                    <span className="inline-flex items-center rounded-full border border-(--border-default) bg-(--bg-primary) px-2.5 py-1 text-[11px] text-(--text-secondary)">
                      {sourceHostname(selectedEntry.sourceUrl)}
                    </span>
                  </div>
                ) : null}
                {selectedEntry.sourceUrl ? (
                  <a
                    href={selectedEntry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 text-[12px] text-(--text-muted) hover:text-(--text-primary)"
                  >
                    <Globe size={14} />
                    {selectedEntry.sourceUrl}
                  </a>
                ) : null}
              </section>

              <section className="rounded-xl border border-(--border-default) bg-(--bg-secondary) p-5 shadow-sm">
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)">
                  {t("scrapbookSummary")}
                </div>
                <StreamdownRenderer
                  text={summaryText}
                  streaming={summaryBusy}
                  className="text-[14px] leading-7 text-(--text-secondary)"
                />
              </section>

              <section className="rounded-xl border border-(--border-default) bg-(--bg-secondary) p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)">
                    {t("scrapbookContent")}
                  </div>
                  <button
                    type="button"
                    onClick={() => setContentExpanded((current) => !current)}
                    className="rounded-lg border border-(--border-default) px-3 py-1.5 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
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
            </>
          )}
        </div>
      )}
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
