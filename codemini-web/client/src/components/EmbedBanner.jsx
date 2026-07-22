import { useEffect, useState } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import { EmbedCard } from "@/components/EmbedCard.jsx";
import { HorizontalScrollStrip } from "@/components/HorizontalScrollStrip.jsx";
import { cancelDeferred, deferUntilIdle } from "@/lib/embed-fetch-queue.js";
import { embedBannerContentKey } from "@/lib/embed-banner-key.js";
import { t } from "../../i18n/index.js";

export function EmbedBanner({ items = [] }) {
  const contentKey = embedBannerContentKey(items);
  const links = items.filter((item) => item?.type !== "image");
  const fitsWithoutScroll = links.length <= 3;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!contentKey) {
      setReady(false);
      return undefined;
    }

    setReady(false);
    const idleId = deferUntilIdle(() => setReady(true), { timeout: 1200 });
    return () => {
      cancelDeferred(idleId);
    };
  }, [contentKey]);

  if (!links.length) return null;
  if (!ready) return null;

  const cards = links.map((item, index) => (
    <div
      key={`${item.url || "embed"}-${index}`}
      className={
        fitsWithoutScroll
          ? "min-w-0"
          : "w-[288px] shrink-0 sm:w-[300px]"
      }
    >
      <EmbedCard
        url={item.url}
        embed={item}
        variant="banner"
        deferIndex={index}
      />
    </div>
  ));

  return (
    <div className="mt-4">
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-(--text-muted)">
        <LinkSimple size={13} className="shrink-0" />
        <span>{t("relatedLinks")}</span>
      </div>

      {fitsWithoutScroll ? (
        <div className="grid grid-cols-3 gap-3 px-0.5">
          {cards}
        </div>
      ) : (
        <HorizontalScrollStrip>{cards}</HorizontalScrollStrip>
      )}
    </div>
  );
}
