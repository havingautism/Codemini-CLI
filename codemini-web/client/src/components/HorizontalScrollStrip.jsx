import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { useHorizontalScrollEdges } from '@/hooks/use-horizontal-scroll-edges.js';

/**
 * Horizontal strip using the shared shadcn/Radix scroll area.
 * The compact bar stays visible while content overflows, including on overlay-scrollbar systems.
 */
export function HorizontalScrollStrip({ className, contentClassName, fadeEdges = false, children }) {
  const scrollEdges = useHorizontalScrollEdges('.codemini-horizontal-scroll-strip__viewport', undefined, fadeEdges);
  return (
    <ScrollArea
      {...scrollEdges}
      type="auto"
      orientation="horizontal"
      className={cn('codemini-horizontal-scroll-strip w-full pb-3', className)}
      viewportClassName="codemini-horizontal-scroll-strip__viewport"
    >
      <div
        className={cn(
          'flex w-max max-w-none items-stretch gap-3 px-0.5',
          contentClassName,
        )}
      >
        {children}
      </div>
    </ScrollArea>
  );
}

export function HorizontalScrollViewport({ as: Element = "div", ...props }) {
  const scrollEdges = useHorizontalScrollEdges();
  return <Element {...props} {...scrollEdges} />;
}
