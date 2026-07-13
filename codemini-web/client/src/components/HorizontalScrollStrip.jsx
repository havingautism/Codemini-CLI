import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

function readScrollMetrics(element) {
  return {
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  };
}

/**
 * Horizontal strip with a custom track that stays visible while content overflows.
 * Native scrollbars (incl. macOS overlay) are hidden; wheel / trackpad still scroll the viewport.
 */
export function HorizontalScrollStrip({ className, contentClassName, children }) {
  const viewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const [metrics, setMetrics] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });

  const updateMetrics = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    setMetrics(readScrollMetrics(element));
  }, []);

  useEffect(() => {
    updateMetrics();
    const element = viewportRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(updateMetrics);
    observer.observe(element);
    element.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
    };
  }, [updateMetrics, children]);

  const canScroll = metrics.scrollWidth > metrics.clientWidth + 1;
  const scrollRange = Math.max(metrics.scrollWidth - metrics.clientWidth, 1);
  const thumbWidth = canScroll
    ? Math.max(40, (metrics.clientWidth / metrics.scrollWidth) * metrics.clientWidth)
    : 0;
  const maxThumbOffset = Math.max(metrics.clientWidth - thumbWidth, 0);
  const thumbOffset = canScroll ? (metrics.scrollLeft / scrollRange) * maxThumbOffset : 0;

  const scrollToOffset = useCallback((nextLeft) => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollLeft = nextLeft;
    setMetrics(readScrollMetrics(element));
  }, []);

  const handleTrackPointerDown = (event) => {
    const element = viewportRef.current;
    const track = event.currentTarget;
    if (!element || !canScroll || event.button !== 0) return;

    const rect = track.getBoundingClientRect();
    const clickOffset = event.clientX - rect.left;
    const nextThumbOffset = Math.max(
      0,
      Math.min(clickOffset - thumbWidth / 2, maxThumbOffset),
    );
    scrollToOffset((nextThumbOffset / Math.max(maxThumbOffset, 1)) * scrollRange);
  };

  const handleThumbPointerDown = (event) => {
    const element = viewportRef.current;
    if (!element || !canScroll || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleThumbPointerMove = (event) => {
    const element = viewportRef.current;
    const drag = dragStateRef.current;
    if (!element || !drag || maxThumbOffset <= 0) return;

    const deltaX = event.clientX - drag.startX;
    const scrollDelta = (deltaX / maxThumbOffset) * scrollRange;
    scrollToOffset(drag.startScrollLeft + scrollDelta);
  };

  const handleThumbPointerUp = (event) => {
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className={cn('codemini-horizontal-scroll-strip w-full', className)}>
      <div
        ref={viewportRef}
        className="codemini-horizontal-scroll-strip__viewport overflow-x-auto overflow-y-hidden"
      >
        <div
          className={cn(
            'flex w-max max-w-none items-stretch gap-3 px-0.5',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
      {canScroll && (
        <div
          role="presentation"
          className="codemini-horizontal-scroll-strip__track mt-1.5 h-2.5 cursor-pointer rounded-full"
          onPointerDown={handleTrackPointerDown}
        >
          <div
            role="presentation"
            className="codemini-horizontal-scroll-strip__thumb absolute top-0 h-2.5 cursor-grab rounded-full active:cursor-grabbing"
            style={{ width: `${thumbWidth}px`, transform: `translateX(${thumbOffset}px)` }}
            onPointerDown={handleThumbPointerDown}
            onPointerMove={handleThumbPointerMove}
            onPointerUp={handleThumbPointerUp}
            onPointerCancel={handleThumbPointerUp}
          />
        </div>
      )}
    </div>
  );
}
