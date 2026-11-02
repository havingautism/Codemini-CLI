import test from 'node:test';
import assert from 'node:assert/strict';
import { activateSoul, fetchSoulContent } from '../codemini-web/client/src/hooks/use-api.js';

test('Soul detail requests disambiguate same-name daily and coding presets', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const urls = [];
  globalThis.fetch = async url => { urls.push(url); return Response.json({ content: 'fixture' }); };
  await fetchSoulContent('Default', 'daily');
  await fetchSoulContent('Default', 'coding');
  assert.deepEqual(urls, ['/api/souls/Default/content?category=daily', '/api/souls/Default/content?category=coding']);
});

test('failed Soul activation rejects instead of letting the UI report success', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => Response.json({ error: true, message: 'Runtime is busy' }, { status: 409 });
  await assert.rejects(activateSoul('Default', 'daily'), /Runtime is busy/);
  globalThis.fetch = async () => Response.json({ ok: true, category: 'daily', name: 'Default' });
  assert.equal((await activateSoul('Default', 'daily')).ok, true);
});
