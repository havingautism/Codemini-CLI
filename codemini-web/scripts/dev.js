import { spawn } from 'node:child_process';
import net from 'node:net';

const isWindows = process.platform === 'win32';
const bunBin = isWindows ? 'bun.exe' : 'bun';
const nodeBin = isWindows ? 'node.exe' : 'node';

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
  const child = spawn(proc.command || bunBin, proc.args, {
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

async function waitForPort(port, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

const apiPort = await findFreePort(Number(process.env.CODEMINI_API_PORT || 5000));
const webPort = await findFreePort(Number(process.env.CODEMINI_WEB_PORT || 5178));

console.log(`Codemini dev server`);
console.log(`  Web: http://127.0.0.1:${webPort}`);
console.log(`  API: http://127.0.0.1:${apiPort}`);

startProcess({
  name: 'api',
  command: nodeBin,
  args: ['server.js', '--port', String(apiPort), '--no-open']
});

if (!await waitForPort(apiPort)) {
  console.error(`[api] did not start on http://127.0.0.1:${apiPort}`);
  stopAll(1);
}

startProcess({
  name: 'vite',
  args: ['x', 'vite', '--config', 'vite.config.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--open', '/']
}, {
  CODEMINI_API_PORT: String(apiPort)
});

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
