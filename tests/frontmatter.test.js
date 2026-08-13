import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFrontmatter, serializeFrontmatter } from '../src/core/frontmatter.js';

test('frontmatter helper parses nested YAML and round-trips metadata', () => {
  const source = `---\nname: demo\ntriggers:\n  - review\nhooks:\n  Stop:\n    - command: npm test\nenabled: false\n---\n\n# Demo\n`;
  const parsed = parseFrontmatter(source);

  assert.deepEqual(parsed.metadata, {
    name: 'demo',
    triggers: ['review'],
    hooks: { Stop: [{ command: 'npm test' }] },
    enabled: false,
  });
  assert.equal(parsed.content, '# Demo');
  assert.deepEqual(parseFrontmatter(serializeFrontmatter(parsed.metadata, parsed.content)), parsed);
});
