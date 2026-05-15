import { cn } from "@/lib/utils";

export function Spinner({ className }) {
  return (
    <span role="status" className={cn("loading-dots text-(--text-muted)", className)}>
      <span /><span /><span />
    </span>
  );
}
