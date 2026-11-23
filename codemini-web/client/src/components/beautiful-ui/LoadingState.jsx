// Adapted from Beautiful UI's LoadingState (Drive). See LICENSE.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import "./LoadingState.css";

const delays = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3), c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export function LoadingState({ label, className }) {
  const [startedAt] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 100);
    return () => clearInterval(timer);
  }, [startedAt]);

  const seconds = elapsed < 60
    ? `${elapsed.toFixed(1)}s`
    : `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toFixed(1)}s`;

  return (
    <span className={cn("codemini-response-loader inline-flex min-h-6 items-center gap-2.5", className)}>
      <span aria-hidden="true" className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span key={index} className="codemini-loader-pixel" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span role="status" className="codemini-shimmer-label">{label}</span>
      <span aria-hidden="true" className="font-mono text-xs tabular-nums text-(--text-muted)">{seconds}</span>
    </span>
  );
}
