"use client"

import * as React from "react"
import { X } from "@/lib/icons"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function DialogDismiss({ className }) {
  return (
    <DialogPrimitive.Close
      type="button"
      data-slot="dialog-close"
      aria-label="Close"
      className={cn(
        "absolute top-3 end-3 z-10 inline-flex size-7 items-center justify-center rounded-[8px] text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:bg-(--bg-hover) focus-visible:outline-none",
        className,
      )}
    >
      <X size={15} strokeWidth={1.75} />
    </DialogPrimitive.Close>
  );
}

function Dialog({
  ...props
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/35 backdrop-blur-[6px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props} />
  );
}

function DialogContent({
  className,
  children,
  closeOnOutsideClick = false,
  ...props
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          if (!closeOnOutsideClick) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!closeOnOutsideClick) e.preventDefault();
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 gap-0 rounded-[14px] border-0 bg-(--bg-primary) text-(--text-primary) px-6 pt-0 pb-6 shadow-[var(--shadow-overlay)] duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        )}
        {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  showCloseButton = true,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-header"
      data-close={showCloseButton ? "true" : undefined}
      className={cn("flex shrink-0 flex-row items-start justify-between gap-3 pt-5 pb-4 text-left", showCloseButton && "pe-10", className)}
      {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
      </div>
      {showCloseButton ? <DialogDismiss /> : null}
    </div>
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 border-t border-(--line) pt-4 sm:flex-row sm:justify-end", className)}
      {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[15px] font-semibold leading-6 tracking-[-0.02em] text-(--text-primary)", className)}
      {...props} />
  );
}

function DialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[12px] leading-5 text-(--text-secondary)", className)}
      {...props} />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
