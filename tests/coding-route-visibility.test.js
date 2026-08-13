import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('automatic graph-selected skills become visible activity badges', async () => {
  const [bridge, appContext] = await Promise.all([
    fs.readFile('codemini-web/lib/runtime-bridge.js', 'utf8'),
    fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8'),
  ]);

  for (const source of [bridge, appContext]) {
    assert.match(source, /case ['"]skill:auto-selected['"]/);
    assert.match(
      source,
      /event\.type === ['"]skill:always['"] \? ['"]always['"] : ['"]selected['"]/,
    );
  }
});
