import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadToolPreview } from '../codemini-web/client/src/lib/read-tool-preview.js';

test('read preview keeps metadata separate, actual line offsets and blank lines intact', () => {
  const header = '[File: src/example.js, lines 101-104 of 200, truncated]';
  assert.deepEqual(parseReadToolPreview(`${header}\n101: function example() {\n102: \n103:   return "<script>";\n104: }\nContinue with offset=105.`), {
    header, startLine: 101, content: 'function example() {\n\n  return "<script>";\n}', footer: 'Continue with offset=105.',
  });
});

test('read preview preserves whitespace and source colons without formatting the code itself', () => {
  const result = parseReadToolPreview('[File: C:\\src\\a.py, lines 3-5 of 5]\r\n3: def example():\r\n4: \tvalue = "5: not a line number"\r\n5: \treturn value');
  assert.equal(result.startLine, 3);
  assert.equal(result.content, 'def example():\n\tvalue = "5: not a line number"\n\treturn value');
});

test('ambiguous, gapped and non-file outputs keep the plain-text fallback', () => {
  for (const output of ['Error: file not found', '[Directory: src]\na.js', '[File: empty, empty]',
    '[File: a.js, lines 1-3]\n1: first\n3: third', '[File: a.js]\n1: first\n... [omitted 20 chars] ...\n8: eighth',
    '[File: a.js]\nlegacy unnumbered text']) assert.equal(parseReadToolPreview(output), null);
});
