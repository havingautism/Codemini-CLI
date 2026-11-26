import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(new URL('../codemini-web/client/src/components/ProjectSelector.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../codemini-web/client/src/components/project-selector.css', import.meta.url), 'utf8');

test('project picker opts out of dialog edge bleed that clips the title and footer', () => {
  assert.match(dialog, /className="project-picker p-0"/);
  assert.match(styles, /\.project-picker\.project-picker\[data-slot="dialog-content"\] \[data-slot="dialog-header"\] \{[^}]*margin:\s*0/);
  assert.match(styles, /\.project-picker\.project-picker\[data-slot="dialog-content"\] \[data-slot="dialog-header"\] \{[^}]*border-bottom:\s*0/);
  assert.match(styles, /\.project-picker\[data-slot="dialog-content"\] \.project-picker-bottom \[data-slot="dialog-footer"\] \{[^}]*margin:\s*0/);
  assert.match(styles, /input:is\(:hover, :focus, :focus-visible\)[\s\S]*background-color:\s*transparent/);
  assert.match(styles, /input\.rounded-lg[\s\S]*border-radius:\s*0/);
});
