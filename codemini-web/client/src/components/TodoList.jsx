import { cn } from '@/lib/utils';

export function TodoList({ todos }) {
  if (!todos?.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      {todos.map((todo, i) => {
        const statusIcon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '';
        return (
          <div key={i} className={cn(
            'flex items-center gap-2 text-[13px] py-0.5',
            todo.status === 'completed' && 'text-(--accent-green)',
            todo.status === 'in_progress' && 'text-(--accent-blue)',
            todo.status === 'pending' && 'text-(--muted-foreground)'
          )}>
            <span className="w-4 text-center shrink-0">{statusIcon}</span>
            <span>{todo.content || todo.activeForm}</span>
          </div>
        );
      })}
    </div>
  );
}
