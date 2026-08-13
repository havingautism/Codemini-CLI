import { Check } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export function TodoList({ todos }) {
  if (!todos?.length) return null;

  return (
    <div className="flex flex-col gap-0.5" role="list">
      {todos.map((todo, i) => {
        const completed = todo.status === 'completed';
        const inProgress = todo.status === 'in_progress';
        return (
          <div
            key={i}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-lg px-2.5 py-2 text-[13px] leading-5',
              inProgress && 'bg-(--bg-secondary)',
            )}
            role="listitem"
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                completed && 'border-primary bg-primary text-primary-foreground',
                inProgress && 'border-(--text-muted) bg-(--bg-primary)',
                !completed && !inProgress && 'border-(--border-default) bg-(--bg-primary)',
              )}
            >
              {completed ? <Check size={12} weight="bold" /> : null}
              {inProgress ? <span className="size-1.5 rounded-full bg-(--text-secondary)" /> : null}
            </span>
            <span
              className={cn(
                'min-w-0 break-words text-(--text-primary)',
                completed && 'text-(--text-muted) line-through decoration-[color:color-mix(in_srgb,var(--text-muted)_60%,transparent)]',
                inProgress && 'font-medium',
              )}
            >
              {todo.content || todo.activeForm}
            </span>
          </div>
        );
      })}
    </div>
  );
}
