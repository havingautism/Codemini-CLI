const SCROLLABLE = new Set(["auto", "scroll", "overlay"]);

export const SCROLL_FADE_SELECTOR = [
  ".overflow-auto",
  ".overflow-x-auto",
  ".overflow-y-auto",
  ".overflow-scroll",
  ".overflow-x-scroll",
  ".overflow-y-scroll",
  "[data-streamdown='code-block-body']",
  "[data-streamdown='table-wrapper'] > div:nth-child(2)",
  ".codemini-file-preview-scroll",
  ".codemini-horizontal-scroll-strip__viewport",
  "[data-slot='scroll-area-viewport']",
  "[data-slot='message-scroller-viewport']",
  "[data-slot='select-content']",
  "[data-slot='dialog-content']",
].join(",");

function canScroll(value) {
  return SCROLLABLE.has(value);
}

export function applyScrollFade(element, overflow = {}) {
  const skipped = element.closest?.(".codemini-input-shell")
    || element.matches?.("textarea, input, [data-scroll-fade='off']");
  if (skipped || element.clientWidth < 1 || element.clientHeight < 1) {
    clearScrollFade(element);
    return;
  }

  const horizontal = canScroll(overflow.overflowX);
  const vertical = canScroll(overflow.overflowY);
  if (!horizontal && !vertical) {
    clearScrollFade(element);
    return;
  }

  const xExtent = element.scrollWidth - element.clientWidth;
  const yExtent = element.scrollHeight - element.clientHeight;
  element.toggleAttribute("data-scroll-overflow-left", horizontal && xExtent > 1 && element.scrollLeft > 1);
  element.toggleAttribute("data-scroll-overflow-right", horizontal && xExtent > 1 && xExtent - element.scrollLeft > 1);
  element.toggleAttribute("data-scroll-overflow-top", vertical && yExtent > 1 && element.scrollTop > 1);
  element.toggleAttribute("data-scroll-overflow-bottom", vertical && yExtent > 1 && yExtent - element.scrollTop > 1);
}

export function clearScrollFade(element) {
  element.removeAttribute?.("data-scroll-overflow-left");
  element.removeAttribute?.("data-scroll-overflow-right");
  element.removeAttribute?.("data-scroll-overflow-top");
  element.removeAttribute?.("data-scroll-overflow-bottom");
}

function overflowOf(element, doc) {
  const cached = element.dataset.scrollAxis;
  if (cached) {
    return {
      overflowX: cached.includes("x") ? "auto" : "hidden",
      overflowY: cached.includes("y") ? "auto" : "hidden",
    };
  }
  const style = doc.defaultView.getComputedStyle(element);
  const horizontal = canScroll(style.overflowX);
  const vertical = canScroll(style.overflowY);
  element.dataset.scrollAxis = `${horizontal ? "x" : ""}${vertical ? "y" : ""}`;
  return { overflowX: style.overflowX, overflowY: style.overflowY };
}

export function installScrollEdgeObserver(doc = document) {
  let frame = 0;
  const observed = new Map();

  function update(node) {
    applyScrollFade(node, overflowOf(node, doc));
  }

  function measure() {
    frame = 0;
    const nodes = doc.querySelectorAll(SCROLL_FADE_SELECTOR);
    const next = new Set(nodes);
    for (const [node, child] of observed) {
      if (next.has(node)) continue;
      resize.unobserve(node);
      if (child) resize.unobserve(child);
      observed.delete(node);
      delete node.dataset.scrollAxis;
      clearScrollFade(node);
    }
    for (const node of nodes) {
      update(node);
      const child = node.firstElementChild;
      const previous = observed.get(node);
      if (previous && previous !== child) resize.unobserve(previous);
      if (!observed.has(node)) resize.observe(node);
      if (child && previous !== child) resize.observe(child);
      observed.set(node, child || null);
    }
  }

  function schedule() {
    if (!frame) frame = doc.defaultView.requestAnimationFrame(measure);
  }

  function onScroll(event) {
    const target = event.target;
    if (!(target instanceof doc.defaultView.Element) || !observed.has(target)) return;
    update(target);
  }

  const resize = new doc.defaultView.ResizeObserver(schedule);
  const mutations = new doc.defaultView.MutationObserver(schedule);
  mutations.observe(doc.documentElement, { childList: true, subtree: true });
  doc.addEventListener("scroll", onScroll, true);
  schedule();

  return () => {
    doc.defaultView.cancelAnimationFrame(frame);
    mutations.disconnect();
    resize.disconnect();
    doc.removeEventListener("scroll", onScroll, true);
    for (const node of observed.keys()) {
      delete node.dataset.scrollAxis;
      clearScrollFade(node);
    }
  };
}
