import { useEffect, useState } from "react";
import { Monitor } from "@/lib/icons";
import {
  closeVisualFeedback,
  fetchVisualFeedbackStatus,
  openVisualFeedback,
} from "@/hooks/use-api.js";
import { formatVisualFeedbackPanelError } from "@/lib/visual-feedback-message.js";
import { getLocale, t } from "../../i18n/index.js";

function envLabel(environment) {
  if (!environment) return "";
  const ids = (environment.strong || []).map((item) => item.id || item).filter(Boolean);
  return ids.join(", ");
}

export function VisualFeedbackPanel({ sessionId = "", projectCwd = "", disabled = false }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!sessionId) return;
    try {
      const next = await fetchVisualFeedbackStatus(sessionId, { locale: getLocale() });
      setStatus(next);
    } catch {
      // Status polling should stay quiet when the session is still loading.
    }
  }

  useEffect(() => {
    if (disabled || !sessionId) return undefined;
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [disabled, sessionId]);

  const open = async () => {
    if (disabled || !sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const opened = await openVisualFeedback(sessionId, { url: url.trim() || undefined, locale: getLocale() });
      setStatus(opened);
      if (opened?.url) setUrl(opened.url);
    } catch (err) {
      setError(formatVisualFeedbackPanelError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      await closeVisualFeedback(sessionId);
      await refresh();
    } catch (err) {
      setError(err?.message || t("visualFeedbackError"));
    } finally {
      setBusy(false);
    }
  };

  const environment = status?.environment;
  const noteCount = Array.isArray(status?.state?.notes) ? status.state.notes.length : 0;
  const openBrowser = status?.open === true;

  if (disabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-4 text-[13px] text-(--text-muted)">
        <Monitor size={20} />
        <p>{t("visualFeedbackNeedsProject")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 text-[13px]">
      <div className="mb-3 flex items-center gap-2 text-(--text-primary)">
        <Monitor size={16} />
        <h2 className="text-[14px] font-semibold">{t("visualFeedbackTitle")}</h2>
      </div>
      <p className="mb-4 leading-5 text-(--text-primary)">{t("visualFeedbackOpenHint")}</p>
      <div className="mb-4 flex flex-col gap-2">
        <button
          type="button"
          className="w-full rounded-md bg-(--text-primary) px-3 py-2 text-[13px] font-semibold text-(--bg-primary) disabled:opacity-50"
          disabled={busy || !sessionId}
          onClick={open}
        >
          {busy ? t("visualFeedbackOpening") : t("visualFeedbackOpen")}
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-(--border) bg-transparent px-3 py-1.5 text-(--text-primary) disabled:opacity-50"
          disabled={busy || !openBrowser}
          onClick={close}
        >
          {t("visualFeedbackCloseBrowser")}
        </button>
      </div>
      <label className="mb-1 text-[12px] text-(--text-muted)" htmlFor="visual-feedback-url">
        {t("visualFeedbackUrlLabel")}
      </label>
      <input
        id="visual-feedback-url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={t("visualFeedbackUrlPlaceholder")}
        className="mb-4 h-9 rounded-md border border-(--border) bg-(--bg-primary) px-3 text-(--text-primary)"
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            open();
          }
        }}
      />
      {error ? <p role="alert" className="mb-3 text-(--accent-red)">{error}</p> : null}
      <p className="mb-2 text-(--text-secondary)">
        {openBrowser ? t("visualFeedbackStatusOpen") : t("visualFeedbackStatusIdle")}
      </p>
      {openBrowser && status?.url ? (
        <p className="mb-2 font-mono text-[12px] text-(--text-muted)">{status.url}</p>
      ) : null}
      {environment ? (
        <p className={environment.ok ? "mb-2 text-(--accent-green)" : "mb-2 text-(--text-secondary)"}>
          {environment.ok ? t("visualFeedbackEnvOk") : t("visualFeedbackCapabilityHint")}
          {environment.ok && envLabel(environment) ? ` (${envLabel(environment)})` : ""}
        </p>
      ) : openBrowser && (status?.limitedCapabilities || !environment) ? (
        <p className="mb-2 text-(--text-secondary)">{t("visualFeedbackCapabilityHint")}</p>
      ) : null}
      {status?.loginUrl ? (
        <p className="mb-2 text-(--text-secondary)">
          {t("visualFeedbackLoginUrlHint")}
          <span className="mt-1 block break-all font-mono text-[12px] text-(--text-muted)">{status.loginUrl}</span>
        </p>
      ) : openBrowser && status?.usedLoginUrl ? (
        <p className="mb-2 text-(--text-secondary)">{t("visualFeedbackLoginUrlUsedHint")}</p>
      ) : null}
      {openBrowser && noteCount > 0 ? (
        <p className="mb-2 text-(--text-secondary)">
          {t("visualFeedbackNotes").replace("{{count}}", String(noteCount))}
        </p>
      ) : null}
      <div className="mt-auto pt-4 text-[12px] leading-5 text-(--text-muted)">
        <p>{t("visualFeedbackHint")}</p>
        <p className="mt-2">{t("visualFeedbackScopeHint")}</p>
      </div>
    </div>
  );
}
