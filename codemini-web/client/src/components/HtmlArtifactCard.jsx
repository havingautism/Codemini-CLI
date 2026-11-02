import { memo, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowsOutSimple,
  Monitor,
} from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/context/app-context.jsx";
import { buildHtmlArtifactUrl } from "@/hooks/use-api.js";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const ICON_BUTTON_CLASS =
  "flex size-7 items-center justify-center rounded-md text-(--text-muted) transition-[background-color,color,transform] duration-100 hover:bg-(--bg-hover) hover:text-(--text-primary) active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--text-primary) motion-reduce:transform-none motion-reduce:transition-none";

function artifactFrame({ title, url, height, revision, fullscreen, onLoad, onError }) {
  return (
    <iframe
      key={`${revision}:${fullscreen ? "fullscreen" : "inline"}`}
      title={title}
      src={url}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={cn(
        "w-full border-0 bg-white",
        fullscreen ? "h-full min-h-0 flex-1" : "rounded-b-lg",
      )}
      style={fullscreen ? undefined : { height }}
      onLoad={onLoad}
      onError={onError}
    />
  );
}

export const HtmlArtifactCard = memo(function HtmlArtifactCard({ card }) {
  const { state } = useApp();
  const meta = card?.resultMeta || {};
  const artifactPath = String(meta.path || "").trim();
  const title = String(meta.title || artifactPath || t("htmlArtifactTitle")).trim();
  const height = Math.min(900, Math.max(320, Number(meta.height) || 560));
  const [fullscreen, setFullscreen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [frameError, setFrameError] = useState(false);
  const url = buildHtmlArtifactUrl(
    state.currentSessionId,
    artifactPath,
    revision,
  );
  const reload = () => {
    setFrameError(false);
    setRevision((value) => value + 1);
  };
  const frameProps = {
    title,
    url,
    height,
    revision,
    onLoad: () => setFrameError(false),
    onError: () => setFrameError(true),
  };

  return (
    <div className="overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-primary) shadow-[0_10px_36px_rgba(0,0,0,0.08)]">
      <div className="flex min-h-12 items-center gap-2 border-b border-(--border-default) px-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-(--bg-secondary) text-(--text-primary)">
            <Monitor size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-(--text-primary)">
              {title}
            </span>
            <span className="block truncate font-mono text-[10px] text-(--text-muted)">
              {artifactPath}
            </span>
          </span>
          <span className="hidden shrink-0 rounded-full border border-(--border-default) px-2 py-0.5 text-[10px] text-(--text-muted) sm:inline-flex">
            {t("htmlArtifactIsolated")}
          </span>
        </div>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          onClick={reload}
          aria-label={t("htmlArtifactReload")}
          title={t("htmlArtifactReload")}
        >
          <ArrowClockwise size={14} aria-hidden="true" />
        </button>
        <a
          className={ICON_BUTTON_CLASS}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t("htmlArtifactOpenWindow")}
          title={t("htmlArtifactOpenWindow")}
        >
          <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          onClick={() => setFullscreen(true)}
          aria-label={t("htmlArtifactFullscreen")}
          title={t("htmlArtifactFullscreen")}
        >
          <ArrowsOutSimple size={14} aria-hidden="true" />
        </button>
      </div>

      {frameError ? (
        <div className="px-4 py-6 text-center text-[12px] text-(--accent-red)">
          {t("htmlArtifactLoadFailed")}
        </div>
      ) : null}
      {!fullscreen && !frameError
        ? artifactFrame({ ...frameProps, fullscreen: false })
        : null}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[94vh] w-[96vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex-row items-center gap-3 border-b border-(--border-default) px-4 py-3 text-left">
            <DialogTitle className="min-w-0 flex-1 truncate text-[14px]">
              {title}
            </DialogTitle>
            <span className="shrink-0 rounded-full border border-(--border-default) px-2 py-0.5 text-[10px] font-normal text-(--text-muted)">
              {t("htmlArtifactIsolated")}
            </span>
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              onClick={reload}
              aria-label={t("htmlArtifactReload")}
              title={t("htmlArtifactReload")}
            >
              <ArrowClockwise size={14} aria-hidden="true" />
            </button>
          </DialogHeader>
          {fullscreen
            ? artifactFrame({ ...frameProps, fullscreen: true })
            : null}
        </DialogContent>
      </Dialog>
    </div>
  );
});
