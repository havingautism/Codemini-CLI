import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(new URL('../codemini-web/client/src/components/ConfirmDialog.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../codemini-web/client/src/conversation-design.css', import.meta.url), 'utf8');

test('ConfirmDialog always uses compact style without header and footer dividers', () => {
  assert.match(dialog, /data-compact="true"/);
  assert.doesNotMatch(dialog, /hasBody/);
  assert.doesNotMatch(dialog, /data-compact=\{/);
  assert.match(styles, /\[data-slot="dialog-content"\]\[data-compact="true"\]/);
  assert.match(styles, /\[data-slot="dialog-content"\]\[data-compact="true"\][^{]*\[data-slot="dialog-header"\][^{]*\{[^}]*border-bottom:\s*0/);
  assert.match(styles, /\[data-slot="dialog-content"\]\[data-compact="true"\][^{]*\[data-slot="dialog-footer"\][^{]*\{[^}]*border-top:\s*0/);
});

test('ConfirmDialog tightens title-to-button spacing even when a description is present', () => {
  assert.match(dialog, /description/);
  assert.match(dialog, /DialogDescription/);
  assert.match(dialog, /gap-2/);
  assert.doesNotMatch(dialog, /gap-5/);
  assert.doesNotMatch(dialog, /min-h-|minHeight/);
  assert.match(dialog, /DialogFooter[\s\S]*border-t-0/);
  // Compact style is not keyed off a missing description.
  assert.doesNotMatch(dialog, /hasBody \?/);
  assert.doesNotMatch(dialog, /Boolean\(description\)/);
  assert.match(dialog, /\{description \?/);
});
