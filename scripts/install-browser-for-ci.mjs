import { execFileSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { chmod, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const browser = String(process.env.CODEMINI_CI_BROWSER || 'chrome').toLowerCase();
const platform = process.platform;
const arch = process.arch;

function githubEnv(name, value) {
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

function chromePlatform() {
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  if (platform === 'linux' && arch === 'arm64') return 'linux64';
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'darwin') return 'mac-x64';
  if (platform === 'win32' && arch === 'arm64') return 'win64';
  if (platform === 'win32') return 'win64';
  return '';
}

function edgeCandidates() {
  if (platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
  }
  if (platform === 'linux') {
    return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'];
  }
  if (platform === 'darwin') {
    return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return [];
}

async function downloadChrome() {
  const target = chromePlatform();
  if (!target) throw new Error(`No Chrome for Testing build for ${platform} ${arch}`);
  if (platform === 'linux' && arch === 'arm64') {
    throw new Error('Chrome for Testing does not publish a linux-arm64 browser. Use the macOS arm64 job for arm64 coverage.');
  }
  const catalog = await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json');
  if (!catalog.ok) throw new Error(`Chrome for Testing catalog HTTP ${catalog.status}`);
  const json = await catalog.json();
  const stable = json.channels.Stable;
  const download = (stable.downloads.chrome || []).find((item) => item.platform === target);
  if (!download?.url) throw new Error(`No stable Chrome download for ${target}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codemini-chrome-'));
  const zipPath = path.join(directory, 'chrome.zip');
  const response = await fetch(download.url);
  if (!response.ok) throw new Error(`Chrome download HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
  if (platform === 'win32') {
    execFileSync('tar', ['-xf', zipPath, '-C', directory], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', zipPath, '-d', directory], { stdio: 'inherit' });
  }
  const binaryName = platform === 'win32' ? 'chrome.exe' : platform === 'darwin' ? 'Google Chrome for Testing' : 'chrome';
  const found = walk(directory).find((file) => path.basename(file) === binaryName || file.endsWith(`${path.sep}Google Chrome for Testing`));
  if (!found) throw new Error(`Downloaded Chrome for ${stable.version} but did not find ${binaryName}`);
  if (platform !== 'win32') await chmod(found, 0o755);
  console.log(`Chrome for Testing ${stable.version} ${target}: ${found}`);
  return found;
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

if (browser === 'msedge') {
  let found = edgeCandidates().find((candidate) => existsSync(candidate));
  if (!found && platform === 'linux') {
    execFileSync('sudo', ['apt-get', 'update'], { stdio: 'inherit' });
    execFileSync('bash', ['-lc', `
      curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor | sudo tee /usr/share/keyrings/microsoft-edge.gpg >/dev/null
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main" | sudo tee /etc/apt/sources.list.d/microsoft-edge.list
      sudo apt-get update
      sudo apt-get install -y microsoft-edge-stable
    `], { stdio: 'inherit' });
    found = edgeCandidates().find((candidate) => existsSync(candidate));
  }
  if (!found) {
    throw new Error(`Microsoft Edge is not installed on ${platform} ${arch}`);
  }
  githubEnv('CODEMINI_BROWSER_EXECUTABLE', found);
  githubEnv('CODEMINI_BROWSER_CHANNEL', 'msedge');
} else {
  const executable = await downloadChrome();
  githubEnv('CODEMINI_BROWSER_EXECUTABLE', executable);
  githubEnv('CODEMINI_BROWSER_CHANNEL', 'chrome');
}

