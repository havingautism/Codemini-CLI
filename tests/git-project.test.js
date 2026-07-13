import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitCwd, shouldAdoptGitCwd } from '../codemini-web/lib/git-project.js';

test('resolveGitCwd prefers session projectDir over fallback workspace', () => {
  const cwd = resolveGitCwd({
    sessionId: 's1',
    getSessionProjectDir: (id) => (id === 's1' ? 'E:\\Git Projects\\随手记' : ''),
    fallbackDir: 'C:\\Users\\me\\.codemini\\workspace',
  });
  assert.equal(cwd, 'E:\\Git Projects\\随手记');
});

test('shouldAdoptGitCwd ignores empty session cwd', () => {
  assert.equal(shouldAdoptGitCwd('', 'E:\\proj'), false);
  assert.equal(shouldAdoptGitCwd('E:\\proj', 'E:\\proj'), false);
  assert.equal(shouldAdoptGitCwd('E:\\proj', 'C:\\workspace'), true);
});
