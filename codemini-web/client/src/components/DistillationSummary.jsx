import { t } from '../../i18n/index.js';

const probabilityLabel = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 100)}%`;

export default function DistillationSummary({ decision }) {
  if (!decision) return null;
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-(--text-muted)">
    <span>{t('distillationReview')} · {t(decision.mode === 'filter' ? 'distillationFilter' : 'distillationShadow')}</span>
    <span>{t('distillationReusable')}: {probabilityLabel(decision.reusableProbability)}</span>
    <span>{t('distillationDuplicate')}: {probabilityLabel(decision.duplicateProbability)}</span>
    <span>{t('distillationScope')}: {['user', 'project', 'global'].includes(decision.suggestedScope) ? t(`${decision.suggestedScope}Scope`) : '—'}</span>
  </div>;
}
