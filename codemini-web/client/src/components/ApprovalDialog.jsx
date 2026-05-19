import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '../../i18n/index.js';

function detectVariant(toolName, details) {
  if (toolName === 'delete') return 'delete';
  if (toolName === 'run') return 'run';
  if (toolName === 'edit') return 'edit';
  if (toolName === 'write') return 'write';
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

function clip(value, max = 520) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-3 py-1.5 min-w-0">
      <span className="text-[13px] font-medium text-(--text-muted) w-20 shrink-0">{label}</span>
      <span className="text-[13px] font-mono min-w-0 break-words text-(--text-primary)">{String(value)}</span>
    </div>
  );
}

function PreviewRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="py-1.5 min-w-0">
      <div className="mb-1 text-[13px] font-medium text-(--text-muted)">{label}</div>
      <pre className="max-h-40 overflow-auto rounded-md border border-(--border-default) bg-(--bg-secondary) px-2.5 py-2 text-[12px] leading-5 text-(--text-primary) whitespace-pre-wrap break-words">
        {clip(value)}
      </pre>
    </div>
  );
}

function ApprovalBody({ variant, args, details }) {
  const parsed = parseArgs(args);
  if (variant === 'delete') {
    return (
      <>
        <DetailRow label="File" value={parsed.path || parsed.name || '-'} />
        <DetailRow label="Type" value={parsed.type || 'file'} />
      </>
    );
  }
  if (variant === 'run') {
    return (
      <>
        <DetailRow label="Command" value={parsed.command || '-'} />
        {details?.risk && <DetailRow label="Risk" value={details.risk} />}
        {details?.description && <DetailRow label="Info" value={details.description} />}
      </>
    );
  }
  if (variant === 'edit') {
    const edit = parsed.edit && typeof parsed.edit === 'object' ? parsed.edit : {};
    const kind = parsed.kind || edit.kind || parsed.mode || 'edit';
    return (
      <>
        <DetailRow label="Tool" value="edit" />
        <DetailRow label="File" value={parsed.file || parsed.path || '-'} />
        <DetailRow label="Action" value={kind} />
        <PreviewRow label="Old" value={parsed.old_text || edit.old_text} />
        <PreviewRow label="New" value={parsed.new_text || edit.new_text || edit.new_content || parsed.content} />
      </>
    );
  }
  if (variant === 'write') {
    return (
      <>
        <DetailRow label="Tool" value="write" />
        <DetailRow label="File" value={parsed.file || parsed.path || '-'} />
        <PreviewRow label="Content" value={parsed.content || parsed.text || parsed.body} />
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
  return <PreviewRow label="Arguments" value={parsed._raw || '-'} />;
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
      <DialogContent className="sm:max-w-xl max-h-[82vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
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
