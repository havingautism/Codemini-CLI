import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  ChatCircle,
  GitBranch,
  Play,
  Star,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { fetchEmbed } from "@/hooks/use-api.js";
import {
  cancelDeferred,
  deferUntilIdle,
  queueEmbedFetch,
} from "@/lib/embed-fetch-queue.js";
import {
  BrandLogo,
  faviconUrl,
  getEmbedBrand,
  inferEmbedType,
  isKnownPlatform,
  isShortLinkUrl,
  shouldShowHeroImage,
} from "@/lib/embed-branding.jsx";

const embedCache = new Map();
const failedEmbedCache = new Map();
const FAILED_EMBED_TTL_MS = 5 * 60 * 1000;
const EMBED_FETCH_STAGGER_MS = 60;

function readFailedEmbedCache(target) {
  const failedAt = failedEmbedCache.get(target);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILED_EMBED_TTL_MS) {
    failedEmbedCache.delete(target);
    return false;
  }
  return true;
}

function writeFailedEmbedCache(target) {
  failedEmbedCache.set(target, Date.now());
  if (failedEmbedCache.size > 200) {
    const oldest = failedEmbedCache.keys().next().value;
    if (oldest) failedEmbedCache.delete(oldest);
  }
}

function shouldFetchEmbed(target, presetEmbed) {
  if (!target) return false;
  if (embedCache.has(target)) return false;
  if (readFailedEmbedCache(target)) return false;
  if (isShortLinkUrl(target)) return false;
  if (presetEmbed && hasSufficientEmbedMeta(presetEmbed)) return false;
  return true;
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildImmediateEmbed(target, presetEmbed) {
  if (presetEmbed && hasSufficientEmbedMeta(presetEmbed)) {
    return {
      ...presetEmbed,
      type: inferEmbedType(presetEmbed.url || target, presetEmbed.type),
      title: presetEmbed.title || target,
      description: presetEmbed.description || "",
    };
  }

  const hostname = hostnameFromUrl(target);
  return {
    type: inferEmbedType(target),
    url: target,
    title: presetEmbed?.title || hostname || target,
    description: presetEmbed?.description || "",
    siteName: presetEmbed?.siteName || hostname,
    image: presetEmbed?.image || null,
    meta: presetEmbed?.meta || {},
  };
}

function deferEmbedWork(callback, deferIndex = 0) {
  const delayMs = Math.min(deferIndex, 16) * EMBED_FETCH_STAGGER_MS;
  return deferUntilIdle(() => {
    window.setTimeout(callback, delayMs);
  }, { timeout: 2000 + delayMs });
}

function formatCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (num >= 1_000_000)
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(num);
}

function isRichEmbed(data) {
  if (!data || typeof data !== "object") return false;
  const resolved = inferEmbedType(data.url, data.type);
  if (["youtube", "github", "reddit", "instagram", "x", "facebook", "tiktok", "linkedin"].includes(resolved)) {
    if (resolved === "github") return data.meta?.stars != null;
    return true;
  }
  return Boolean(data.image || data.description);
}

function hasSufficientEmbedMeta(data) {
  if (!data || typeof data !== "object") return false;
  if (isRichEmbed(data)) return true;
  const title = String(data.title || "").trim();
  const url = String(data.url || "").trim();
  return Boolean(title && title !== url);
}

function MetaPill({ children, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-(--bg-tertiary) px-2 py-0.5 text-[11px] font-medium text-(--text-secondary)",
        className,
      )}
    >
      {children}
    </span>
  );
}

const MEDIA_PREVIEW_TYPES = new Set(["youtube", "instagram", "tiktok"]);

function EmbedHeroImage({ src, compact, resolvedType, brand }) {
  const [visible, setVisible] = useState(true);

  if (!src || !visible) return null;

  const mediaPreview = MEDIA_PREVIEW_TYPES.has(resolvedType);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-(--bg-tertiary)",
        compact
          ? "size-12 rounded-md"
          : "w-[132px] sm:w-[156px]",
      )}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn(
          "h-full w-full",
          compact && !mediaPreview
            ? "object-contain p-1"
            : "object-cover",
        )}
        onError={() => setVisible(false)}
      />
      {resolvedType === "youtube" && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <span
            className="flex size-8 items-center justify-center rounded-full text-white"
            style={{ background: brand.accent }}
          >
            <Play size={14} weight="fill" />
          </span>
        </span>
      )}
      {resolvedType === "instagram" && (
        <span className="absolute inset-0 bg-linear-to-t from-black/35 to-transparent" />
      )}
    </div>
  );
}

function EmbedAvatar({ src, compact, brand }) {
  const [visible, setVisible] = useState(true);

  if (!src || !visible) return null;

  return (
    <div
      className="flex shrink-0 items-center justify-center px-3"
      style={{ background: brand.badgeBg }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn(
          "rounded-full ring-2 ring-(--bg-secondary)",
          compact ? "size-9" : "size-12",
        )}
        onError={() => setVisible(false)}
      />
    </div>
  );
}

function EmbedCardHeader({ brand, url, compact = false }) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    hostname = "";
  }

  const useFavicon = brand.key === "link";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-(--border-default) px-3",
        compact ? "py-1.5" : "py-2",
      )}
      style={{ background: brand.headerBg }}
    >
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
        style={{
          background: brand.iconBg,
          color: brand.iconColor,
        }}
      >
        {useFavicon ? (
          <img
            src={faviconUrl(url)}
            alt=""
            className="size-3.5 rounded-sm"
            loading="lazy"
          />
        ) : (
          <BrandLogo brandKey={brand.key} size={14} />
        )}
      </span>
      <span
        className="text-[11px] font-semibold uppercase tracking-[0.06em]"
        style={{ color: brand.headerText }}
      >
        {brand.label}
      </span>
      {hostname && (
        <span className="min-w-0 truncate text-[11px] text-(--text-muted)">
          {hostname}
        </span>
      )}
      <ArrowSquareOut
        size={13}
        className="ml-auto shrink-0 text-(--text-muted) opacity-60"
      />
    </div>
  );
}

