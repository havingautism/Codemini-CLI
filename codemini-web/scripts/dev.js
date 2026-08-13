import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const isWindows = process.platform === 'win32';
// Always reuse the node that launched this script (avoids WSL picking Windows bun → node.exe).
const nodeBin = process.execPath;
const viteCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/vite/bin/vite.js',
);

let shuttingDown = false;
const children = new Set();

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 300; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(isWindows ? 'SIGTERM' : 'SIGINT');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

function startProcess(proc, env = {}) {
  const child = spawn(proc.command || nodeBin, proc.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env, FORCE_COLOR: '1' },
    stdio: ['inherit', 'pipe', 'pipe']
  });
  child.once('error', (error) => {
    console.error(`[${proc.name}] failed to start: ${error.message}`);
    stopAll(1);
  });
  children.add(child);

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${proc.name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${proc.name}] ${chunk}`);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[${proc.name}] exited with code ${code}`);
      stopAll(code || 1);
    }
  });
  return child;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, { timeoutMs = 60000, intervalMs = 200, label = 'service' } = {}) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(`[${label}] waiting for http://127.0.0.1:${port} (${Math.round((Date.now() - started) / 1000)}s)...`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

const apiPort = await findFreePort(Number(process.env.CODEMINI_API_PORT || 5000));
const webPort = await findFreePort(Number(process.env.CODEMINI_WEB_PORT || 5178));

console.log(`Codemini dev server`);
console.log(`  Web: http://127.0.0.1:${webPort}`);
console.log(`  API: http://127.0.0.1:${apiPort}`);
console.log(`  Node: ${process.platform} ${process.version} (${nodeBin})`);

startProcess({
  name: 'api',
  command: nodeBin,
  args: ['server.js', '--port', String(apiPort), '--no-open']
});

if (!await waitForPort(apiPort, { label: 'api' })) {
  console.error(`[api] did not start on http://127.0.0.1:${apiPort}`);
  stopAll(1);
}

startProcess({
  name: 'vite',
  command: nodeBin,
  args: [
    viteCli,
    '--config',
    'vite.config.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(webPort),
    '--strictPort',
    '--open',
    '/',
  ]
}, {
  CODEMINI_API_PORT: String(apiPort)
});

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
