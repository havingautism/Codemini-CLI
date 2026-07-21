import * as React from "react";
import { ArrowDown } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  isViewportAtEnd,
  resolveFollowEnd,
  syncViewportAfterResize,
} from "@/components/ui/message-scroller-follow";

const MessageScrollerContext = React.createContext(null);

function MessageScrollerProvider({ children }) {
  const [viewport, setViewport] = React.useState(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);
  const followEndRef = React.useRef(true);
  const userScrollRef = React.useRef(false);

  const measure = React.useCallback((node, { isUserDriven = false } = {}) => {
    if (!node) return;
    setAtStart(node.scrollTop <= 2);
    const nextAtEnd = isViewportAtEnd(node);
    setAtEnd(nextAtEnd);
    followEndRef.current = resolveFollowEnd(followEndRef.current, {
      atEnd: nextAtEnd,
      isUserDriven,
    });
  }, []);

  const scrollTo = React.useCallback((direction = "end") => {
    if (!viewport) return;
    const toEnd = direction !== "start";
    followEndRef.current = toEnd;
    viewport.scrollTo({
      top: toEnd ? viewport.scrollHeight : 0,
      behavior: "smooth",
    });
  }, [viewport]);

  React.useEffect(() => {
    if (!viewport) return;
    measure(viewport);
    let clearUserScrollTimer = 0;
    const clearUserScroll = () => {
      userScrollRef.current = false;
      window.clearTimeout(clearUserScrollTimer);
    };
    const markUserScroll = () => {
      userScrollRef.current = true;
      // Keep the gesture open across wheel/touch momentum; scrollend clears it.
      window.clearTimeout(clearUserScrollTimer);
      clearUserScrollTimer = window.setTimeout(clearUserScroll, 120);
    };
    const onScroll = () => {
      measure(viewport, { isUserDriven: userScrollRef.current });
    };
    const onScrollbarPointerDown = (event) => {
      if (event.target !== viewport) return;
      if (event.offsetX >= viewport.clientWidth) markUserScroll();
    };
    const observer = new ResizeObserver(() => {
      syncViewportAfterResize(viewport, followEndRef.current);
      measure(viewport, { isUserDriven: false });
    });
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("scrollend", clearUserScroll);
    viewport.addEventListener("wheel", markUserScroll, { passive: true });
    viewport.addEventListener("touchmove", markUserScroll, { passive: true });
    viewport.addEventListener("keydown", markUserScroll);
    viewport.addEventListener("pointerdown", onScrollbarPointerDown);
    return () => {
      observer.disconnect();
      window.clearTimeout(clearUserScrollTimer);
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("scrollend", clearUserScroll);
      viewport.removeEventListener("wheel", markUserScroll);
      viewport.removeEventListener("touchmove", markUserScroll);
      viewport.removeEventListener("keydown", markUserScroll);
      viewport.removeEventListener("pointerdown", onScrollbarPointerDown);
    };
  }, [viewport, measure]);

  const value = React.useMemo(
    () => ({ viewport, setViewport, atStart, atEnd, measure, scrollTo }),
    [viewport, atStart, atEnd, measure, scrollTo],
  );

  return (
    <MessageScrollerContext.Provider value={value}>
      {children}
    </MessageScrollerContext.Provider>
  );
}

function useMessageScroller() {
  return React.useContext(MessageScrollerContext);
}

function useMessageScrollerScrollable() {
  const context = useMessageScroller();
  return !!context && (!context.atStart || !context.atEnd);
}

function useMessageScrollerVisibility(direction = "end") {
  const context = useMessageScroller();
  return direction === "start" ? !context?.atStart : !context?.atEnd;
}

function MessageScroller({ className, ...props }) {
  return (
    <div
      data-slot="message-scroller"
      className={cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}

const MessageScrollerViewport = React.forwardRef(function MessageScrollerViewport(
  { className, onScroll, ...props },
  forwardedRef,
) {
  const context = useMessageScroller();
  const setViewport = context?.setViewport;
  const setRef = React.useCallback((node) => {
    setViewport?.(node);
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [setViewport, forwardedRef]);

  return (
    <div
      ref={setRef}
      data-slot="message-scroller-viewport"
      className={cn("size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content", className)}
      onScroll={onScroll}
      {...props}
    />
  );
});

function MessageScrollerContent({ className, ...props }) {
  return <div data-slot="message-scroller-content" className={cn("flex h-max min-h-full flex-col gap-8", className)} {...props} />;
}

function MessageScrollerItem({ className, scrollAnchor = false, ...props }) {
  return (
    <div
      data-slot="message-scroller-item"
      data-scroll-anchor={scrollAnchor || undefined}
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({ direction = "end", className, children, variant = "secondary", size = "icon-sm", ...props }) {
  const context = useMessageScroller();
  const active = direction === "start" ? !context?.atStart : !context?.atEnd;
  return (
    <Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-active={active}
      variant={variant}
      size={size}
      className={cn("absolute inset-s-1/2 -translate-x-1/2 rounded-full border border-(--border-default) bg-(--material-elevated) text-(--text-primary) shadow-(--shadow-elevated) transition-[transform,opacity] duration-200 data-[active=false]:pointer-events-none data-[active=false]:translate-y-2 data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[direction=end]:bottom-4 data-[direction=start]:top-4 data-[direction=start]:[&_svg]:rotate-180", className)}
      onClick={() => context?.scrollTo(direction)}
      {...props}
    >
      {children ?? <><ArrowDown /><span className="sr-only">{direction === "end" ? "Scroll to end" : "Scroll to start"}</span></>}
    </Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
