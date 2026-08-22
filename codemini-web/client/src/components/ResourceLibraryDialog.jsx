import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ResourceLibraryDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  children,
  className,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[82vh] max-h-[820px] min-h-[560px] w-[calc(100vw-2rem)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]",
          className,
        )}
      >
        <DialogHeader className="border-b border-(--border-default) px-6">
          <div className="flex min-w-0 items-center gap-3">
            {Icon ? (
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Icon
                  size={15}
                  strokeWidth={2}
                  className="shrink-0 text-(--text-secondary)"
                />
              </span>
            ) : null}
            <div className="min-w-0">
              <DialogTitle className="truncate text-[16px] leading-6">
                {title}
              </DialogTitle>
              {description ? (
                <p className="truncate text-[12px] leading-5 text-(--text-muted)">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
