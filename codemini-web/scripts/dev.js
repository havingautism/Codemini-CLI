import { spawn } from 'node:child_process';
import net from 'node:net';

const isWindows = process.platform === 'win32';
const bin = isWindows ? 'bun.exe' : 'bun';

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
  const child = spawn(bin, proc.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env, FORCE_COLOR: '1' },
    stdio: ['inherit', 'pipe', 'pipe']
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
}

const apiPort = await findFreePort(Number(process.env.CODEMINI_API_PORT || 5000));
const webPort = await findFreePort(Number(process.env.CODEMINI_WEB_PORT || 5178));

console.log(`Codemini dev server`);
console.log(`  Web: http://127.0.0.1:${webPort}`);
console.log(`  API: http://127.0.0.1:${apiPort}`);

startProcess({
  name: 'api',
  args: ['server.js', '--port', String(apiPort), '--no-open']
});

startProcess({
  name: 'vite',
  args: ['x', 'vite', '--config', 'vite.config.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--open', '/']
}, {
  CODEMINI_API_PORT: String(apiPort)
});

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
