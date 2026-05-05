import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { t } from '../../i18n/index.js';

const ROLE_PILLS = {
  planner: 'bg-(--accent-purple-bg) text-(--accent-purple)',
  coder: 'bg-(--accent-green-bg) text-(--accent-green)',
  reviewer: 'bg-(--accent-orange-bg) text-(--accent-orange)',
  tester: 'bg-(--accent-blue-bg) text-(--accent-blue)',
  advisor: 'bg-(--accent-blue-bg) text-(--accent-blue)',
  summarizer: 'bg-(--accent-cyan-bg) text-(--accent-cyan)',
};

export function PlanProgress({ steps }) {
  if (!steps?.length) return null;

  const done = steps.filter(s => s.status === 'done').length;
  const allDone = done === steps.length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div className="border border-(--border-default) rounded-lg p-3 my-2 max-w-3xl mx-auto bg-(--bg-secondary)">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-medium text-(--text-primary)">{t('planTitle')}</span>
        <Badge className={cn('text-[11px]', allDone ? 'bg-(--accent-green-bg) text-(--accent-green)' : 'bg-(--accent-blue-bg) text-(--accent-blue)')}>
          {allDone ? t('planDone') : `${done}/${steps.length}`}
        </Badge>
      </div>
      <Progress value={pct} className="h-1.5 mb-3" />
      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0',
              step.status === 'done' && 'bg-(--accent-green-bg) text-(--accent-green)',
              step.status === 'failed' && 'bg-(--accent-red-bg) text-(--accent-red)',
              step.status === 'running' && 'bg-(--accent-blue-bg) text-(--accent-blue)',
              step.status === 'pending' && 'bg-(--muted) text-(--muted-foreground)'
            )}>
              {step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '▶' : step.index + 1}
            </span>
            <Badge variant="outline" className={cn('text-[11px] px-1.5 py-0', ROLE_PILLS[step.role] || 'bg-(--muted) text-(--muted-foreground)')}>
              {step.role}
            </Badge>
            <span className="truncate text-(--text-secondary)">{step.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
