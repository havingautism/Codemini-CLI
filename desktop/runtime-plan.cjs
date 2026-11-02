'use strict';

const net = require('node:net');
const path = require('node:path');

function resolveAppRoot({ isPackaged, appPath, moduleDir }) {
  if (isPackaged) return appPath;
  return path.resolve(moduleDir, '..');
}

function resolveServerEntry(appRoot) {
  return path.join(appRoot, 'codemini-web', 'server.js');
}

function resolveWebIndex(appRoot) {
  return path.join(appRoot, 'codemini-web', 'dist', 'index.html');
}

function buildServerArgs({ port, project } = {}) {
  const args = ['--port', String(port), '--host', '127.0.0.1', '--no-open'];
  const selected = typeof project === 'string' ? project.trim() : '';
  if (selected) args.push('--project', selected);
  return args;
}

function readProjectArg(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const index = args.indexOf('--project');
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return '';
  return value;
}

function buildLoginUrl(origin, token) {
  const url = new URL('/login', origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

function isLocalAppUrl(target) {
  try {
    const url = new URL(target);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1');
  } catch {
    return false;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

module.exports = {
  resolveAppRoot,
  resolveServerEntry,
  resolveWebIndex,
  buildServerArgs,
  readProjectArg,
  buildLoginUrl,
  isLocalAppUrl,
  findFreePort,
};
