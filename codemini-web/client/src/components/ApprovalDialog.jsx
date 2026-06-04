import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReviewCommandBlock, ReviewSection } from '@/components/WorkflowReviewDialog.jsx';
import { t } from '../../i18n/index.js';

function riskDotClass(risk) {
  const level = String(risk || '').trim().toLowerCase();
  if (level === 'low') return 'bg-(--accent-green)';
  if (level === 'medium') return 'bg-yellow-500';
  if (level === 'high') return 'bg-(--accent-red)';
  return 'bg-(--text-muted)';
}

function detectVariant(toolName, details) {
  if (toolName === 'delete') return 'delete';
  if (toolName === 'run') return 'run';
  if (toolName === 'edit') return 'edit';
  if (toolName === 'create') return 'create';
  if (details?.planApproval) return 'plan';
  if (details?.reflectApproval) return 'reflect';
  return 'generic';
}

function parseArgs(args) {
  if (!args) return {};
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    return { ...obj, _raw: JSON.stringify(obj, null, 2) };
  } catch { return { _raw: String(args) }; }
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-3 py-1 min-w-0">
      <span className="text-[11px] font-medium text-(--text-muted) w-20 shrink-0">{label}</span>
      <span className="text-[12px] font-mono min-w-0 break-words text-(--text-primary)">{String(value)}</span>
    </div>
  );
}

function RiskDetailRow({ label, risk }) {
  if (!risk) return null;
  return (
    <div className="flex gap-3 py-1 min-w-0">
      <span className="text-[11px] font-medium text-(--text-muted) w-20 shrink-0">{label}</span>
      <span className="text-[12px] min-w-0 break-words text-(--text-primary) inline-flex items-center gap-2">
        <span
          className={cn('inline-block size-2 rounded-full shrink-0', riskDotClass(risk))}
          aria-hidden
        />
        <span className="font-mono capitalize">{String(risk)}</span>
      </span>
    </div>
  );
}

function PreviewRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="py-1.5 min-w-0">
      <div className="mb-1 text-[11px] font-medium text-(--text-muted)">{label}</div>
      <pre className="max-h-40 overflow-auto rounded-md border border-(--border-default) bg-(--bg-secondary) px-2.5 py-2 font-mono text-[12px] leading-5 text-(--text-primary) whitespace-pre-wrap break-words">
        {String(value)}
      </pre>
    </div>
  );
}

function ApprovalBody({ variant, args, details }) {
  const parsed = parseArgs(args);
  if (variant === 'delete') {
    return (
      <>
        <DetailRow label={t('approvalFieldFile')} value={parsed.path || parsed.name || '-'} />
        <DetailRow label={t('approvalFieldType')} value={parsed.type || 'file'} />
      </>
    );
  }
  if (variant === 'run') {
    return (
      <>
        <ReviewSection label={t('approvalFieldCommand')}>
          <ReviewCommandBlock
            command={parsed.command || '-'}
            className="max-h-[min(42vh,24rem)] overflow-auto overscroll-contain"
          />
        </ReviewSection>
        {details?.risk && <RiskDetailRow label={t('approvalFieldRisk')} risk={details.risk} />}
        {details?.evaluation?.recommendation && <DetailRow label={t('approvalFieldRecommend')} value={details.evaluation.recommendation} />}
        {details?.policyBlock?.reason && <DetailRow label={t('approvalFieldPolicy')} value={details.policyBlock.reason} />}
        {(details?.description || details?.evaluation?.description) && (
          <DetailRow label={t('approvalFieldInfo')} value={details.description || details.evaluation.description} />
        )}
        {details?.evaluation?.sideEffects && <DetailRow label={t('approvalFieldEffects')} value={details.evaluation.sideEffects} />}
      </>
    );
  }
  if (variant === 'edit') {
    const edit = parsed.edit && typeof parsed.edit === 'object' ? parsed.edit : {};
    const kind = parsed.kind || edit.kind || parsed.mode || 'edit';
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="edit" />
        <DetailRow label={t('approvalFieldFile')} value={parsed.file || parsed.path || '-'} />
        <DetailRow label={t('approvalFieldAction')} value={kind} />
        <PreviewRow label={t('approvalFieldOld')} value={parsed.old_text || parsed.old_string || edit.old_text || edit.old_string} />
        <PreviewRow label={t('approvalFieldNew')} value={parsed.new_text || parsed.new_string || edit.new_text || edit.new_string || edit.new_content || parsed.content} />
      </>
    );
  }
  if (variant === 'create') {
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="create" />
        <DetailRow label={t('approvalFieldFile')} value={parsed.file || parsed.path || '-'} />
        <PreviewRow label={t('approvalFieldContent')} value={parsed.content || parsed.text || parsed.body} />
      </>
    );
  }
  if (variant === 'plan') {
    return (
      <>
        {details?.title && <p className="mb-2 text-[13px] leading-6 text-(--text-secondary)">{details.title}</p>}
        {details?.steps && (
          <ol className="list-decimal list-inside space-y-1">
            {details.steps.map((step, i) => (
              <li key={i} className="text-[13px] leading-6 text-(--text-secondary)">{step.role || ''}: {step.title || ''}</li>
            ))}
          </ol>
        )}
      </>
    );
  }
  if (variant === 'reflect') {
    return (
      <>
        {details?.scope && <DetailRow label={t('approvalFieldScope')} value={details.scope} />}
        {details?.skillName && <DetailRow label={t('approvalFieldSkill')} value={details.skillName} />}
        {details?.targetPath && <DetailRow label={t('approvalFieldPath')} value={details.targetPath} />}
      </>
    );
  }
  return <PreviewRow label={t('approvalFieldArguments')} value={parsed._raw || '-'} />;
}

export function ApprovalDialog({ request, open, onDecision }) {
  if (!request) return null;
  const { id, toolName, displayName, arguments: args, details } = request;
  const variant = detectVariant(toolName, details);

  const titles = {
    delete: t('deleteApproval'),
    run: t('runApproval'),
    edit: t('editApproval'),
    create: t('createApproval'),
    write: t('writeApproval'),
    plan: t('planApproval'),
    reflect: t('reflectApproval'),
    generic: t('approveTitle')
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDecision(id, false); }}>
      <DialogContent
        className={cn(
          'max-h-[82vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden',
          variant === 'run' ? 'sm:max-w-2xl' : 'sm:max-w-xl',
        )}
      >
        <DialogHeader>
          <DialogTitle>{titles[variant] || t('approveTitle')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto py-1 pr-1">
          <ApprovalBody variant={variant} args={args} details={details} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onDecision(id, false)}>{t('deny')}</Button>
          <Button onClick={() => onDecision(id, true)}>{t('approve')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
