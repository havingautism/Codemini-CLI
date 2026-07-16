import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ReviewCommandBlock, ReviewSection } from '@/components/WorkflowReviewDialog.jsx';
import { t } from '../../i18n/index.js';
import { CHAT_ACTION_NAMES } from '@/lib/chat-action-names.js';

function riskDotClass(risk) {
  const level = String(risk || '').trim().toLowerCase();
  if (level === 'low') return 'bg-(--accent-green)';
  if (level === 'medium') return 'bg-(--accent-amber)';
  if (level === 'high') return 'bg-(--accent-red)';
  return 'bg-(--text-muted)';
}

function detectVariant(toolName, details) {
  if (toolName === 'delete') return 'delete';
  if (toolName === 'run') return 'run';
  if (toolName === 'edit') return 'edit';
  if (toolName === 'create') return 'create';
  if (toolName === 'write') return 'write';
  if (toolName === 'apply_patch') return 'apply_patch';
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

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
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
    const kind = parsed.kind || parsed.mode || 'edit';
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="edit" />
        <DetailRow label={t('approvalFieldFile')} value={parsed.path || '-'} />
        <DetailRow label={t('approvalFieldAction')} value={kind} />
        <PreviewRow label={t('approvalFieldOld')} value={parsed.old_text} />
        <PreviewRow label={t('approvalFieldNew')} value={parsed.new_text || parsed.new_content || parsed.content} />
      </>
    );
  }
  if (variant === 'create') {
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="create" />
        <DetailRow label={t('approvalFieldFile')} value={parsed.path || '-'} />
        <PreviewRow label={t('approvalFieldContent')} value={parsed.content} />
      </>
    );
  }
  if (variant === 'write') {
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="write" />
        <DetailRow label={t('approvalFieldFile')} value={parsed.path || '-'} />
        <DetailRow label={t('approvalFieldAction')} value={parsed.overwrite ? 'overwrite' : 'write'} />
        <PreviewRow label={t('approvalFieldContent')} value={parsed.content} />
      </>
    );
  }
  if (variant === 'apply_patch') {
    const patchText = String(parsed.patch_text || '');
    const files = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((match) => match[1])
      .filter(Boolean);
    return (
      <>
        <DetailRow label={t('approvalFieldTool')} value="apply_patch" />
        {files.length > 0 && <DetailRow label={t('approvalFieldFile')} value={files.join(', ')} />}
        <PreviewRow label={t('approvalFieldContent')} value={patchText} />
      </>
    );
  }
  if (variant === 'plan') {
    return (
      <>
        {details?.title && <p className="mb-2 text-[13px] leading-6 text-(--text-secondary)">{details.title}</p>}
        {details?.steps && (
          <ol className="list-decimal list-inside flex flex-col gap-1">
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
  const [submitting, setSubmitting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    // Only reset when a new request arrives. Keep the lock when request clears
    // so Dialog close/unmount cannot emit a second reject.
    if (!request?.id) return;
    submittingRef.current = false;
    setSubmitting(false);
    setFeedbackOpen(false);
    setFeedback('');
  }, [request?.id]);

  if (!request) return null;
  const { id, toolName, displayName, arguments: args, details } = request;
  const variant = detectVariant(toolName, details);
  const hasApprovalShortcuts = ['delete', 'run', 'edit', 'create', 'write', 'apply_patch'].includes(variant);

  const decide = (actionName, payload = {}) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    onDecision(id, actionName, payload);
  };

  const handleKeyDownCapture = (event) => {
    if (!hasApprovalShortcuts || submittingRef.current) return;
    if (event.defaultPrevented || event.repeat) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (feedbackOpen) {
        setFeedbackOpen(false);
        return;
      }
      decide(CHAT_ACTION_NAMES.APPROVAL_REJECT);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !isEditableTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      decide(CHAT_ACTION_NAMES.APPROVAL_APPROVE);
    }
  };

  const titles = {
    delete: t('deleteApproval'),
    run: t('runApproval'),
    edit: t('editApproval'),
    create: t('createApproval'),
    write: t('writeApproval'),
    apply_patch: t('writeApproval'),
    plan: t('planApproval'),
    reflect: t('reflectApproval'),
    generic: t('approveTitle')
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Ignore programmatic close after Allow/Deny already submitted.
        if (!v && request?.id && !submittingRef.current) {
          decide(CHAT_ACTION_NAMES.APPROVAL_REJECT);
        }
      }}
    >
      <DialogContent
        onKeyDownCapture={handleKeyDownCapture}
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
        <div className="flex flex-col gap-3">
          {feedbackOpen && (
            <div className="rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3">
              <label htmlFor="approval-feedback" className="mb-2 block text-[12px] font-medium text-(--text-secondary)">
                {t('approvalFeedbackPrompt')}
              </label>
              <Textarea
                id="approval-feedback"
                autoFocus
                value={feedback}
                placeholder={t('approvalFeedbackPlaceholder')}
                onChange={(event) => setFeedback(event.target.value)}
                className="min-h-20 bg-(--bg-primary)"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            {feedbackOpen ? (
              <>
                <Button variant="ghost" disabled={submitting} onClick={() => setFeedbackOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  disabled={submitting || !feedback.trim()}
                  onClick={() => decide(CHAT_ACTION_NAMES.APPROVAL_REJECT, { reason: feedback.trim() })}
                >
                  {t('approvalFeedbackSubmit')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={submitting}
                  onClick={() => decide(CHAT_ACTION_NAMES.APPROVAL_REJECT)}
                >
                  {t('deny')}
                  {hasApprovalShortcuts && (
                    <span className="ml-1.5 text-[11px] font-mono opacity-70">Esc</span>
                  )}
                </Button>
                <Button variant="ghost" disabled={submitting} onClick={() => setFeedbackOpen(true)}>
                  {t('approvalFeedback')}
                </Button>
                <Button
                  disabled={submitting}
                  onClick={() => decide(CHAT_ACTION_NAMES.APPROVAL_APPROVE)}
                >
                  {t('approve')}
                  {hasApprovalShortcuts && (
                    <span className="ml-1.5 text-[13px] leading-none opacity-80">↩︎</span>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
