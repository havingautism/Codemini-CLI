import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loginPage } from '../codemini-web/lib/login-page.js';

function mount(fetch) {
  const element = () => ({ value: '', type: 'password', attrs: {}, textContent: '', setAttribute(k,v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, focus() {} });
  const form = element();
  const elements = Object.fromEntries(['token', 'submit', 'toggle-token', 'error'].map(id => [id, element()]));
  let destination;
  vm.runInNewContext(loginPage.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URL, URLSearchParams, document: { querySelector: () => form, getElementById: id => elements[id] },
    location: { hash: '', pathname: '/login', search: '', replace: value => { destination = value; } }, history: {}, fetch,
  });
  return { form, elements, destination: () => destination, submit: async value => {
    elements.token.value = value; form.onsubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  } };
}

test('login explains wrong input without sending it, accepts a complete link, and toggles visibility', async () => {
  const calls = [];
  const ui = mount(async (_, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; });
  await ui.submit('/Users/example/token-file');
  assert.equal(calls.length, 0);
  assert.match(ui.elements.error.textContent, /文件路径/);
  ui.elements['toggle-token'].onclick();
  assert.equal(ui.elements.token.type, 'text');
  assert.equal(ui.elements['toggle-token'].attrs['aria-pressed'], 'true');
  const token = 'a'.repeat(64);
  await ui.submit(` http://127.0.0.1:5178/login#token=${token} `);
  assert.equal(calls[0].token, token);
  assert.equal(ui.destination(), '/');
});

test('invalid credentials and offline errors provide retry guidance and reenable the form', async () => {
  for (const fetch of [async () => ({ ok: false, status: 401 }), async () => { throw Error('offline'); }]) {
    const ui = mount(fetch);
    await ui.submit('a'.repeat(64));
    assert.match(ui.elements.error.textContent, /Token|本地服务/);
    assert.equal(ui.elements.submit.disabled, false);
    assert.equal(ui.elements.submit.textContent, '重新连接');
    assert.equal(ui.destination(), undefined);
  }
});
