import { cn } from "@/lib/utils"

function Empty({ className, ...props }) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "codemini-empty-dashed flex flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        className
      )}
      {...props} />
  );
}

function EmptyHeader({ className, ...props }) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-1 text-center", className)}
      {...props} />
  );
}

function EmptyTitle({ className, ...props }) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-[13px] font-medium text-(--text-primary)", className)}
      {...props} />
  );
}

function EmptyDescription({ className, ...props }) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-[12px] leading-relaxed text-(--text-muted)", className)}
      {...props} />
  );
}

function EmptyContent({ className, ...props }) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex flex-col items-center gap-2", className)}
      {...props} />
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent }
