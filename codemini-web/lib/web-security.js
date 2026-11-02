import { loginPage } from './login-page.js';
import { isWebConfigReadOnly } from '../shared/web-config-policy.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export const isSecretConfigKey = key => /(?:api_?key|access_?token|refresh_?token|auth_?token|secret|password|authorization)$|^token$/i.test(key);
export function assertConfigPath(key) {
  if (typeof key !== 'string' || key.split('.').some(p => !p || forbidden.has(p))) throw new Error('Invalid configuration path');
}
export function assertWebConfigWritable(key) {
  assertConfigPath(key);
  if (isWebConfigReadOnly(key)) throw new Error('Security configuration is read-only in Web UI; use the local CLI');
}
export function publicConfig(value) {
  if (Array.isArray(value)) return value.map(publicConfig);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key)) continue;
    if (isSecretConfigKey(key)) {
      out[key === 'api_key' ? 'hasApiKey' : `has${key.replace(/(^|_)(\w)/g, (_, a, b) => b.toUpperCase())}`] = Boolean(item);
    } else out[key] = publicConfig(item);
  }
  return out;
}
export function buildLoginUrl(origin, token) {
  const url = new URL('/login', origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}
export function formatLoginInstructions(origin, token, tokenPath) {
  return [
    '  点击下面的 Login 链接自动登录，或把 Token 后的内容粘贴到登录页。',
    `  Login: ${buildLoginUrl(origin, token)}`,
    `  Token: ${token}`,
    `  Token 文件: ${tokenPath}`,
    '  服务重启后请使用新的登录信息。',
  ].join('\n');
}
export async function createWebSecurity({ directory, host, port, terminalEnabled = false, devOrigin = '' }) {
  const token = randomBytes(32).toString('hex');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(directory, `web-token-${port}-${randomBytes(6).toString('hex')}`);
  await fs.writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' });
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(!['0.0.0.0', '::'].includes(host) ? [host] : [])].map(h => `${h}:${port}`));
  if (devOrigin) {
    const parsed = new URL(devOrigin);
    if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        || parsed.origin !== devOrigin) throw new Error('Dev origin must be an exact loopback HTTP origin');
    hosts.add(parsed.host);
  }
  const matches = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  return { tokenPath, loginInstructions: origin => formatLoginInstructions(origin, token, tokenPath), async handle(req, res, url) {
    const deny = (status, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: true, message })); return true; };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!hosts.has(req.headers.host)) return deny(403, 'Invalid Host');
    const origin = `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== origin) return deny(403, 'Cross-origin request denied');
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny(403, 'Cross-site request denied');
    const showLogin = () => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "frame-ancestors 'none'; default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
      res.end(loginPage); return true;
    };
    if (req.method === 'GET' && url.pathname === '/login') return showLogin();
    if (req.method === 'POST' && url.pathname === '/auth') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1024) return deny(413, 'Request too large'); }
      let supplied; try { supplied = JSON.parse(body).token; } catch {}
      if (!matches(supplied)) return deny(401, 'Unauthorized');
      res.setHeader('Set-Cookie', `codemini_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(204); res.end(); return true;
    }
    const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('codemini_session='))?.slice('codemini_session='.length);
    if (!matches(String(req.headers.authorization || '').replace(/^Bearer /, '')) && !matches(cookie)) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && String(req.headers.accept || '').includes('text/html')) {
        return showLogin();
      }
      return deny(401, 'Unauthorized');
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return deny(400, 'Invalid URL'); }
    if (/^\/api\/terminal(?:\/|$)/.test(pathname) && !terminalEnabled) return deny(403, 'Web terminal is disabled; enable webui.terminal_enabled using the local CLI');
    return false;
  }};
}