function EmbedCardBody({ embed, variant = "default" }) {
  const compact = variant === "banner";
  const { type, url, title, description, image, siteName, meta = {} } = embed;

  const brand = getEmbedBrand(type, url);
  const resolvedType = inferEmbedType(url, type);
  const showHeroImage = shouldShowHeroImage(type, url, image);
  const ownerAvatar = resolvedType === "github" ? image : null;

  const displayTitle =
    resolvedType === "github" && meta.owner && meta.repo
      ? `${meta.owner}/${meta.repo}`
      : title || url;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block overflow-hidden rounded-xl border bg-(--bg-secondary) transition-colors hover:bg-(--bg-hover)",
        compact
          ? "flex h-full w-full min-w-0 flex-col"
          : "my-3 shadow-[var(--shadow-default)] hover:shadow-md",
        brand.key === "link" && "border-(--border-default) hover:border-(--border-strong)",
      )}
      style={
        brand.key === "link"
          ? undefined
          : {
              borderColor: `color-mix(in srgb, ${brand.accent} 34%, var(--border-default))`,
            }
      }
    >
      <EmbedCardHeader brand={brand} url={url} compact={compact} />

      {compact ? (
        <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
          <div
            className="truncate text-[13px] font-semibold leading-snug text-(--text-primary) group-hover:underline"
          >
            {displayTitle}
          </div>
          <div
            className={cn(
              "line-clamp-2 text-xs leading-snug",
              description
                ? "text-(--text-secondary)"
                : "text-transparent select-none",
            )}
          >
            {description || "\u00A0"}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[88px]">
          {showHeroImage && (
            <EmbedHeroImage
              src={image}
              compact={compact}
              resolvedType={resolvedType}
              brand={brand}
            />
          )}
          {ownerAvatar && (
            <EmbedAvatar src={ownerAvatar} compact={compact} brand={brand} />
          )}

          <div
            className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5 sm:px-4 sm:py-3"
          >
            <div
              className="truncate text-sm font-semibold text-(--text-primary) group-hover:underline"
            >
              {displayTitle}
            </div>

            {description && (
              <div className="line-clamp-2 text-xs leading-relaxed text-(--text-secondary)">
                {description}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {siteName && !isKnownPlatform(resolvedType, url) && (
                <MetaPill>{siteName}</MetaPill>
              )}
              {resolvedType === "github" && meta.language && (
                <MetaPill>
                  <span className="inline-block size-2 rounded-full bg-(--accent-blue)" />
                  {meta.language}
                </MetaPill>
              )}
              {resolvedType === "github" && meta.stars != null && (
                <MetaPill>
                  <Star size={12} weight="fill" className="text-amber-500" />
                  {formatCount(meta.stars)}
                </MetaPill>
              )}
              {resolvedType === "github" && meta.forks != null && (
                <MetaPill>
                  <GitBranch size={12} />
                  {formatCount(meta.forks)}
                </MetaPill>
              )}
              {resolvedType === "reddit" && meta.score != null && (
                <MetaPill>↑ {formatCount(meta.score)}</MetaPill>
              )}
              {resolvedType === "reddit" && meta.comments != null && (
                <MetaPill>
                  <ChatCircle size={12} />
                  {formatCount(meta.comments)}
                </MetaPill>
              )}
            </div>
          </div>
        </div>
      )}
    </a>
  );
}

export function EmbedCard({
  url,
  embed: presetEmbed,
  variant = "default",
  deferIndex = 0,
}) {
  const target = String(url || presetEmbed?.url || "").trim();
  const [embed, setEmbed] = useState(() => {
    const cached = target ? embedCache.get(target) : null;
    if (cached) return cached;
    if (!target) return null;
    return buildImmediateEmbed(target, presetEmbed);
  });

  useEffect(() => {
    if (!target) return undefined;

    const cached = embedCache.get(target);
    if (cached) {
      setEmbed(cached);
      return undefined;
    }

    if (variant === "banner" || !shouldFetchEmbed(target, presetEmbed)) {
      setEmbed(buildImmediateEmbed(target, presetEmbed));
      return undefined;
    }

    let cancelled = false;

    const runFetch = () => {
      if (cancelled) return;
      queueEmbedFetch(() => fetchEmbed(target))
        .then((data) => {
          if (cancelled) return;
          if (data?.error) {
            writeFailedEmbedCache(target);
            return;
          }
          embedCache.set(target, data);
          setEmbed({
            ...data,
            type: inferEmbedType(data.url, data.type),
            title: data.title || presetEmbed?.title || target,
            description: data.description || presetEmbed?.description || "",
          });
        })
        .catch(() => {
          if (!cancelled) writeFailedEmbedCache(target);
        });
    };

    const idleId = deferEmbedWork(runFetch, deferIndex);

    return () => {
      cancelled = true;
      cancelDeferred(idleId);
    };
  }, [target, presetEmbed, deferIndex, variant]);

  if (!embed) return null;

  return <EmbedCardBody embed={embed} variant={variant} />;
}

export function EmbedCardList({ items = [], compact = true }) {
  if (!items.length) return null;
  return (
    <div className="my-2 flex flex-col gap-2">
      {items.map((item, index) => (
        <EmbedCard
          key={`${item.url || "item"}-${index}`}
          url={item.url}
          embed={item}
          variant={compact ? "banner" : "default"}
        />
      ))}
    </div>
  );
}
