import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';
import { measureAll } from '../scripts/measure-tool-tokens.mjs';

// o200k_base tokens for what a request actually sends (active tool JSON +
// tool-related prompt). Ceilings sit a little above the trimmed baseline so a
// wording fix can land, and a schema or playbook that grows back fails.
const MODE_SENT_CEILINGS = {
  'linux:normal': 2450,
  'linux:plan': 3050,
  'linux:crew': 4350,
  'win32:normal': 3260,
  'win32:plan': 3840,
  'win32:crew': 4340,
  'win32-vm:normal': 3920,
  'win32-vm:plan': 3920,
  'win32-vm:crew': 4800,
};

test('model-facing tool tokens stay within the trimmed ceilings', () => {
  const report = measureAll();
  assert.equal(report.tokenizer, 'o200k_base');
  for (const mode of report.modes) {
    const ceiling = MODE_SENT_CEILINGS[mode.id];
    assert.ok(ceiling, `missing ceiling for ${mode.id}`);
    assert.ok(
      mode.sentTokens <= ceiling,
      `${mode.id} sent ${mode.sentTokens} tokens, ceiling ${ceiling}`,
    );
  }

  const linux = new Map(report.catalog.linux.tools.map((tool) => [tool.name, tool]));
  const win = new Map(report.catalog.win32.tools.map((tool) => [tool.name, tool]));
  assert.ok(linux.get('run_subagent').wireTokens <= 540);
  assert.ok(win.get('edit').wireTokens <= 380);
  assert.ok(win.get('read').wireTokens <= 310);
  assert.ok(linux.get('Bash').wireTokens <= 310);
  const updatePlan = report.legacy.linux.find((tool) => tool.name === 'update_plan');
  assert.ok(updatePlan.wireTokens <= 220);
  assert.equal(report.legacy.linux.some((tool) => tool.name === 'create_spec'), false);
});

test('alias-only parameters stay out of the model schema', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: '/workspace',
    platform: 'win32',
    config: { sandbox: { enabled: false }, shell: { default: 'powershell' } },
  });
  const byName = new Map(bundle.definitions.map((tool) => [tool.function.name, tool]));
  const read = byName.get('read').function.parameters.properties;
  const edit = byName.get('edit').function.parameters.properties;
  assert.equal(read.file_path, undefined);
  assert.equal(read.file, undefined);
  assert.equal(read.path.type, 'string');
  assert.equal(edit.file_path, undefined);
  assert.equal(edit.old_text, undefined);
  assert.equal(edit.new_text, undefined);
  assert.equal(edit.old_string.type, 'string');
  assert.equal(Object.keys(edit).at(-1), 'new_content');
  const grep = bundle.deferredDefinitions.grep.function.parameters.properties;
  assert.equal(grep.query, undefined);
  assert.equal(grep.pattern.type, 'string');
});
