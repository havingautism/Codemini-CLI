import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('memory dialog supports family filters, coding detail, and search debounce', async () => {
  const dialog = await fs.readFile('codemini-web/client/src/components/MemoryDialog.jsx', 'utf8');
  const en = await fs.readFile('codemini-web/client/i18n/en.js', 'utf8');
  const zh = await fs.readFile('codemini-web/client/i18n/zh.js', 'utf8');

  assert.match(dialog, /const FAMILIES = \["all", "personal", "repo", "coding", "procedure"\]/);
  assert.match(dialog, /setTimeout\(\(\) => setDebouncedQuery\(query\.trim\(\)\), 200\)/);
  assert.match(dialog, /memoryFamily === "all"/);
  assert.match(dialog, /memory\.recallReason/);
  assert.match(dialog, /evidence\.failed_approach/);
  assert.match(dialog, /evidence\.working_approach/);
  assert.match(dialog, /memoryHits/);
  assert.match(dialog, /memoryWhyRecalled/);
  assert.match(dialog, /idPrefix=\{`\$\{view\}-family`\}/);

  for (const source of [en, zh]) {
    assert.match(source, /memoryFamilyPersonal:/);
    assert.match(source, /memoryFamilyCoding:/);
    assert.match(source, /memoryWhyRecalled:/);
    assert.match(source, /memoryFailedApproach:/);
    assert.match(source, /memoryWorkingApproach:/);
  }
});
