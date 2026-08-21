import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGitSource } from '../src/commands/skill.js';

test('normalizeGitSource strips GitHub query strings and hashes', () => {
  assert.deepEqual(
    normalizeGitSource('https://github.com/acme/tools?tab=readme-ov-file'),
    { url: 'https://github.com/acme/tools.git', branch: null, subPath: '' },
  );
  assert.deepEqual(
    normalizeGitSource('https://github.com/acme/tools#readme'),
    { url: 'https://github.com/acme/tools.git', branch: null, subPath: '' },
  );
  assert.deepEqual(
    normalizeGitSource('https://www.github.com/acme/tools/?tab=skills-ov-file'),
    { url: 'https://github.com/acme/tools.git', branch: null, subPath: '' },
  );
});

test('normalizeGitSource parses tree and blob skill paths', () => {
  assert.deepEqual(
    normalizeGitSource('https://github.com/acme/tools/tree/main/skills/foo?plain=1'),
    { url: 'https://github.com/acme/tools.git', branch: 'main', subPath: 'skills/foo' },
  );
  assert.deepEqual(
    normalizeGitSource('https://github.com/acme/tools/blob/main/skills/foo/SKILL.md'),
    { url: 'https://github.com/acme/tools.git', branch: 'main', subPath: 'skills/foo' },
  );
});

test('normalizeGitSource accepts npx skills add and owner/repo', () => {
  assert.deepEqual(
    normalizeGitSource('npx skills@latest add acme/tools'),
    { url: 'https://github.com/acme/tools.git', branch: null, subPath: '' },
  );
  assert.deepEqual(
    normalizeGitSource('acme/tools'),
    { url: 'https://github.com/acme/tools.git', branch: null, subPath: '' },
  );
  assert.equal(normalizeGitSource('/tmp/local-skill'), null);
  assert.equal(normalizeGitSource('C:\\skills\\local'), null);
});
