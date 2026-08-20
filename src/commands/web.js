import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const WEB_SERVER = path.join(ROOT_DIR, 'codemini-web', 'server.js');
const WEB_DIST_INDEX = path.join(ROOT_DIR, 'codemini-web', 'dist', 'index.html');

function printWebHelp() {
  console.log(`Usage:
  codemini web [--port <port>] [--project <path>] [--session <id>] [--model <name>] [--no-open] [--host <addr>]
  codemini --web [--port <port>] [--project <path>] [--session <id>] [--model <name>] [--no-open] [--host <addr>]

Options:
  --port, -p      Port for the local Web UI server (default: 3210)
  --project, -d   Project directory to open first
  --session, -s   Existing session id to load
  --model, -m     Override model for this Web UI runtime
  --no-open       Start the server without opening a browser
  --host          Bind address (default: 127.0.0.1; use 0.0.0.0 only on trusted networks)`);
}

export async function handleWeb(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    printWebHelp();
    return;
  }

  if (!fs.existsSync(WEB_SERVER)) {
    throw new Error('Web UI server is missing from this installation.');
  }

  if (!fs.existsSync(WEB_DIST_INDEX)) {
    console.warn('codemini warning: built Web UI assets were not found; run the package build before publishing.');
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WEB_SERVER, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve();
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Web UI exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}
