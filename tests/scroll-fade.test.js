import test from "node:test";
import assert from "node:assert/strict";

import { applyScrollFade, clearScrollFade } from "../codemini-web/client/src/lib/scroll-fade.js";

function element(metrics, { shell = false, skip = false } = {}) {
  const attrs = new Set();
  return {
    ...metrics,
    closest(selector) {
      return shell && selector === ".codemini-input-shell" ? {} : null;
    },
    matches(selector) {
      return skip && selector.includes("[data-scroll-fade='off']");
    },
    toggleAttribute(name, on) {
      if (on) attrs.add(name);
      else attrs.delete(name);
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    has(name) {
      return attrs.has(name);
    },
  };
}

test("fades only the edges that are clipping", () => {
  const node = element({
    clientWidth: 100,
    clientHeight: 80,
    scrollWidth: 240,
    scrollHeight: 80,
    scrollLeft: 20,
    scrollTop: 0,
  });

  applyScrollFade(node, { overflowX: "auto", overflowY: "hidden" });

  assert.equal(node.has("data-scroll-overflow-left"), true);
  assert.equal(node.has("data-scroll-overflow-right"), true);
  assert.equal(node.has("data-scroll-overflow-top"), false);
  assert.equal(node.has("data-scroll-overflow-bottom"), false);
});

test("vertical clipping fades the far edge until the user reaches it", () => {
  const node = element({
    clientWidth: 100,
    clientHeight: 80,
    scrollWidth: 100,
    scrollHeight: 300,
    scrollLeft: 0,
    scrollTop: 0,
  });

  applyScrollFade(node, { overflowX: "visible", overflowY: "auto" });
  assert.equal(node.has("data-scroll-overflow-bottom"), true);
  assert.equal(node.has("data-scroll-overflow-top"), false);

  node.scrollTop = 220;
  applyScrollFade(node, { overflowX: "visible", overflowY: "auto" });
  assert.equal(node.has("data-scroll-overflow-bottom"), false);
  assert.equal(node.has("data-scroll-overflow-top"), true);
});

test("a sideways tab strip fades only the clipped horizontal edges", () => {
  const tabs = element({
    clientWidth: 220,
    clientHeight: 40,
    scrollWidth: 640,
    scrollHeight: 48,
    scrollLeft: 40,
    scrollTop: 0,
  });

  applyScrollFade(tabs, { overflowX: "scroll", overflowY: "hidden" });

  assert.equal(tabs.has("data-scroll-overflow-left"), true);
  assert.equal(tabs.has("data-scroll-overflow-right"), true);
  assert.equal(tabs.has("data-scroll-overflow-top"), false);
  assert.equal(tabs.has("data-scroll-overflow-bottom"), false);
});

test("the composer and fully visible regions stay sharp", () => {
  const composer = element({
    clientWidth: 100,
    clientHeight: 40,
    scrollWidth: 400,
    scrollHeight: 40,
    scrollLeft: 10,
    scrollTop: 0,
  }, { shell: true });
  applyScrollFade(composer, { overflowX: "auto", overflowY: "hidden" });
  assert.equal(composer.has("data-scroll-overflow-left"), false);

  const fitted = element({
    clientWidth: 100,
    clientHeight: 40,
    scrollWidth: 100,
    scrollHeight: 40,
    scrollLeft: 0,
    scrollTop: 0,
  });
  applyScrollFade(fitted, { overflowX: "auto", overflowY: "auto" });
  assert.equal(fitted.has("data-scroll-overflow-right"), false);
  assert.equal(fitted.has("data-scroll-overflow-bottom"), false);

  fitted.toggleAttribute("data-scroll-overflow-bottom", true);
  clearScrollFade(fitted);
  assert.equal(fitted.has("data-scroll-overflow-bottom"), false);
});
