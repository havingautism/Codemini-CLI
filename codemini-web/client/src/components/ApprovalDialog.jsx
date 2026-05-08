import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '../../i18n/index.js';

function detectVariant(toolName, details) {
  if (toolName === 'delete') return 'delete';
  if (toolName === 'run') return 'run';
  if (details?.planApproval) return 'plan';
  if (details?.reflectApproval) return 'reflect';
  return 'generic';
}

function parseArgs(args) {
  if (!args) return {};
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    return { ...obj, _raw: JSON.stringify(obj) };
  } catch { return { _raw: String(args) }; }
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="text-[13px] font-medium text-(--text-muted) w-20 shrink-0">{label}</span>
      <span className="text-[13px] font-mono break-all text-(--text-primary)">{String(value)}</span>
    </div>
  );
}

function ApprovalBody({ variant, args, details }) {
  if (variant === 'delete') {
    const parsed = parseArgs(args);
    return (
      <>
        <DetailRow label="File" value={parsed.path || parsed.name || '-'} />
        <DetailRow label="Type" value={parsed.type || 'file'} />
      </>
    );
  }
  if (variant === 'run') {
    const parsed = parseArgs(args);
    return (
      <>
        <DetailRow label="Command" value={parsed.command || '-'} />
        {details?.risk && <DetailRow label="Risk" value={details.risk} />}
        {details?.description && <DetailRow label="Info" value={details.description} />}
      </>
    );
  }
  if (variant === 'plan') {
    return (
      <>
        {details?.title && <p className="text-sm mb-2">{details.title}</p>}
        {details?.steps && (
          <ol className="list-decimal list-inside space-y-1">
            {details.steps.map((step, i) => (
              <li key={i} className="text-sm">{step.role || ''}: {step.title || ''}</li>
            ))}
          </ol>
        )}
      </>
    );
  }
  if (variant === 'reflect') {
    return (
      <>
        {details?.scope && <DetailRow label="Scope" value={details.scope} />}
        {details?.skillName && <DetailRow label="Skill" value={details.skillName} />}
        {details?.targetPath && <DetailRow label="Path" value={details.targetPath} />}
      </>
    );
  }
  const parsed = parseArgs(args);
  return <DetailRow label="Tool" value={parsed._raw || '-'} />;
}

export function ApprovalDialog({ request, open, onDecision }) {
  if (!request) return null;
  const { id, toolName, displayName, arguments: args, details } = request;
  const variant = detectVariant(toolName, details);

  const titles = {
    delete: t('deleteApproval'),
    run: t('runApproval'),
    plan: t('planApproval'),
    reflect: t('reflectApproval'),
    generic: t('approveTitle')
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDecision(id, false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titles[variant] || t('approveTitle')}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
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
