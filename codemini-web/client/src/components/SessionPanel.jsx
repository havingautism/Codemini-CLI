import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '../../utils/time.js';

export function SessionPanel({ sessions, currentId, onSwitch, onNew }) {
  const allSessions = Array.isArray(sessions) ? sessions : [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-(--text-primary)">会话</h2>
        <Button size="sm" onClick={onNew} className="text-[13px]">+ 新建会话</Button>
      </div>
      <ScrollArea className="h-[calc(100vh-160px)]">
        <div className="space-y-2">
          {allSessions.length === 0 && (
            <div className="text-center text-(--text-muted) text-[13px] py-8">暂无对话</div>
          )}
          {allSessions.map(session => (
            <button
              key={session.id}
              onClick={() => session.id !== currentId && onSwitch(session.id)}
              disabled={session.id === currentId}
              className={cn(
                'w-full text-left rounded-lg border border-(--border-default) p-3 transition-colors bg-(--bg-primary) cursor-pointer',
                session.id === currentId ? 'border-(--accent-blue)/30 bg-(--accent-blue-bg)' : 'hover:bg-(--bg-hover)'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-(--text-muted)">
                  {session.id?.slice(-12)}
                </span>
                {session.id === currentId && (
                  <Badge variant="secondary" className="text-[11px]">当前</Badge>
                )}
              </div>
              <div className="text-[13px] font-medium truncate mt-1 text-(--text-primary)">
                {session.title || session.preview || (session.messageCount > 0 ? `${session.messageCount} 条消息` : '空对话')}
              </div>
              {session.updatedAt && (
                <div className="text-[11px] text-(--text-muted) mt-1">
                  {formatTimestamp(session.updatedAt)}
                </div>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
