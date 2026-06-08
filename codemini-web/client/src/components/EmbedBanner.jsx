import { useCallback, useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, LinkSimple } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EmbedCard } from '@/components/EmbedCard.jsx';
import { t } from '../../i18n/index.js';

function updateScrollState(node, setLeft, setRight) {
  if (!node) return;
  const maxScroll = node.scrollWidth - node.clientWidth;
  setLeft(node.scrollLeft > 4);
  setRight(maxScroll - node.scrollLeft > 4);
}

export function EmbedBanner({ items = [] }) {
  const scrollerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const refresh = useCallback(() => {
    updateScrollState(scrollerRef.current, setCanScrollLeft, setCanScrollRight);
  }, []);

  useEffect(() => {
    refresh();
    const node = scrollerRef.current;
    if (!node) return undefined;
    node.addEventListener('scroll', refresh, { passive: true });
    const observer = new ResizeObserver(refresh);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', refresh);
      observer.disconnect();
    };
  }, [items.length, refresh]);

  const scrollByPage = (direction) => {
    const node = scrollerRef.current;
    if (!node) return;
    const amount = Math.max(280, node.clientWidth * 0.85) * direction;
    node.scrollBy({ left: amount, behavior: 'smooth' });
  };

  if (!items.length) return null;

  return (
    <div className="my-4">
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-(--text-muted)">
        <LinkSimple size={13} className="shrink-0" />
        <span>{t('relatedLinks')}</span>
      </div>

      <div className="relative">
        {canScrollLeft && (
        <button
          type="button"
          aria-label="Previous link card"
          onClick={() => scrollByPage(-1)}
          className="absolute left-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-(--border-default) bg-(--bg-primary)/95 text-(--text-secondary) shadow-[var(--shadow-default)] backdrop-blur hover:bg-(--bg-hover) hover:text-(--text-primary)"
        >
          <CaretLeft size={16} />
        </button>
      )}

      {canScrollRight && (
        <button
          type="button"
          aria-label="Next link card"
          onClick={() => scrollByPage(1)}
          className="absolute right-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-(--border-default) bg-(--bg-primary)/95 text-(--text-secondary) shadow-[var(--shadow-default)] backdrop-blur hover:bg-(--bg-hover) hover:text-(--text-primary)"
        >
          <CaretRight size={16} />
        </button>
      )}

      <div
        ref={scrollerRef}
        className={cn(
          'flex gap-3 overflow-x-auto scroll-smooth px-0.5 pb-1',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          canScrollLeft && 'pl-9',
          canScrollRight && 'pr-9',
        )}
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {items.map((item, index) => (
          <div
            key={`${item.url || 'embed'}-${index}`}
            className="w-[min(100%,320px)] shrink-0 snap-start sm:w-[340px]"
          >
            <EmbedCard url={item.url} embed={item} variant="banner" />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
