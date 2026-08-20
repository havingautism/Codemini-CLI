import { useState } from "react";
import { CaretDown, Check, ListBullets } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

function countTodosByStatus(todos = []) {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const todo of todos) {
    if (todo.status === "completed") completed += 1;
    else if (todo.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { pending, inProgress, completed };
}

function formatTodoStatusSummary(todos = []) {
  const { pending, inProgress, completed } = countTodosByStatus(todos);
  const parts = [];
  if (inProgress > 0) {
    parts.push(t("tasksInProgress").replace("{count}", String(inProgress)));
  }
  if (pending > 0) {
    parts.push(t("tasksPending").replace("{count}", String(pending)));
  }
  if (parts.length === 0 && completed > 0) {
    parts.push(t("tasksCompletedCount").replace("{count}", String(completed)));
  }
  return parts.join(" · ");
}

export function TodoList({ todos }) {
  if (!todos?.length) return null;

  return (
    <div className="flex flex-col" role="list">
      {todos.map((todo, i) => {
        const completed = todo.status === "completed";
        const inProgress = todo.status === "in_progress";
        return (
          <div
            key={i}
            className="flex min-h-8 min-w-0 items-center gap-2.5 px-1.5 py-1.5 text-[13px] leading-5"
            role="listitem"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative flex size-[15px] shrink-0 items-center justify-center",
                completed && "rounded-full bg-(--text-primary) text-(--bg-primary)",
                !completed && !inProgress && "rounded-full border border-[color:color-mix(in_srgb,var(--text-primary)_22%,transparent)]",
              )}
            >
              {completed ? <Check size={9} weight="bold" /> : null}
              {inProgress ? <span className="codemini-task-spinner" /> : null}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words font-normal tracking-[-0.006em] text-(--text-primary)",
                completed && "text-(--text-muted) line-through decoration-[color:color-mix(in_srgb,var(--text-muted)_45%,transparent)]",
                inProgress && "text-(--text-primary)",
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

const todoOpenByKey = new Map();

export function TodoCard({ todos = [], persistKey = "" }) {
  const [open, setOpen] = useState(() =>
    persistKey ? todoOpenByKey.get(persistKey) === true : false,
  );
  const summary = formatTodoStatusSummary(todos);
  const toggleOpen = () => {
    setOpen((value) => {
      const next = !value;
      if (persistKey) todoOpenByKey.set(persistKey, next);
      return next;
    });
  };

  return (
    <section
      className="codemini-message-surface relative w-full overflow-hidden rounded-xl"
      aria-label={t("tasksTitle")}
    >
      <button
        type="button"
        className="msg-process-row flex min-h-11 w-full min-w-0 cursor-pointer select-none items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:relative focus-visible:z-10"
        onClick={toggleOpen}
        aria-expanded={open}
      >
        <ListBullets size={14} className="shrink-0 text-(--text-secondary)" aria-hidden="true" />
        <span className="shrink-0 text-[13px] font-semibold tracking-[-0.01em] text-(--text-primary)">
          {t("tasksTitle")}
        </span>
        {summary ? (
          <span className="min-w-0 truncate text-[12px] font-normal tabular-nums text-(--text-muted)">
            {summary}
          </span>
        ) : null}
        <CaretDown
          size={12}
          className={cn(
            "ml-auto shrink-0 text-(--text-muted) transition-transform duration-150",
            !open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {open ? (
        todos.length > 0 ? (
          <div className="codemini-fold-body codemini-tasks-list max-h-44 overflow-y-auto px-2 pb-2">
            <TodoList todos={todos} />
          </div>
        ) : (
          <div className="px-3 pb-3 text-[13px] text-(--text-muted)">{t("todosEmpty")}</div>
        )
      ) : null}
    </section>
  );
}
