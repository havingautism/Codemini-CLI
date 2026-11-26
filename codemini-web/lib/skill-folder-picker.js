import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);
const PICK_TIMEOUT_MS = 3 * 60 * 1000;

const WINDOWS_PICK_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$title = [string]$env:CODEMINI_FOLDER_PICK_TITLE
if ([string]::IsNullOrWhiteSpace($title)) { $title = 'Select a skill folder' }
$dialog.Description = $title
$dialog.ShowNewFolderButton = $false
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
[void]$owner.Show()
[void]$owner.Activate()
$result = $dialog.ShowDialog($owner)
$owner.Close()
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($env:CODEMINI_FOLDER_PICK_OUT, $dialog.SelectedPath, $utf8)
}
`.trim();

function folderError(code, message) {
  return Object.assign(new Error(message), { code });
}

function trimTrailingSeparator(value) {
  const text = String(value || '').trim();
  if (!text || /^[a-z]:[\\/]$/i.test(text) || text === '/' || text === '\\') return text;
  return text.replace(/[\\/]+$/u, '');
}

function cancelledByUser(error) {
  const text = `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`;
  return Number(error?.code) === 1 && /cancel/iu.test(text);
}

function commandFailure(error, unavailableCode = 'PICKER_FAILED') {
  if (error?.code === 'ENOENT') {
    return folderError('PICKER_UNAVAILABLE', 'This system has no folder picker.');
  }
  if (error?.killed) return folderError('PICKER_TIMEOUT', 'Folder picker timed out.');
  const detail = String(error?.stderr || error?.message || 'Folder picker failed.').trim();
  return folderError(unavailableCode, detail.slice(0, 500));
}

async function readPickOutput(filePath, fsApi) {
  try {
    return String(await fsApi.readFile(filePath, 'utf8')).replace(/^\uFEFF/u, '').trim();
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export function windowsPickerCommand() {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(WINDOWS_PICK_SCRIPT, 'utf16le').toString('base64')],
    script: WINDOWS_PICK_SCRIPT,
  };
}

async function pickWindows({ execFile, title, tmpdir, fsApi }) {
  const outPath = path.join(tmpdir, `codemini-folder-pick-${randomUUID()}.txt`);
  const command = windowsPickerCommand();
  let picked = '';
  try {
    await execFile(command.file, command.args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: PICK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        CODEMINI_FOLDER_PICK_OUT: outPath,
        CODEMINI_FOLDER_PICK_TITLE: title,
      },
    });
    picked = await readPickOutput(outPath, fsApi);
  } catch (error) {
    picked = await readPickOutput(outPath, fsApi);
    if (!picked) throw commandFailure(error);
  } finally {
    await fsApi.rm(outPath, { force: true }).catch(() => {});
  }
  return picked;
}

async function pickDarwin({ execFile, title }) {
  try {
    const { stdout } = await execFile('osascript', [
      '-e', 'on run argv',
      '-e', 'try',
      '-e', 'return POSIX path of (choose folder with prompt (item 1 of argv))',
      '-e', 'on error number -128',
      '-e', 'return ""',
      '-e', 'end try',
      '-e', 'end run',
      title,
    ], { encoding: 'utf8', timeout: PICK_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    return String(stdout || '').trim();
  } catch (error) {
    if (cancelledByUser(error)) return '';
    throw commandFailure(error);
  }
}

async function pickLinux({ execFile, title }) {
  try {
    const { stdout } = await execFile('zenity', [
      '--file-selection',
      '--directory',
      `--title=${title}`,
    ], { encoding: 'utf8', timeout: PICK_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    return String(stdout || '').trim();
  } catch (error) {
    if (Number(error?.code) === 1) return '';
    if (error?.code !== 'ENOENT') throw commandFailure(error);
  }
  try {
    const { stdout } = await execFile('kdialog', [
      '--getexistingdirectory',
      '.',
      '--title',
      title,
    ], { encoding: 'utf8', timeout: PICK_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    return String(stdout || '').trim();
  } catch (error) {
    if (Number(error?.code) === 1) return '';
    throw commandFailure(error);
  }
}

async function acceptDirectory(folderPath, fsApi) {
  const folder = trimTrailingSeparator(folderPath);
  let stat;
  try {
    stat = await fsApi.stat(folder);
  } catch {
    throw folderError('NOT_A_DIRECTORY', 'Selected folder is not available.');
  }
  if (!stat.isDirectory()) throw folderError('NOT_A_DIRECTORY', 'Selected path is not a folder.');
  return folder;
}

export async function pickSkillFolder({
  platform = process.platform,
  execFile = execFileAsync,
  title = 'Select a skill folder',
  fs: fsApi = fs,
  tmpdir = os.tmpdir(),
} = {}) {
  const prompt = String(title || 'Select a skill folder').replace(/[\u0000-\u001f]/gu, '').slice(0, 200);
  let picked = '';
  if (platform === 'win32') picked = await pickWindows({ execFile, title: prompt, tmpdir, fsApi });
  else if (platform === 'darwin') picked = await pickDarwin({ execFile, title: prompt });
  else if (platform === 'linux') picked = await pickLinux({ execFile, title: prompt });
  else throw folderError('PICKER_UNAVAILABLE', 'This system has no folder picker.');
  if (!picked) return { cancelled: true, path: '' };
  return { cancelled: false, path: await acceptDirectory(picked, fsApi) };
}
