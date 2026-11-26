import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pickSkillFolder, windowsPickerCommand } from '../codemini-web/lib/skill-folder-picker.js';
import { safeRelativeSkillPath, stageSkillFolder } from '../codemini-web/lib/stage-skill-folder.js';
import { bytesToBase64, flattenSkillDrop } from '../codemini-web/client/src/lib/skill-folder-drop.js';
import { pickSkillFolder as pickSkillFolderRequest, stageSkillFolder as stageSkillFolderRequest } from '../codemini-web/client/src/hooks/use-api.js';
import { previewSkillSource } from '../src/commands/skill.js';

function entry(name, { directory = false, children = [], bytes = new Uint8Array() } = {}) {
  return {
    name,
    isDirectory: directory,
    listChildren: async () => children,
    readFile: async () => bytes,
  };
}

test('windows folder picker returns the chosen directory and treats an empty result as cancel', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-pick-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const execFile = async (file, args, options) => {
    calls.push({ file, args, options });
    if (calls.length === 1) await fs.writeFile(options.env.CODEMINI_FOLDER_PICK_OUT, `${directory}\n`);
    return { stdout: '', stderr: '' };
  };

  const picked = await pickSkillFolder({
    platform: 'win32',
    execFile,
    title: '选择技能文件夹',
  });
  assert.equal(picked.cancelled, false);
  assert.equal(picked.path, directory);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-NoProfile', '-STA', '-EncodedCommand']);
  assert.match(Buffer.from(calls[0].args[3], 'base64').toString('utf16le'), /FolderBrowserDialog/);
  assert.equal(calls[0].options.env.CODEMINI_FOLDER_PICK_TITLE, '选择技能文件夹');
  await assert.rejects(fs.access(calls[0].options.env.CODEMINI_FOLDER_PICK_OUT));

  const cancelled = await pickSkillFolder({ platform: 'win32', execFile });
  assert.deepEqual(cancelled, { cancelled: true, path: '' });
  assert.match(windowsPickerCommand().script, /CODEMINI_FOLDER_PICK_OUT/);
});

test('folder picker reports cancel, missing tools, and a non-directory selection', async (t) => {
  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-pick-file-')), 'notes.txt');
  t.after(() => fs.rm(path.dirname(filePath), { recursive: true, force: true }));
  await fs.writeFile(filePath, 'notes');

  const cancelled = await pickSkillFolder({
    platform: 'darwin',
    execFile: async () => {
      throw Object.assign(new Error('User canceled.'), { code: 1, stderr: 'User canceled.' });
    },
  });
  assert.equal(cancelled.cancelled, true);

  await assert.rejects(
    pickSkillFolder({
      platform: 'linux',
      execFile: async (file) => {
        throw Object.assign(new Error(`missing ${file}`), { code: 'ENOENT' });
      },
    }),
    { code: 'PICKER_UNAVAILABLE' },
  );
  await assert.rejects(
    pickSkillFolder({
      platform: 'darwin',
      execFile: async () => ({ stdout: filePath }),
    }),
    { code: 'NOT_A_DIRECTORY' },
  );
  await assert.rejects(pickSkillFolder({ platform: 'aix', execFile: async () => ({ stdout: '' }) }), {
    code: 'PICKER_UNAVAILABLE',
  });
});

test('linux folder picker falls back from zenity to kdialog', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-pick-linux-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = [];
  const picked = await pickSkillFolder({
    platform: 'linux',
    execFile: async (file) => {
      files.push(file);
      if (file === 'zenity') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { stdout: `${directory}\n` };
    },
  });
  assert.deepEqual(files, ['zenity', 'kdialog']);
  assert.equal(picked.path, directory);
});

test('dropped skill folders are staged inside a temp directory and can be previewed', async (t) => {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-stage-root-'));
  const stale = path.join(tmpdir, 'codemini-skill-drop-stale');
  await fs.mkdir(stale);
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await fs.utimes(stale, yesterday, yesterday);
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }));

  const markdown = '---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n';
  const staged = await stageSkillFolder([
    { path: 'demo-skill/SKILL.md', data: Buffer.from(markdown).toString('base64') },
    { path: 'demo-skill/notes.txt', data: Buffer.from('keep').toString('base64') },
  ], { tmpdir });

  assert.equal(await fs.readFile(path.join(staged.path, 'demo-skill', 'SKILL.md'), 'utf8'), markdown);
  assert.equal((await fs.readdir(tmpdir)).includes('codemini-skill-drop-stale'), false);
  const preview = await previewSkillSource(staged.path);
  assert.equal(preview.skills.some((skill) => skill.name === 'demo-skill'), true);

  await assert.rejects(stageSkillFolder([{ path: '../outside.txt', data: '' }], { tmpdir }), {
    code: 'INVALID_FOLDER',
  });
  await assert.rejects(stageSkillFolder([{ path: 'C:/Windows/outside.txt', data: '' }], { tmpdir }), {
    code: 'INVALID_FOLDER',
  });
  await assert.rejects(stageSkillFolder([], { tmpdir }), { code: 'FOLDER_EMPTY' });
  assert.equal(safeRelativeSkillPath('skills\\demo\\SKILL.md'), 'skills/demo/SKILL.md');
});

test('skill drop reading keeps folder files, skips heavy directories, and rejects loose files', async () => {
  const skill = entry('my-skill', {
    directory: true,
    children: [
      entry('SKILL.md', { bytes: new TextEncoder().encode('# Skill') }),
      entry('node_modules', {
        directory: true,
        children: [entry('left-pad.js', { bytes: new Uint8Array([1]) })],
      }),
      entry('guide.txt', { bytes: new TextEncoder().encode('guide') }),
    ],
  });
  const dropped = await flattenSkillDrop([skill]);
  assert.equal(dropped.rootName, 'my-skill');
  assert.deepEqual(dropped.files.map((file) => file.path).sort(), [
    'my-skill/SKILL.md',
    'my-skill/guide.txt',
  ]);
  assert.equal(bytesToBase64(dropped.files[0].data), Buffer.from(dropped.files[0].data).toString('base64'));

  await assert.rejects(
    flattenSkillDrop([entry('readme.txt', { bytes: new Uint8Array([1]) })]),
    { code: 'FOLDER_REQUIRED' },
  );
  await assert.rejects(
    flattenSkillDrop([entry('empty-skill', { directory: true, children: [] })]),
    { code: 'FOLDER_EMPTY' },
  );
  await assert.rejects(
    flattenSkillDrop([entry('big.bin', { bytes: new Uint8Array(32 * 1024 * 1024 + 1) })]),
    { code: 'FOLDER_TOO_LARGE' },
  );
});

test('skill folder client requests post the picker title and staged files', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, path: 'D:/skills/demo' }),
    };
  };
  try {
    await pickSkillFolderRequest({ title: '选择技能文件夹' });
    await stageSkillFolderRequest([{ path: 'SKILL.md', data: 'aGVsbG8=' }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].url, '/api/skills/pick-folder');
  assert.deepEqual(JSON.parse(requests[0].options.body), { title: '选择技能文件夹' });
  assert.equal(requests[1].url, '/api/skills/stage-folder');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    files: [{ path: 'SKILL.md', data: 'aGVsbG8=' }],
  });
});
