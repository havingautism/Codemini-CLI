import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { getSandboxModeOptions, getShellOptions } = await import(
  "../codemini-web/client/src/lib/settings-options.js"
);

test("sandbox modes that cannot run are disabled without changing danger full access", () => {
  const unavailable = getSandboxModeOptions({
    availability: { backend: "none", confineAvailable: false },
  });
  assert.deepEqual(
    unavailable.filter((option) => option.disabled).map((option) => option.value),
    ["read-only", "workspace-write"],
  );
  assert.equal(unavailable.find((option) => option.value === "danger-full-access").disabled, undefined);

  const seatbelt = getSandboxModeOptions({
    availability: { backend: "os", osKind: "seatbelt", confineAvailable: true },
  });
  assert.equal(seatbelt.some((option) => option.disabled), false);
});

test("shell settings expose only Bash while the microVM sandbox is active", () => {
  const sandboxed = getShellOptions({
    sandboxMode: "workspace-write",
    availability: { backend: "vm", confineAvailable: true },
  });
  assert.deepEqual(
    sandboxed.filter((option) => !option.disabled).map((option) => option.value),
    ["bash"],
  );

  const hostShell = getShellOptions({
    sandboxMode: "workspace-write",
    availability: { backend: "none", confineAvailable: false },
  });
  assert.equal(hostShell.some((option) => option.disabled), false);

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
    /<SettingsChoiceList[\s\S]*?options=\{getSettingsOptions\(field\.optionsKey, \{ sandboxMode, availability \}\)\}/,
  );
});
