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
              'relative flex min-h-11 min-w-0 items-center gap-3 px-1 py-2.5 text-[13px] leading-5',
              i < todos.length - 1 && "after:absolute after:right-1 after:bottom-0 after:left-9 after:h-px after:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] after:content-['']",
            )}
            role="listitem"
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative flex size-5 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,opacity] duration-150',
                completed && 'border-(--text-primary) bg-(--text-primary) text-(--bg-primary)',
                inProgress && 'border-[color:color-mix(in_srgb,var(--text-primary)_38%,transparent)] bg-transparent text-(--text-secondary)',
                !completed && !inProgress && 'border-[color:color-mix(in_srgb,var(--text-primary)_20%,transparent)] bg-transparent',
              )}
            >
              {completed ? <Check size={12} weight="bold" /> : null}
              {inProgress ? <span className="codemini-task-pulse size-1.5 rounded-full bg-current" /> : null}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 break-words font-normal tracking-[-0.006em] text-(--text-primary)',
                completed && 'text-(--text-muted) line-through decoration-[color:color-mix(in_srgb,var(--text-muted)_45%,transparent)]',
                inProgress && 'font-medium text-(--text-primary)',
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
