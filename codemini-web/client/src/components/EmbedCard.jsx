import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  ChatCircle,
  GitBranch,
  Play,
  Star,
} from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchEmbed } from "@/hooks/use-api.js";
import {
  BrandLogo,
  faviconUrl,
  getEmbedBrand,
  inferEmbedType,
  isKnownPlatform,
  shouldShowHeroImage,
} from "@/lib/embed-branding.jsx";

const embedCache = new Map();

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

function EmbedSkeleton({ variant = "default", url = "" }) {
  const brand = getEmbedBrand(inferEmbedType(url), url);
  const compact = variant === "banner";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-(--border-default)",
        compact ? "h-[100px]" : "my-3 min-h-[120px]",
      )}
    >
      <Skeleton
        className={cn("h-8 w-full shrink-0 rounded-none")}
        style={{ background: brand.headerBg }}
      />
      <div className={cn("flex flex-col gap-2 px-4 py-3", compact ? "min-h-[64px] flex-1" : "")}>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
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

function EmbedLinkPlaceholder() {
  return (
    <div
      className="flex size-12 shrink-0 items-center justify-center rounded-md border border-(--border-default) bg-(--bg-tertiary) text-(--text-muted)"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M2.5 12h19" />
        <path d="M12 2.5a15.3 15.3 0 0 1 4 9.5 15.3 15.3 0 0 1-4 9.5 15.3 15.3 0 0 1-4-9.5 15.3 15.3 0 0 1 4-9.5z" />
      </svg>
    </div>
  );
}

function EmbedCompactThumb({
  image,
  showHeroImage,
  ownerAvatar,
  resolvedType,
  brand,
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const placeholder = <EmbedLinkPlaceholder />;

  if (showHeroImage) {
    return (
      <EmbedHeroImage
        src={image}
        compact
        resolvedType={resolvedType}
        brand={brand}
        fallback={placeholder}
      />
    );
  }

  if (ownerAvatar && !avatarFailed) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-(--bg-tertiary)">
        <img
          src={ownerAvatar}
          alt=""
          loading="lazy"
          className="size-9 rounded-full ring-2 ring-(--bg-secondary)"
          onError={() => setAvatarFailed(true)}
        />
      </div>
    );
  }

  return placeholder;
}

function EmbedHeroImage({ src, compact, resolvedType, brand, fallback = null }) {
  const [visible, setVisible] = useState(true);

  if (!src || !visible) {
    if (compact && fallback) return fallback;
    return null;
  }

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
        "group block overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary) transition-colors hover:border-(--border-strong) hover:bg-(--bg-hover)",
        compact
          ? "flex h-full w-full min-w-0 flex-col"
          : "my-3 shadow-[var(--shadow-default)] hover:shadow-md",
      )}
    >
      <EmbedCardHeader brand={brand} url={url} compact={compact} />

      <div
        className={cn(
          "flex",
          compact
            ? "min-h-[64px] flex-1 items-center gap-2.5 px-3 py-2"
            : "min-h-[88px]",
        )}
      >
        {compact ? (
          <EmbedCompactThumb
            image={image}
            showHeroImage={showHeroImage}
            ownerAvatar={ownerAvatar}
            resolvedType={resolvedType}
            brand={brand}
          />
        ) : (
          <>
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
          </>
        )}

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center gap-0.5",
            compact ? "min-h-12" : "gap-1 px-3 py-2.5 sm:px-4 sm:py-3",
          )}
        >
          <div
            className={cn(
              "truncate font-semibold text-(--text-primary) group-hover:underline",
              compact ? "text-[13px] leading-snug" : "text-sm",
            )}
          >
            {displayTitle}
          </div>

          {compact ? (
            <div
              className={cn(
                "line-clamp-1 min-h-4 text-xs leading-snug",
                description
                  ? "text-(--text-secondary)"
                  : "text-transparent select-none",
              )}
            >
              {description || "\u00A0"}
            </div>
          ) : (
            description && (
              <div className="line-clamp-2 text-xs leading-relaxed text-(--text-secondary)">
                {description}
              </div>
            )
          )}

          {!compact && (
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
          )}
        </div>
      </div>
    </a>
  );
}

export function EmbedCard({ url, embed: presetEmbed, variant = "default" }) {
  const target = String(url || presetEmbed?.url || "").trim();
  const [embed, setEmbed] = useState(() => {
    const cached = target ? embedCache.get(target) : null;
    if (cached) return cached;
    if (presetEmbed && isRichEmbed(presetEmbed)) return presetEmbed;
    return null;
  });
  const [loading, setLoading] = useState(() => !embed && Boolean(target));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!target) return undefined;

    const cached = embedCache.get(target);
    if (cached) {
      setEmbed(cached);
      setLoading(false);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetchEmbed(target)
      .then((data) => {
        if (cancelled) return;
        if (data?.error) {
          if (presetEmbed) {
            setEmbed(presetEmbed);
          } else {
            setFailed(true);
            setEmbed(null);
          }
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
        if (!cancelled) {
          if (presetEmbed) setEmbed(presetEmbed);
          else setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, presetEmbed]);

  if (loading && !embed) return <EmbedSkeleton variant={variant} url={target} />;
  if (!embed) {
    if (failed && target) {
      return (
        <a
          href={target}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1 text-sm text-accent-blue hover:underline",
            variant === "default" && "my-3",
          )}
        >
          {target}
          <ArrowSquareOut size={13} />
        </a>
      );
    }
    return null;
  }

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
