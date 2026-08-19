import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderCommandPrompt } from '../src/core/command-loader.js';
import { getSkillsDir } from '../src/core/paths.js';

test('Windows microsandbox skill prompts remap run paths to /codemini-skills', async () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-win-skill-global-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    const skillRoot = path.join(getSkillsDir(), 'demo');
    await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(skillRoot, 'references'), { recursive: true });
    const prompt = renderCommandPrompt({
      name: 'demo',
      path: path.join(skillRoot, 'SKILL.md'),
      metadata: { type: 'skill', rootPath: skillRoot },
      content: 'Follow the packaged scripts.',
    }, [], {
      config: { sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' } },
      cwd: path.join(os.tmpdir(), 'codemini-win-skill-ws'),
      platform: 'win32',
    });
    assert.match(prompt, /Sandbox skill root: \/codemini-skills\/demo/);
    assert.match(prompt, /scripts: \/codemini-skills\/demo\/scripts/);
    assert.match(prompt, /references: \/codemini-skills\/demo\/references/);
    assert.match(prompt, /Use these paths with run/);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(globalDir, { recursive: true, force: true });
  }
});

test('macOS microsandbox skill prompts remap run paths to /codemini-skills', () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = path.join(os.tmpdir(), 'codemini-mac-skill-global');
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    const skillRoot = path.join(getSkillsDir(), 'demo');
    const prompt = renderCommandPrompt({
      name: 'demo',
      path: path.join(skillRoot, 'SKILL.md'),
      metadata: { type: 'skill', rootPath: skillRoot },
      content: 'Follow the packaged scripts.',
    }, [], {
      config: { sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' } },
      cwd: path.join(os.tmpdir(), 'codemini-mac-skill-ws'),
      platform: 'darwin',
    });
    assert.match(prompt, /Sandbox skill root: \/codemini-skills\/demo/);
    assert.match(prompt, /Use these paths with run/);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
  }
});
