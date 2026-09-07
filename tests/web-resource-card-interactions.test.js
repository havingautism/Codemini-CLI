import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("memory, skill, and soul cards open details from the full card surface", async () => {
  const [memory, skill, soul] = await Promise.all([
    fs.readFile("codemini-web/client/src/components/MemoryDialog.jsx", "utf8"),
    fs.readFile("codemini-web/client/src/components/SkillPanel.jsx", "utf8"),
    fs.readFile("codemini-web/client/src/components/SoulPanel.jsx", "utf8"),
  ]);

  assert.match(
    memory,
    /role="button"\s+tabIndex=\{0\}\s+onClick=\{\(\) => onSelect\(memory\)\}/,
  );
  assert.match(
    skill,
    /role="button"\s+tabIndex=\{0\}\s+onClick=\{\(\) => onSelect\(skill\)\}/,
  );
  assert.match(
    soul,
    /role="button"\s+tabIndex=\{0\}\s+onClick=\{\(\) => onSelect\(soul\)\}/,
  );
  assert.match(memory, /handleDeleteClick = \(event\) => \{\s*event\.stopPropagation\(\)/);
  assert.match(
    soul,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*if \(disabled\) return;\s*onDelete\(soul\)/,
  );
});
