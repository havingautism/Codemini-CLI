import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveGitCwd } from '../codemini-web/lib/git-project.js';

test('git cwd prefers the active session project over a stale global fallback', () => {
  const projects = {
    'session-git': 'E:\\Git Projects\\MyApp',
  };
  const cwd = resolveGitCwd({
    sessionId: 'session-git',
    getSessionProjectDir: (id) => projects[id] || '',
    fallbackDir: 'C:\\Users\\me\\.codemini\\workspace',
  });
  assert.equal(cwd, 'E:\\Git Projects\\MyApp');
});

test('git cwd falls back when session has no projectDir', () => {
  const cwd = resolveGitCwd({
    sessionId: 'session-missing',
    getSessionProjectDir: () => '',
    fallbackDir: 'E:\\Git Projects\\Codemini-CLI',
  });
  assert.equal(cwd, 'E:\\Git Projects\\Codemini-CLI');
});

test('git cwd falls back when sessionId is omitted', () => {
  const cwd = resolveGitCwd({
    sessionId: '',
    getSessionProjectDir: () => 'E:\\should-not-use',
    fallbackDir: 'E:\\fallback',
  });
  assert.equal(cwd, 'E:\\fallback');
});
