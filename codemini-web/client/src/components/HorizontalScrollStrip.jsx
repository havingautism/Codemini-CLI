import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';

/**
 * Horizontal strip using the shared shadcn/Radix scroll area.
 * The compact bar stays visible while content overflows, including on overlay-scrollbar systems.
 */
export function HorizontalScrollStrip({ className, contentClassName, children }) {
  return (
    <ScrollArea
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
