import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '../../utils/time.js';
import { DotsThree, HandPalm, Warning } from "@/lib/icons";
import { useState } from 'react';
import { t } from '../../i18n/index.js';
import { ACTIVE_SESSION_STATUSES } from '@/lib/session-ui-state.js';

export function SessionPanel({
  sessions,
  sessionsLoading,
  currentId,
  onSwitch,
  onNew,
  onDelete,
  onAbort,
  onAbortAll,
}) {
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const generalSessions = allSessions.filter((session) => session.isGeneral);
  const projectSessions = allSessions.filter((session) => !session.isGeneral);
  const orderedSessions = [...generalSessions, ...projectSessions];
  const hasActiveSessions = allSessions.some((session) =>
    ACTIVE_SESSION_STATUSES.has(session.runtimeStatus),
  );
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [abortError, setAbortError] = useState("");

  const abortFailureMessage = (count) =>
    t("abortSessionsFailed").replace("{{count}}", String(count));

  const handleAbort = async (sessionId) => {
    setAbortError("");
    try {
      await onAbort(sessionId);
    } catch {
      setAbortError(abortFailureMessage(1));
    }
  };

  const handleAbortAll = async () => {
    setAbortError("");
    try {
      await onAbortAll();
    } catch (error) {
      const failedCount =
        error instanceof AggregateError && error.errors.length
          ? error.errors.length
          : 1;
      setAbortError(abortFailureMessage(failedCount));
    }
  };

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
        <div className="flex items-center gap-2">
          {hasActiveSessions ? (
            <Button variant="destructive" onClick={handleAbortAll}>
              {t("abortAllSessions")}
            </Button>
          ) : null}
          <Button onClick={onNew}>+ {t('newChat')}</Button>
        </div>
      </div>
      {abortError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{abortError}</AlertDescription>
        </Alert>
      ) : null}
      <ScrollArea className="h-[calc(100vh-160px)]">
        <div className="flex flex-col gap-2">
          {sessionsLoading && allSessions.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          )}
          {!sessionsLoading && allSessions.length === 0 && (
            <div className="text-center text-(--text-muted) text-[13px] py-8">{t('noSessions')}</div>
          )}
          {orderedSessions.map(session => (
            <div
              key={session.id}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border border-(--border-default) p-3 transition-colors bg-(--bg-primary)',
                session.id === currentId ? 'border-(--selected-edge) bg-(--selected-bg)' : 'hover:bg-(--bg-hover)'
              )}
            >
              <button
                type="button"
                onClick={() =>
                  session.id !== currentId && onSwitch(session.id)
                }
                className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <span className="block font-mono text-[11px] text-(--text-muted)">
                  {session.id?.slice(-12)}
                </span>
                <span className="mt-1 block truncate text-[13px] font-medium text-(--text-primary)">
                  {session.title || session.preview || (session.messageCount > 0 ? `${session.messageCount} ${t('messages')}` : t('emptyChat'))}
                </span>
                {session.updatedAt ? (
                  <span className="mt-1 block text-[11px] text-(--text-muted)">
                    {formatTimestamp(session.updatedAt)}
                  </span>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">
                    {session.isGeneral ? t("generalChat") : t("projects")}
                  </Badge>
                  <Badge
                    variant={session.needsAttention ? "destructive" : "secondary"}
                    aria-label={
                      session.runtimeStatus === "queued"
                        ? t("sessionQueuedPosition").replace(
                            "{{position}}",
                            String(session.queuePosition),
                          )
                        : t(`sessionStatus_${session.runtimeStatus || "idle"}`)
                    }
                  >
                    {session.runtimeStatus === "queued"
                      ? t("sessionQueuedPosition").replace(
                          "{{position}}",
                          String(session.queuePosition),
                        )
                      : t(`sessionStatus_${session.runtimeStatus || "idle"}`)}
                  </Badge>
                  {session.needsAttention ? (
                    <HandPalm
                      aria-label={t("sessionNeedsAttention")}
                      className="text-(--accent-red)"
                    />
                  ) : null}
                  {session.parallelWriteRisk ? (
                    <Warning
                      aria-label={t("parallelWriteWarning")}
                      className="text-(--accent-yellow)"
                    />
                  ) : null}
                  {session.id === currentId && (
                    <Badge variant="secondary" className="text-[11px]">{t('current')}</Badge>
                  )}
                  {ACTIVE_SESSION_STATUSES.has(session.runtimeStatus) ? (
                    <Button
                      variant="outline"
                      onClick={async (event) => {
                        event.stopPropagation();
                        await handleAbort(session.id);
                      }}
                      aria-label={t("abortSession")}
                    >
                      {t("abort")}
                    </Button>
                  ) : null}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={t('sessionActions')}
                      >
                        <DotsThree size={15} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-36 rounded-md p-1"
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
