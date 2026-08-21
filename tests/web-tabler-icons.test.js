import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const WEB_ROOT = "codemini-web";
const CLIENT_ROOT = path.join(WEB_ROOT, "client");

async function walkFiles(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await walkFiles(full, acc);
      continue;
    }
    if (/\.(js|jsx|ts|tsx|css|json)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

test("web package uses Tabler icons instead of Phosphor", async () => {
  const pkg = JSON.parse(
    await fs.readFile(path.join(WEB_ROOT, "package.json"), "utf8"),
  );
  assert.ok(
    pkg.dependencies?.["@tabler/icons-react"],
    "codemini-web should depend on @tabler/icons-react",
  );
  assert.equal(
    pkg.dependencies?.["@phosphor-icons/react"],
    undefined,
    "codemini-web should not depend on @phosphor-icons/react",
  );
});

test("client source imports Tabler via the shared icon adapter", async () => {
  const files = await walkFiles(CLIENT_ROOT);
  const phosphorHits = [];
  let adapterHits = 0;
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    if (text.includes("@phosphor-icons/react")) phosphorHits.push(file);
    if (text.includes("@/lib/icons") || text.includes("../lib/icons")) {
      adapterHits += 1;
    }
  }
  assert.deepEqual(
    phosphorHits,
    [],
    `Phosphor imports should be gone: ${phosphorHits.join(", ")}`,
  );
  assert.ok(adapterHits > 0, "client files should import @/lib/icons");

  const adapter = await fs.readFile(
    path.join(CLIENT_ROOT, "src/lib/icons.js"),
    "utf8",
  );
  assert.match(adapter, /@tabler\/icons-react/);
  assert.match(
    adapter,
    /weight/,
    "adapter should keep Phosphor-style weight props for fill/bold",
  );
});

test("compact control icons keep an explicit size so Tabler 24px defaults do not clip", async () => {
  const checkbox = await fs.readFile(
    path.join(CLIENT_ROOT, "src/components/ui/checkbox.jsx"),
    "utf8",
  );
  assert.match(
    checkbox,
    /<Check[^>]*size=\{14\}/,
    "checkbox checkmark must be sized to fit the 16px control",
  );

  const radio = await fs.readFile(
    path.join(CLIENT_ROOT, "src/components/ui/radio-group.jsx"),
    "utf8",
  );
  assert.match(
    radio,
    /<Circle[\s\S]*size=\{8\}/,
    "radio indicator must be smaller than the 16px control",
  );
});
