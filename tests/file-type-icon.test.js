import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFileTypeIconName } from '../codemini-web/client/src/lib/file-type-icon.js';

const iconMap = {
  defaultFileIcon: 'file',
  fileExtensions: {
    js: 'javascript',
    'test.js': 'javascript-test',
    tsx: 'react',
  },
  fileNames: {
    dockerfile: 'docker',
  },
};

test('read line ranges keep the language icon of the underlying file', () => {
  const full = 'tests/write-tool-contract.test.js';
  const ranged = `${full}:120-120`;
  assert.equal(resolveFileTypeIconName(full, iconMap), 'javascript-test');
  assert.equal(resolveFileTypeIconName(ranged, iconMap), 'javascript-test');
  assert.equal(resolveFileTypeIconName('src\\App.tsx:1-40', iconMap), 'react');
});

test('icon lookup still prefers exact names and falls back for unknown types', () => {
  assert.equal(resolveFileTypeIconName('Dockerfile', iconMap), 'docker');
  assert.equal(resolveFileTypeIconName('notes/todo.txt:3-3', iconMap), 'file');
  assert.equal(resolveFileTypeIconName('src/main.js?raw', iconMap), 'javascript');
});
