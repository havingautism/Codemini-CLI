// Adapted from Beautiful UI's GlideMenu. See LICENSE.
import { useRef, useState } from "react";

/** A single hover layer that glides between interactive menu rows. */
export default function GlideMenu({
  children,
  className = "",
}) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [visible, setVisible] = useState(false);

  const moveTo = (target) => {
    const container = ref.current;
    if (!(target instanceof Element) || !container) return;
    const row = target.closest("[data-menu-row]");
    if (!(row instanceof HTMLElement) || !container.contains(row)) {
      setVisible(false);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({
      top: rowRect.top - containerRect.top,
      left: rowRect.left - containerRect.left,
      width: rowRect.width,
      height: rowRect.height,
    });
    setVisible(true);
  };

  return (
    <div
      ref={ref}
      onMouseOver={(event) => {
        const previous = event.relatedTarget;
        if (previous instanceof Element &&
          previous.closest("[data-menu-row]") === event.target.closest("[data-menu-row]")) return;
        moveTo(event.target);
      }}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        if (!ref.current?.contains(event.relatedTarget)) setVisible(false);
      }}
      className={`relative ${className}`}
    >
      <span
        aria-hidden
        className="codemini-sidebar-glide pointer-events-none absolute"
        style={{
          top: box?.top ?? 0,
          left: box?.left ?? 0,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
        }}
      />
      {children}
    </div>
  );
}
