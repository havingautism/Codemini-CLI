import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("select keeps option descriptions out of its compact trigger", async () => {
  const source = await fs.readFile(
    "codemini-web/client/src/components/UserInputDialog.jsx",
    "utf8",
  );

  assert.match(source, /data-option-description/);
  assert.match(
    source,
    /SelectTrigger className="w-full \[&_\[data-option-description\]\]:hidden"/,
  );
});

test("composer sends pasted files through the existing attachment uploader", async () => {
  const source = await fs.readFile(
    "codemini-web/client/src/components/InputBar.jsx",
    "utf8",
  );

  assert.match(source, /const files = Array\.from\(event\.clipboardData\?\.files \|\| \[\]\);/);
  assert.match(source, /if \(!files\.length\) return;/);
  assert.match(source, /event\.preventDefault\(\);\s*handleFiles\(files\);/);
  assert.match(source, /onPaste=\{handlePaste\}/);
});