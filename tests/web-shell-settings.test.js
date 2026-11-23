import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isWebConfigReadOnly, validateWebConfigValue } from "../codemini-web/shared/web-config-policy.js";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { getSandboxModeOptions, getShellOptions } = await import(
  "../codemini-web/client/src/lib/settings-options.js"
);

test("unavailable sandbox modes are hidden and host mode omits workspace write", () => {
  const unavailable = getSandboxModeOptions({
    availability: { backend: "none", confineAvailable: false },
  });
  assert.deepEqual(
    unavailable.map((option) => option.value),
    ["danger-full-access"],
  );
  assert.deepEqual(
    getSandboxModeOptions({ sandboxMode: "danger-full-access" }).map((option) => option.value),
    ["read-only", "danger-full-access"],
  );

  const seatbelt = getSandboxModeOptions({
    availability: { backend: "os", osKind: "seatbelt", confineAvailable: true },
  });
  assert.ok(seatbelt.some((option) => option.value === "workspace-write"));
});

test("shell settings separate Bash in the microVM from PowerShell on the Windows host", () => {
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
    availability: { backend: "none", confineAvailable: false, platform: "win32" },
  });
  assert.deepEqual(hostShell.map((option) => option.value), ["powershell"]);

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

test("Web settings save a supported shell without exposing other shell configuration", () => {
  assert.equal(isWebConfigReadOnly("shell.default"), false);
  assert.doesNotThrow(() => validateWebConfigValue("shell.default", "powershell"));
  assert.throws(() => validateWebConfigValue("shell.default", "cmd"), /must be bash or powershell/);
  assert.equal(isWebConfigReadOnly("shell.timeout_ms"), true);
  assert.equal(isWebConfigReadOnly("sandbox.image"), true);
});
