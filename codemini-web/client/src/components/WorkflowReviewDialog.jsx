import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";

export function formatReviewPath(filePath = "") {
  const value = String(filePath || "").trim();
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 4) return value;
  return `…/${parts.slice(-4).join("/")}`;
}

export function WorkflowReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  badge,
  badgeVariant = "secondary",
  badgeClassName,
  footer,
  children,
  contentClassName,
}) {
  const fullDescription = String(description || "").trim();
  const shortDescription = formatReviewPath(fullDescription);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl",
          "border-(--border-default) bg-(--bg-primary) text-(--text-primary) shadow-[var(--shadow-lg)]",
          contentClassName,
        )}
      >
        <div className="shrink-0 border-b border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_86%,var(--bg-secondary)_14%)] px-6 py-4">
          <DialogHeader showCloseButton={false} className="gap-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle className="text-base font-semibold leading-none tracking-tight">
                  {title}
                </DialogTitle>
                {fullDescription ? (
                  <DialogDescription
                    className="font-mono text-xs leading-relaxed text-(--text-muted) line-clamp-2 break-all"
                    title={fullDescription}
                  >
                    {shortDescription}
                  </DialogDescription>
                ) : null}
              </div>
              {badge ? (
                <Badge
                  variant={badgeVariant}
                  className={cn(
                    "h-5 shrink-0 rounded-md px-1.5 py-0 text-[11px] font-medium shadow-none",
                    badgeClassName,
                  )}
                >
                  {badge}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-4 max-h-[min(calc(85vh-11rem),72vh)]">
          <div className="space-y-4">{children}</div>
        </div>

        <div className="shrink-0 border-t border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_84%,var(--bg-secondary)_16%)]">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewSection({ label, children, className, action }) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-(--text-muted) uppercase">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ReviewText({ children, className }) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed whitespace-pre-wrap text-(--text-primary)",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function ReviewMarkdown({ children, className, bare = false }) {
  const text = String(children || "").trim();
  if (!text) return null;
  return (
    <div
      className={cn(
        !bare &&
          "rounded-md border border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_76%,var(--bg-secondary)_24%)] px-3 py-2 text-(--text-secondary)",
        className,
      )}
    >
      <StreamdownRenderer text={text} streaming={false} className="text-sm" />
    </div>
  );
}

export function ReviewCommandBlock({ command, language = "bash", className }) {
  const value = String(command || "").trim();
  if (!value) return null;
  const lang = String(language || "bash").trim() || "bash";
  return (
    <div className={cn("min-w-0", className)}>
      <StreamdownRenderer
        text={`\`\`\`${lang}\n${value}\n\`\`\``}
        streaming={false}
      />
    </div>
  );
}

export function ReviewTaskPreview({
  text,
  className,
  collapsedMaxHeight = "max-h-40",
  expandLabel = "Show more",
  collapseLabel = "Show less",
}) {
  const value = String(text || "").trim();
  const [expanded, setExpanded] = useState(false);
  if (!value) return null;

  const lineCount = value.split(/\r?\n/).length;
  const needsToggle = value.length > 320 || lineCount > 8;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "rounded-md border border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_72%,var(--bg-secondary)_28%)] overflow-hidden",
          !expanded && needsToggle && `${collapsedMaxHeight} overflow-y-auto`,
        )}
      >
        <ReviewMarkdown bare className="px-3 py-2 text-(--text-secondary)">
          {value}
        </ReviewMarkdown>
      </div>
      {needsToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 px-2 text-xs text-(--text-muted)"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? collapseLabel : expandLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ReviewDocument({ children, className, edit = false }) {
  return (
    <pre
      className={cn(
        "rounded-md border border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_72%,var(--bg-secondary)_28%)] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-(--text-primary)",
        edit && "min-h-[320px] overflow-auto",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function ReviewNotice({ variant = "muted", children, className }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5 text-sm leading-relaxed",
        variant === "destructive"
          ? "border-[color-mix(in_srgb,var(--destructive)_32%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,var(--bg-primary))] text-destructive"
          : "border-(--border-default) bg-[color-mix(in_srgb,var(--bg-primary)_78%,var(--bg-secondary)_22%)] text-(--text-primary)",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReviewCard({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-md border border-(--border-default) bg-(--bg-primary) p-3 text-(--text-primary) shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReviewFooter({ leading, trailing, className }) {
  return (
    <DialogFooter
      className={cn(
        "gap-3 border-0 bg-transparent px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0",
        className,
      )}
    >
      <div className="flex flex-wrap gap-2">{leading}</div>
      <div className="flex flex-wrap gap-2 sm:justify-end">{trailing}</div>
    </DialogFooter>
  );
}
