import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { createWebSecurity, buildLoginUrl, formatLoginInstructions } from '../codemini-web/lib/web-security.js';

test('development login preserves exact origin checks and puts credentials only in the fragment', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-login-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const security = await createWebSecurity({ directory, host: '127.0.0.1', port: 5000, devOrigin: 'http://127.0.0.1:5178' });
  const token = await fs.readFile(security.tokenPath, 'utf8');
  const url = new URL(buildLoginUrl('http://127.0.0.1:5178', token));
  const instructions = formatLoginInstructions(url.origin, token, security.tokenPath);
  assert.ok(instructions.includes('Token: ' + token));
  assert.ok(instructions.includes('Login: ' + url.href));
  assert.equal(url.pathname, '/login'); assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), token);
  async function request(pathname, { host = '127.0.0.1:5178', origin, method = 'GET', body = '', cookie } = {}) {
    const req = Readable.from([body]); Object.assign(req, { method, headers: { host, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
    const handled = await security.handle(req, res, new URL(pathname, 'http://127.0.0.1:5178'));
    return { ...res, handled };
  }
  assert.equal((await request('/api/config')).status, 401);
  assert.equal((await request('/auth', { origin: 'http://127.0.0.1:9999', method: 'POST', body: JSON.stringify({ token }) })).status, 403);
  assert.equal((await request('/login', { host: '127.0.0.1:9999' })).status, 403);
  const login = await request('/auth', { origin: url.origin, method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(login.status, 204);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  assert.equal((await request('/api/config', { cookie })).handled, false);
  const page = await request('/login', { cookie });
  assert.equal(page.status, 200);
  assert.ok(!page.body.includes(token));

  const order = [];
  const element = () => ({ value: '', type: 'password', setAttribute() {}, removeAttribute() {}, focus() {} });
  const form = element();
  const elements = { token: element(), submit: element(), 'toggle-token': element(), error: element() };
  const error = elements.error;
  vm.runInNewContext(page.body.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URLSearchParams, URL,
    document: { querySelector: () => form, getElementById: id => elements[id] },
    location: { hash: url.hash, pathname: '/login', search: '', replace: value => order.push(['redirect', value]) },
    history: { replaceState: (...args) => order.push(['clear', args[2]]) },
    fetch: async (path, options) => { order.push(['fetch', path, JSON.parse(options.body).token]); return { ok: true }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, [['clear', '/login'], ['fetch', '/auth', token], ['redirect', '/']]);
});
