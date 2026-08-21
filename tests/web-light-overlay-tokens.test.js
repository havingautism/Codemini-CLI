import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

function appleLightBlock(css) {
  const start = css.indexOf("/* ── Codemini Apple material system ── */");
  const dark = css.indexOf(":root[data-theme=\"dark\"]", start);
  assert.ok(start >= 0, "Apple material block should exist");
  assert.ok(dark > start, "dark Apple block should follow the light block");
  return css.slice(start, dark);
}

test("Apple light hover and selected share one gray family on chrome", async () => {
  const css = await fs.readFile("codemini-web/client/style.css", "utf8");
  const light = appleLightBlock(css);

  assert.match(
    light,
    /--interactive-hover:\s*color-mix\(in srgb, var\(--text-primary\) 6%, var\(--bg-secondary\)\)/,
  );
  assert.match(
    light,
    /--selected-bg:\s*color-mix\(in srgb, var\(--text-primary\) 11%, var\(--bg-secondary\)\)/,
  );
  assert.match(
    light,
    /--bg-subtle:\s*color-mix\(in srgb, var\(--text-primary\) 3%, var\(--bg-secondary\)\)/,
  );
  assert.match(light, /--bg-hover:\s*var\(--interactive-hover\)/);
  assert.match(light, /--bg-active:\s*var\(--selected-bg\)/);
  assert.doesNotMatch(
    light,
    /--interactive-hover:[^;]*transparent/,
    "light hover must be opaque so it stays visible on the gray sidebar",
  );
});

test("Apple light muted text is readable without collapsing into charcoal", async () => {
  const css = await fs.readFile("codemini-web/client/style.css", "utf8");
  const light = appleLightBlock(css);

  assert.match(light, /--text-secondary:\s*#6e6e73/);
  assert.match(light, /--text-muted:\s*#7a7a80/);
});

test("Apple light reading surfaces stay white while chrome stays slightly gray", async () => {
  const css = await fs.readFile("codemini-web/client/style.css", "utf8");
  const light = appleLightBlock(css);

  assert.match(light, /--bg-primary:\s*#ffffff/);
  assert.match(light, /--bg-secondary:\s*#f5f5f7/);
  assert.match(light, /--bg-tertiary:\s*#f8f8fa/);
  assert.match(light, /--shell-canvas:\s*#f8f8fa/);
  assert.match(light, /--message-surface:\s*var\(--bg-secondary\)/);
  assert.match(light, /--material-elevated:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/);
  assert.match(
    css,
    /\.codemini-markdown-table-strip \.codemini-horizontal-scroll-strip__viewport \{[^}]*background: var\(--message-surface\)/,
  );
  assert.match(
    css,
    /\.msg-body \[data-streamdown="table-wrapper"\]>div:nth-child\(2\) \{[^}]*background: var\(--message-surface\)[^}]*box-shadow: inset 0 0 0 1px var\(--message-edge\)/,
  );
  assert.match(
    css,
    /\.msg-body \[data-streamdown="code-block"\] \{[^}]*background: var\(--message-surface\)[^}]*box-shadow: inset 0 0 0 1px var\(--message-edge\)/,
  );
  assert.match(
    css,
    /\.msg-body blockquote \{[^}]*background: var\(--message-surface\)[^}]*box-shadow: inset 0 0 0 1px var\(--message-edge\)/,
  );
  assert.match(
    css,
    /\.msg-body\.codemini-assistant-markdown blockquote \{[^}]*background: var\(--message-surface\)[^}]*box-shadow: inset 0 0 0 1px var\(--message-edge\)/,
  );
  assert.match(css, /--fold-surface:\s*transparent/);
  assert.match(css, /--tool-detail-bg:\s*var\(--bg-primary\)/);
  assert.match(
    css,
    /\.codemini-fold-body \{[^}]*background: var\(--fold-surface\)/,
  );
});

test("workspace session and side rail share the same panel chrome", async () => {
  const css = await fs.readFile("codemini-web/client/style.css", "utf8");
  const app = await fs.readFile("codemini-web/client/src/App.jsx", "utf8");

  assert.match(
    css,
    /\.codemini-workspace-panel,\s*\.codemini-workspace-rail(?:,\s*\.[a-z-]+)* \{[^}]*border: 1px solid var\(--workspace-panel-border\)/,
  );
  assert.match(
    css,
    /\.codemini-workspace-panel,\s*\.codemini-workspace-rail(?:,\s*\.[a-z-]+)* \{[^}]*border-color: color-mix\(in srgb, var\(--border-default\) 78%, transparent\)/,
  );
  assert.match(css, /\.codewiki-sidebar,/);
  assert.match(css, /\.codewiki-main,/);
  assert.match(css, /\.codewiki-question-panel \{/);
  assert.match(
    css,
    /\.codewiki-layout \{[^}]*grid-template-columns: 276px minmax\(0, 1fr\) var\(--codewiki-qa-width, 420px\)/,
  );
  assert.match(css, /\.codewiki-layout \{[^}]*gap: 0\.5rem/);
  assert.doesNotMatch(
    css,
    /grid-template-columns: 276px minmax\(0, 1fr\) 12px var\(--codewiki-qa-width/,
  );
  assert.match(
    css,
    /\.codemini-workspace-rail \{[^}]*overflow: visible/,
  );
  assert.match(
    app,
    /relative grid min-h-0 min-w-0 flex-1 grid-cols-\[minmax\(0,1fr\)_auto\] gap-2 overflow-hidden/,
  );
  assert.match(
    app,
    /codemini-workspace-panel[\s\S]*WorkspaceRail/,
  );
});

test("light input and settings chrome use overlay tokens instead of one-off grays", async () => {
  const css = await fs.readFile("codemini-web/client/style.css", "utf8");

  assert.match(
    css,
    /:root:not\(\[data-theme="dark"\]\) \.codemini-input-pill:hover \{[\s\S]*?background: var\(--bg-hover\)/,
  );
  assert.match(
    css,
    /:root:not\(\[data-theme="dark"\]\) \.codemini-input-chip--selected \{[\s\S]*?background: var\(--selected-bg\)/,
  );
  assert.match(
    css,
    /:root:not\(\[data-theme="dark"\]\) \.settings-nav-trigger:hover \{[\s\S]*?background: var\(--bg-hover\)/,
  );
  assert.match(
    css,
    /:root:not\(\[data-theme="dark"\]\) \.settings-nav-trigger\[data-state="active"\] \{[\s\S]*?background: var\(--selected-bg\)/,
  );
  assert.doesNotMatch(
    css,
    /:root:not\(\[data-theme="dark"\]\) \.codemini-input-pill:hover \{[\s\S]*?rgba\(29,\s*29,\s*31/,
  );
});
