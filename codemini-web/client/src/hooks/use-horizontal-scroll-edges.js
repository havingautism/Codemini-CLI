import { useEffect, useRef } from "react";

function updateScrollEdges(viewport) {
  const { scrollLeft, scrollWidth, clientWidth } = viewport;
  const extent = scrollWidth - clientWidth;
  // Ignore subpixel rounding at either end and elastic scrolling without overflow.
  viewport.toggleAttribute("data-scroll-overflow-left", extent > 1 && scrollLeft > 1);
  viewport.toggleAttribute("data-scroll-overflow-right", extent > 1 && extent - scrollLeft > 1);
}

export function useHorizontalScrollEdges(viewportSelector, contentSelector, enabled = true) {
  const frameRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !enabled) return;
    const observed = new Set();
    let animationFrame = 0;

    function measure() {
      animationFrame = 0;
      const targets = new Set();
      const viewports = viewportSelector ? frame.querySelectorAll(viewportSelector) : [frame];
      for (const viewport of viewports) {
        updateScrollEdges(viewport);
        targets.add(viewport);
        const content = contentSelector
          ? viewport.querySelector(contentSelector)
          : viewport.firstElementChild;
        if (content) targets.add(content);
      }
      for (const target of observed) {
        if (targets.has(target)) continue;
        resize.unobserve(target);
        observed.delete(target);
      }
      for (const target of targets) {
        if (observed.has(target)) continue;
        observed.add(target);
        resize.observe(target);
      }
    }

    function scheduleMeasure() {
      if (!animationFrame) animationFrame = requestAnimationFrame(measure);
    }

    const resize = new ResizeObserver(scheduleMeasure);
    // Markdown and syntax highlighting can replace the viewport after mounting.
    const mutations = new MutationObserver(scheduleMeasure);
    mutations.observe(frame, { childList: true, subtree: true, characterData: true });
    measure();

    return () => {
      cancelAnimationFrame(animationFrame);
      mutations.disconnect();
      resize.disconnect();
      for (const target of observed) {
        target.removeAttribute("data-scroll-overflow-left");
        target.removeAttribute("data-scroll-overflow-right");
      }
    };
  }, [viewportSelector, contentSelector, enabled]);

  function onScrollCapture(event) {
    if (!enabled) return;
    const { target } = event;
    if (viewportSelector ? target.matches?.(viewportSelector) : target === frameRef.current) {
      updateScrollEdges(target);
    }
  }

  return { ref: frameRef, onScrollCapture };
}
