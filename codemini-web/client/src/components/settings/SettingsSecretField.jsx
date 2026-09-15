import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '../../../i18n/index.js';

export function SettingsSecretField({ id, configured, draft, onChange, disabled }) {
  const [editing, setEditing] = useState(typeof draft === 'string' && draft.length > 0);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reset = () => { onChange(''); setEditing(false); setVisible(false); setConfirming(false); };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span role="status" className={`mr-auto text-sm ${configured ? 'text-(--accent-green)' : 'text-(--text-muted)'}`}>
        {t(configured ? 'secretConfigured' : 'secretNotConfigured')}
      </span>
      {!editing && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { onChange(''); setEditing(true); setConfirming(false); }}>{t(configured ? 'secretReplace' : 'secretAdd')}</Button>}
      {configured && !confirming && draft !== null && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(true)}>{t('secretClear')}</Button>}
    </div>
    {draft === null ? <div className="flex items-center gap-2 text-sm"><span>{t('secretPendingClear')}</span><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={reset}>{t('secretUndo')}</Button></div> : null}
    {editing && <>
      <div className="flex gap-2">
        <Input id={id} type={visible ? 'text' : 'password'} value={draft ?? ''} disabled={disabled} autoComplete="new-password" spellCheck={false} placeholder={t('secretPlaceholder')} onChange={e => onChange(e.target.value)} />
        <Button type="button" variant="outline" size="sm" aria-label={t(visible ? 'secretHide' : 'secretShow')} aria-pressed={visible} onClick={() => setVisible(!visible)}>{t(visible ? 'secretHide' : 'secretShow')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={reset}>{t('cancel')}</Button>
      </div>
      <p className="text-xs text-(--text-muted)">{t('secretKeepHint')}</p>
    </>}
    {confirming && <div role="group" aria-label={t('secretClear')} className="rounded-lg border border-(--border-default) p-3 space-y-2">
      <p className="text-sm">{t('secretClearConfirm')}</p>
      <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { onChange(null); setEditing(false); setVisible(false); setConfirming(false); }}>{t('secretConfirmClear')}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('cancel')}</Button></div>
    </div>}
    <p className="text-xs text-(--text-muted)">{t('secretStatusHint')}</p>
  </div>;
}
