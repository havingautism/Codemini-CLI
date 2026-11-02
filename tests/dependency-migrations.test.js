import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractDocumentText } from '../codemini-web/lib/document-text.js';
import { DOCUMENT_ACCEPT, DOCUMENT_EXTENSIONS, SCRAPBOOK_ACCEPT } from '../codemini-web/shared/document-formats.js';
import { queryAst, queryAstGrep } from '../src/core/ast.js';
import { runProcess } from '../src/core/process-run.js';

function createTextPdf(text) {
  const contentStream = `BT /F1 18 Tf 72 100 Td (${text}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test('anydoc extracts text from PDF attachments', async () => {
  assert.match(await extractDocumentText(createTextPdf('Hello Codemini')), /Hello Codemini/);
});

test('anydoc preserves DOCX table structure for document imports', async () => {
  const file = new URL('./fixtures/anydoc-text.docx', import.meta.url);
  const markdown = await extractDocumentText(await fs.readFile(file));
  assert.match(markdown, /Hello Codemini/);
  assert.match(markdown, /\| Item \| Value \|/);
  assert.match(markdown, /\| Alpha \| 42 \|/);
});

test('document upload accepts Word, PowerPoint, and Excel formats', () => {
  assert.deepEqual(DOCUMENT_EXTENSIONS, [
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  ]);
  for (const extension of DOCUMENT_EXTENSIONS) {
    assert.ok(DOCUMENT_ACCEPT.split(',').includes(extension));
    assert.ok(SCRAPBOOK_ACCEPT.split(',').includes(extension));
  }
});

test('anydoc extracts PowerPoint slides and Excel tables', async () => {
  const slides = await fs.readFile(new URL('./fixtures/anydoc-slides.pptx', import.meta.url));
  const sheet = await fs.readFile(new URL('./fixtures/anydoc-sheet.xlsx', import.meta.url));
  assert.match(await extractDocumentText(slides), /Quarterly plan/);
  const table = await extractDocumentText(sheet);
  assert.match(table, /\| Quarter \| Revenue \|/);
  assert.match(table, /\| Q1 \| 42 \|/);
});

test('Execa v10 preserves the runProcess result contract', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'ok');
  assert.deepEqual(result.stdoutBuffer, Buffer.from('ok'));

  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(2)']),
    /bad/,
  );

  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 25 }),
    /timed out after 25ms/,
  );
});

test('upgraded Tree-sitter WASM and ast-grep parse built-in and dynamic languages', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-ast-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.js'), 'function greet(name) { return name; }\n');
  await fs.writeFile(path.join(root, 'sample.py'), 'print("hello")\n');

  const treeSitter = await queryAst(root, {
    path: 'sample.js',
    query: '(function_declaration name: (identifier) @name)',
  });
  assert.equal(treeSitter.matches[0]?.text, 'function greet(name) { return name; }');

  const astGrep = await queryAstGrep(root, {
    path: 'sample.js',
    pattern: 'function $NAME($$$ARGS) { $$$BODY }',
  });
  assert.equal(astGrep.matches[0]?.node_type, 'function_declaration');

  const dynamicLanguage = await queryAstGrep(root, {
    path: 'sample.py',
    language: 'python',
    pattern: 'print($VALUE)',
  });
  assert.equal(dynamicLanguage.matches[0]?.node_type, 'call');
});
