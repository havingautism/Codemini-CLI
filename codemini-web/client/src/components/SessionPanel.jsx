import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '../../utils/time.js';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../i18n/index.js';

export function SessionPanel({ sessions, currentId, onSwitch, onNew, onDelete }) {
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await onDelete?.(pendingDelete.id);
    setDeleting(false);
    if (!result?.error) setPendingDelete(null);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-(--text-primary)">{t('sessions')}</h2>
        <Button size="sm" onClick={onNew} className="text-[13px]">+ {t('newChat')}</Button>
      </div>
      <ScrollArea className="h-[calc(100vh-160px)]">
        <div className="space-y-2">
          {allSessions.length === 0 && (
            <div className="text-center text-(--text-muted) text-[13px] py-8">{t('noSessions')}</div>
          )}
          {allSessions.map(session => (
            <div
              key={session.id}
              onClick={() => session.id !== currentId && onSwitch(session.id)}
              className={cn(
                'w-full text-left rounded-lg border border-(--border-default) p-3 transition-colors bg-(--bg-primary) cursor-pointer',
                session.id === currentId ? 'border-(--accent-blue)/30 bg-(--accent-blue-bg)' : 'hover:bg-(--bg-hover)'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-(--text-muted)">
                  {session.id?.slice(-12)}
                </span>
                <div className="flex items-center gap-2">
                  {session.id === currentId && (
                    <Badge variant="secondary" className="text-[11px]">{t('current')}</Badge>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={t('sessionActions')}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-36 border-(--border-default) bg-(--bg-primary) p-1 text-(--text-primary)"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="w-full rounded-md px-2.5 py-2 text-left text-[13px] text-(--accent-red) hover:bg-(--accent-red-bg)"
                        onClick={() => setPendingDelete(session)}
                      >
                        {t('deleteSession')}
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="text-[13px] font-medium truncate mt-1 text-(--text-primary)">
                {session.title || session.preview || (session.messageCount > 0 ? `${session.messageCount} ${t('messages')}` : t('emptyChat'))}
              </div>
              {session.updatedAt && (
                <div className="text-[11px] text-(--text-muted) mt-1">
                  {formatTimestamp(session.updatedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('deleteSessionConfirm')}
        description={pendingDelete ? t('deleteSessionDescription').replace('{{session}}', pendingDelete.title || pendingDelete.preview || pendingDelete.id || '') : ''}
        loading={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
