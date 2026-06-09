import { LinkSimple } from '@phosphor-icons/react';
import { EmbedCard } from '@/components/EmbedCard.jsx';
import { t } from '../../i18n/index.js';

export function EmbedBanner({ items = [] }) {
  if (!items.length) return null;

  return (
    <div className="my-4">
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-(--text-muted)">
        <LinkSimple size={13} className="shrink-0" />
        <span>{t('relatedLinks')}</span>
      </div>

      <div className="codemini-embed-banner-scroll flex items-stretch gap-3 px-0.5">
        {items.map((item, index) => (
          <div
            key={`${item.url || 'embed'}-${index}`}
            className="w-[288px] shrink-0 sm:w-[300px]"
          >
            <EmbedCard url={item.url} embed={item} variant="banner" />
          </div>
        ))}
      </div>
    </div>
  );
}
