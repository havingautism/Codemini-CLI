'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveAppRoot,
  resolveServerEntry,
  resolveWebIndex,
  buildServerArgs,
  readProjectArg,
  buildLoginUrl,
  isLocalAppUrl,
  findFreePort,
} = require('./runtime-plan.cjs');

const READY_TIMEOUT_MS = 60_000;
let serverProcess = null;
let mainWindow = null;
let shuttingDown = false;
let loginUrl = '';

function appRoot() {
  return resolveAppRoot({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    moduleDir: __dirname,
  });
}

function logPath() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'desktop.log');
}

function writeLog(line) {
  try {
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must not block startup.
  }
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('Codemini Web UI did not become ready in time.'));
    }, READY_TIMEOUT_MS);
    const onMessage = (message) => {
      if (message && message.type === 'web:ready' && typeof message.tokenPath === 'string') {
        finish(resolve, message.tokenPath);
      }
    };
    const onExit = (code) => {
      finish(reject, new Error(`Web UI exited before login was ready (${code}).`));
    };
    const onError = (error) => finish(reject, error);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function stopServer() {
  const child = serverProcess;
  serverProcess = null;
  shuttingDown = true;
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill();
}

function attachServerLogs(child) {
  const append = (chunk) => {
    const text = chunk.toString();
    try {
      fs.appendFileSync(logPath(), text);
    } catch {
      // Ignore log write failures.
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('exit', (code) => {
    writeLog(`web server exit ${code}`);
    if (shuttingDown || code === 0 || code === null) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Codemini', `The local Web UI stopped unexpectedly (exit ${code}).`);
    }
  });
}

async function startServer() {
  const root = appRoot();
  const entry = resolveServerEntry(root);
  const index = resolveWebIndex(root);
  if (!fs.existsSync(entry) || !fs.existsSync(index)) {
    throw new Error('Built Web UI is missing. Run npm run build:web before starting the desktop app.');
  }
  const port = await findFreePort();
  const project = readProjectArg(process.argv);
  const child = spawn(process.execPath, [entry, ...buildServerArgs({ port, project })], {
    cwd: os.homedir(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  serverProcess = child;
  attachServerLogs(child);
  const tokenPath = await waitForReady(child);
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  writeLog(`web server ready on 127.0.0.1:${port}`);
  return buildLoginUrl(`http://127.0.0.1:${port}`, token);
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Codemini',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    icon: path.join(appRoot(), 'codemini-web', 'codemini_logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalAppUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  mainWindow.loadURL(url);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('dev.codemini.desktop');
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      loginUrl = await startServer();
      createWindow(loginUrl);
    } catch (error) {
      writeLog(error && error.stack ? error.stack : String(error));
      dialog.showErrorBox('Codemini', error && error.message ? error.message : String(error));
      app.quit();
    }
  });
  app.on('before-quit', stopServer);
  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });
}
