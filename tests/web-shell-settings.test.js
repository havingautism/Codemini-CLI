import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { getShellOptions } = await import(
  "../codemini-web/client/src/lib/settings-options.js"
);

test("shell settings expose only Bash while the microVM sandbox is active", () => {
  const sandboxed = getShellOptions({ sandboxMode: "workspace-write" });
  assert.deepEqual(
    sandboxed.filter((option) => !option.disabled).map((option) => option.value),
    ["bash"],
  );

  const unrestricted = getShellOptions({ sandboxMode: "danger-full-access" });
  assert.equal(unrestricted.some((option) => option.disabled), false);
});

test("the choice list receives the current sandbox mode", async () => {
  const source = await fs.readFile(
    new URL("../codemini-web/client/src/components/ConfigDialog.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<SettingsChoiceList[\s\S]*?options=\{getSettingsOptions\(field\.optionsKey, \{ sandboxMode \}\)\}/,
  );
});
