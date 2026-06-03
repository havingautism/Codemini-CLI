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
