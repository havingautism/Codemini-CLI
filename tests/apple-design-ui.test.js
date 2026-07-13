import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const stylesheetPath = path.join(
  process.cwd(),
  "codemini-web",
  "client",
  "src",
  "apple-design.css",
);
const appPath = path.join(
  process.cwd(),
  "codemini-web",
  "client",
  "src",
  "App.jsx",
);

test("Apple design layer declares the required visual and accessibility contracts", () => {
  assert.equal(
    fs.existsSync(stylesheetPath),
    true,
    "the Apple design stylesheet should exist",
  );

  const css = fs.readFileSync(stylesheetPath, "utf8");
  for (const token of [
    "--apple-canvas: #f5f5f7",
    "--apple-text: #1d1d1f",
    "--apple-blue: #0071e3",
    ":root[data-theme=\"dark\"]",
    "prefers-reduced-motion: reduce",
    "focus-visible",
    "backdrop-filter: blur(20px) saturate(180%)",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(
    fs.readFileSync(appPath, "utf8"),
    /import\s+["']\.\/apple-design\.css["']/,
    "the application entry point should load the Apple design layer after base styles",
  );
});
