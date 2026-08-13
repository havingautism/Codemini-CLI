import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseProjectRequirementsOptions,
  readProjectRequirementsReportState,
  renderProjectRequirementsDepthContract,
} from '../src/core/chat-runtime.js';

test('project requirements depth is two-tier: fast vs full/deep', () => {
  assert.equal(parseProjectRequirementsOptions([]).depth, 'fast');
  assert.equal(parseProjectRequirementsOptions(['--fast']).depth, 'fast');
  assert.equal(parseProjectRequirementsOptions(['--deep']).depth, 'deep');
  assert.equal(parseProjectRequirementsOptions(['--完整']).depth, 'deep');
  // legacy UI value maps to full
  assert.equal(parseProjectRequirementsOptions(['--standard']).depth, 'deep');
});

test('depth contract text differs between fast and full', () => {
  const fast = renderProjectRequirementsDepthContract('fast');
  const full = renderProjectRequirementsDepthContract('deep');
  assert.match(fast, /Depth: fast/);
  assert.match(full, /Depth: full/);
  assert.notEqual(fast, full);
});

test('empty HTML shell with 等待填写 is not looksComplete', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-shell-'));
  const reportPath = 'docs/requirements/shell.html';
  const absolute = path.join(dir, reportPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(
    absolute,
    [
      '<!-- REQUIREMENTS_SUMMARY -->',
      '<p class="placeholder">等待填写摘要。</p>',
      '<!-- /REQUIREMENTS_SUMMARY -->',
      '<!-- REQUIREMENTS_INTERFACE_INVENTORY -->',
      '<p class="placeholder">等待填写接口清单。</p>',
      '<!-- /REQUIREMENTS_INTERFACE_INVENTORY -->',
      '<!-- REQUIREMENTS_API_CARDS -->',
      '<p class="placeholder">等待填写需求卡片。</p>',
      '<!-- /REQUIREMENTS_API_CARDS -->',
    ].join('\n'),
    'utf8',
  );
  const state = await readProjectRequirementsReportState(reportPath, 'html', dir);
  assert.equal(state.looksComplete, false);
});

test('filled HTML markers count as looksComplete', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-filled-'));
  const reportPath = 'docs/requirements/filled.html';
  const absolute = path.join(dir, reportPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const paragraph = `<p>${'证据路径与接口说明。'.repeat(20)}</p>`;
  await fs.writeFile(
    absolute,
    [
      '<!-- REQUIREMENTS_SUMMARY -->',
      paragraph,
      '<!-- /REQUIREMENTS_SUMMARY -->',
      '<!-- REQUIREMENTS_INTERFACE_INVENTORY -->',
      paragraph,
      '<!-- /REQUIREMENTS_INTERFACE_INVENTORY -->',
      '<!-- REQUIREMENTS_API_CARDS -->',
      paragraph,
      '<!-- /REQUIREMENTS_API_CARDS -->',
    ].join('\n'),
    'utf8',
  );
  const state = await readProjectRequirementsReportState(reportPath, 'html', dir);
  assert.equal(state.looksComplete, true);
});
