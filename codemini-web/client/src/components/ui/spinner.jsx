import { ThinkingOrb } from "thinking-orbs";
import { cn } from "@/lib/utils";

export function Spinner({ className }) {
  return (
    <span role="status" className={cn("loading-dots", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}

export function LinearRing({ size = "md", className }) {
  return (
    <span
      role="status"
      className={cn("linear-loader-ring", `linear-loader-ring--${size}`, className)}
    />
  );
}

export function LinearStatusDot({ size = "sm", className }) {
  return (
    <span
      className={cn("linear-status-dot", `linear-status-dot--${size}`, className)}
    />
  );
}

/** Chat process only — thinking / tools / agent activity. */
export function SessionOrb({ state = "working", className, ...props }) {
  return (
    <ThinkingOrb
      state={state}
      size={20}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
