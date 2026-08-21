import { CaretRight } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function DisclosureLeading({
  open = false,
  expandable = true,
  children,
}) {
  return (
    <span
      className="codemini-disclosure-leading"
      data-open={open ? "true" : undefined}
      data-expandable={expandable ? "true" : undefined}
    >
      <span className="codemini-disclosure-icon">{children}</span>
      {expandable ? (
        <CaretRight
          size={14}
          className="codemini-disclosure-chevron"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

export function DisclosureRowButton({
  open = false,
  expandable = true,
  onClick,
  icon,
  className,
  children,
  ...props
}) {
  return (
    <button
      type="button"
      className={cn("codemini-disclosure-row msg-process-row", className)}
      onClick={onClick}
      aria-expanded={expandable ? Boolean(open) : undefined}
      {...props}
    >
      <DisclosureLeading open={open} expandable={expandable}>
        {icon}
      </DisclosureLeading>
      {children}
    </button>
  );
}
