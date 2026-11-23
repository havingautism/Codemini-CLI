// The expanding search field follows Beautiful UI's SidebarNav. See beautiful-ui/LICENSE.
import { useEffect, useRef, useState } from "react";
import GlideMenu from "@/components/beautiful-ui/GlideMenu.jsx";
import { MagnifyingGlass, X } from "@/lib/icons";
import { fetchSidebarSessionSearch } from "@/hooks/use-api.js";
import { displaySessionTitle, isSidebarChatSessionActive } from "@/lib/session-ui-state.js";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

export function SidebarSessionSearch({ children, currentSessionId, currentView, onPick }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(null);
  const [page, setPage] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const query = text.trim();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setPage((previous) => ({
      query,
      sessions: previous?.query === query && cursor ? previous.sessions : [],
      nextCursor: previous?.query === query && cursor ? previous.nextCursor : null,
      loading: true,
      error: false,
    }));
    const timer = setTimeout(async () => {
      try {
        const result = await fetchSidebarSessionSearch(query, cursor, controller.signal);
        if (controller.signal.aborted) return;
        setPage((previous) => ({
          query,
          sessions: cursor ? [...previous.sessions, ...result.sessions] : result.sessions,
          nextCursor: result.nextCursor,
          loading: false,
          error: false,
        }));
      } catch {
        if (controller.signal.aborted) return;
        setPage((previous) => ({ ...previous, loading: false, error: true }));
      }
    }, cursor ? 0 : 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, cursor, attempt]);

  const result = page?.query === query ? page : null;
  const rows = result?.sessions ?? [];
  const loading = Boolean(query) && (!result || result.loading);

  function closeSearch(restoreFocus) {
    setOpen(false);
    setText("");
    setCursor(null);
    setPage(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(session) {
    if (!session || session.scheduledStatus === "running") return;
    closeSearch(false);
    onPick(session.id);
  }

  return (
    <>
      <div className="codemini-sidebar-search mx-2.5 mb-1 shrink-0" data-open={open}>
        <span className="codemini-sidebar-search-label" aria-hidden={open}>{t("sessions")}</span>
        <button
          ref={triggerRef}
          type="button"
          className="codemini-sidebar-search-trigger"
          aria-label={t("sidebarSearchSessions")}
          title={t("sidebarSearchSessions")}
          aria-expanded={open}
          inert={open}
          onClick={() => setOpen(true)}
        >
          <MagnifyingGlass size={15} aria-hidden="true" />
        </button>
        <div className="codemini-sidebar-search-field" role="search" inert={!open}>
          <MagnifyingGlass size={15} className="shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            aria-label={t("sidebarSearchSessions")}
            placeholder={t("sidebarSearchPlaceholder")}
            maxLength={200}
            value={text}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim() !== query) {
                setCursor(null);
                setPage(null);
              }
              setText(next);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch(true);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                choose(rows.find((session) => session.scheduledStatus !== "running"));
              }
            }}
          />
          <button type="button" className="codemini-sidebar-search-close" aria-label={t("sidebarCloseSearch")} onClick={() => closeSearch(true)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {query && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
          <GlideMenu className="flex flex-col gap-1">
            {rows.map((session) => {
              const title = displaySessionTitle(session.title || session.preview || t("emptyChat"));
              const active = isSidebarChatSessionActive(session.id, currentSessionId, currentView);
              const project = session.isGeneral
                ? t("generalChat")
                : session.projectDir?.split(/[\\/]/).filter(Boolean).at(-1);
              const disabled = session.scheduledStatus === "running";
              return (
                <button
                  type="button"
                  data-menu-row
                  key={session.id}
                  aria-current={active ? "page" : undefined}
                  disabled={disabled}
                  title={disabled ? t("scheduledSessionRunningHint") : title}
                  className={cn("flex min-h-9 min-w-0 flex-col justify-center gap-0.5 px-2 py-1 text-start disabled:opacity-50", active && "bg-(--bg-active)")}
                  onClick={() => choose(session)}
                >
                  <span className="max-w-full truncate text-[13px] text-(--text-primary)">{title}</span>
                  {session.matchPreview && (
                    <span className="max-w-full truncate text-[12px] text-(--text-secondary)">{session.matchPreview.replace(/\s+/g, " ").trim()}</span>
                  )}
                  {project && <span className="max-w-full truncate text-[11px] text-(--text-muted)">{project}</span>}
                </button>
              );
            })}
          </GlideMenu>
          {loading && <p role="status" className="px-2 py-2 text-xs text-(--text-muted)">{t("loading")}</p>}
          {!loading && result?.error && (
            <button type="button" className="px-2 py-2 text-start text-xs text-(--text-secondary)" onClick={() => setAttempt((value) => value + 1)}>
              {t("loadMoreSessionsError")}
            </button>
          )}
          {!loading && result && !result.error && !rows.length && (
            <p role="status" className="px-2 py-2 text-xs text-(--text-muted)">{t("sidebarNoMatchingSessions")}</p>
          )}
          {Array.from(query).length < 3 && (
            <p className="px-2 py-1 text-xs text-(--text-muted)">{t("sidebarSearchShortQuery")}</p>
          )}
          {!loading && result?.nextCursor && !result.error && (
            <button type="button" className="px-2 py-2 text-start text-xs text-(--text-secondary)" onClick={() => setCursor(result.nextCursor)}>
              {t("showMoreSessions")}
            </button>
          )}
        </div>
      )}
      <div className={query ? "hidden" : "contents"}>{children}</div>
    </>
  );
}
