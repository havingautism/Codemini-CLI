import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const taskPrompt = `Fix this synthetic order-pricing project. quoteOrder must apply a 10% member discount to the subtotal BEFORE tax, and round the final amount to two decimal places. Quantities must be positive safe integers. Preserve the API. Update README.md to explain the discount rule. Run the existing tests. Do not modify test/, package.json or AGENTS.md. Work only in this project; use file tools for inspection and changes. The shell accepts only npm test or node --test test/*.test.js. Stop after reporting the result.`;

export async function createFixture(root) {
  const files = {
    'package.json': JSON.stringify({ name: 'tool-benchmark-orders', private: true, type: 'module', scripts: { test: 'node --test test/*.test.js' } }, null, 2) + '\n',
    'AGENTS.md': '# Synthetic tool benchmark\nUse built-in file tools. Keep changes in this project. Tests are the acceptance contract.\n',
    'README.md': '# Desk Orders\nA small order-pricing library. Pricing rules need documenting.\n',
    'src/quantity.js': `export function validateQuantity(qty) {\n  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quantity');\n  return qty;\n}\n`,
    'src/pricing.js': `import { validateQuantity } from './quantity.js';\n\n` +
      Array.from({ length: 280 }, (_, i) => `// Catalog field ${String(i).padStart(3, '0')}: BENCH_NEEDLE reference documentation.`).join('\n') +
      `\n\nexport function quoteOrder(items, { member = false, taxRate = 0 } = {}) {\n  const subtotal = items.reduce((sum, item) => sum + item.price * validateQuantity(item.qty), 0);\n  const total = subtotal * (1 + taxRate) - (member ? 10 : 0);\n  return Math.round(total * 100) / 100;\n}\n`,
    'test/pricing.test.js': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quoteOrder } from '../src/pricing.js';\ntest('nonmember order', () => assert.equal(quoteOrder([{price: 100, qty: 2}], {taxRate: 0.1}), 220));\ntest('member discount before tax', () => assert.equal(quoteOrder([{price: 100, qty: 2}], {member: true, taxRate: 0.1}), 198));\ntest('fractional quantities rejected', () => assert.throws(() => quoteOrder([{price: 2, qty: 1.5}])));\n`,
    'docs/settings.json': JSON.stringify({ taxRate: 0.1, currency: 'CNY' }, null, 2) + '\n',
  };
  // No dependencies, network, user documents or real repository data.
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), text);
  }
  await fs.mkdir(path.join(root, 'catalog'), { recursive: true });
  for (let i = 0; i < 110; i += 1) {
    await fs.writeFile(path.join(root, 'catalog', `item-${String(i).padStart(3, '0')}.txt`), `Synthetic item ${i}\n`);
  }
  return Object.fromEntries(['test/pricing.test.js', 'package.json', 'AGENTS.md'].map((file) => [file, digest(files[file])]));
}

const digest = (text) => createHash('sha256').update(text).digest('hex');

export async function checkAcceptance(root, protectedHashes) {
  const checks = {};
  for (const [file, hash] of Object.entries(protectedHashes)) checks[`unchanged:${file}`] = digest(await fs.readFile(path.join(root, file))) === hash;
  const modulePath = path.join(root, 'src/pricing.js');
  const program = `import assert from 'node:assert/strict'; import {pathToFileURL} from 'node:url'; const {quoteOrder:q}=await import(pathToFileURL(process.argv[1]));
assert.equal(q([{price:100,qty:2}],{member:true,taxRate:0.1}),198);
assert.equal(q([{price:100,qty:2}],{member:false,taxRate:0.1}),220);
assert.equal(q([{price:19.99,qty:3}],{member:true,taxRate:0.07}),57.75);
assert.equal(q([],{member:true,taxRate:0.1}),0);
for(const qty of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>q([{price:2,qty}]));
console.log('INDEPENDENT_ACCEPTANCE_OK');`;
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', program, modulePath], { cwd: root, timeout: 10000, windowsHide: true });
    checks.independentBehavior = result.stdout.includes('INDEPENDENT_ACCEPTANCE_OK');
  } catch { checks.independentBehavior = false; }
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  checks.documentedDiscount = /10\s*%|0\.9|九折/.test(readme) && /tax|税/i.test(readme);
  return { passed: Object.values(checks).every(Boolean), checks };
}
