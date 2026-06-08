import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  ChatCircle,
  GitBranch,
  Play,
  Star,
} from "@phosphor-icons/react";
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
        "overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-secondary) animate-pulse",
        compact ? "min-h-[108px]" : "my-3 min-h-[120px]",
      )}
    >
      <div className="h-8" style={{ background: brand.headerBg }} />
      <div className={cn("px-4 py-3", compact ? "h-14" : "h-16")} />
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

function EmbedHeroImage({ src, compact, resolvedType, brand }) {
  const [visible, setVisible] = useState(true);

  if (!src || !visible) return null;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-(--bg-tertiary)",
        compact ? "w-[84px]" : "w-[132px] sm:w-[156px]",
      )}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
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

function EmbedCardHeader({ brand, url }) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    hostname = "";
  }

  const useFavicon = brand.key === "link";

  return (
    <div
      className="flex items-center gap-2 border-b border-(--border-default) px-3 py-2"
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
          ? "h-full"
          : "my-3 shadow-[var(--shadow-default)] hover:shadow-md",
      )}
    >
      <EmbedCardHeader brand={brand} url={url} />

      <div className={cn("flex", compact ? "min-h-[72px]" : "min-h-[88px]")}>
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

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="truncate text-sm font-semibold text-(--text-primary) group-hover:underline">
            {displayTitle}
          </div>

          {description && (
            <div
              className={cn(
                "text-xs leading-relaxed text-(--text-secondary)",
                compact ? "line-clamp-2" : "line-clamp-2",
              )}
            >
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
    <div className="my-2 space-y-2">
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
