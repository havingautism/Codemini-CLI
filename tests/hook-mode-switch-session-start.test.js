import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hookProfileIsActive,
  listCustomHookProfiles,
  packageProfileArmEntry,
  persistPackageHookRoot,
  savePackageHookProfile,
} from '../src/core/hook-profiles.js';
import {
  armSkillHooks,
  createSkillHooksSession,
  disarmSkillHooks,
} from '../src/core/skill-hooks-session.js';
import {
  fireSkillHookEvent,
  pruneSessionStartUiEvents,
  reconcileSessionStartAfterActivationChange,
} from '../src/core/skill-hooks-runtime.js';

test('pruneSessionStartUiEvents drops disarmed arms only', () => {
  const kept = pruneSessionStartUiEvents(
    [
      { type: 'hook:start', skillName: '__package__:coding', summary: 'coding' },
      { type: 'hook:start', skillName: '__package__:always', summary: 'always' },
      { type: 'hook:start', summary: 'no-name' },
    ],
    ['__package__:always'],
  );
  assert.deepEqual(
    kept.map((event) => event.summary),
    ['always', 'no-name'],
  );
});

test('coding→daily mode switch drops queued coding SessionStart UI and contexts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-mode-switch-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(cwd, 'global');
  try {
    const pkgRoot = path.join(cwd, 'pkg');
    await fs.mkdir(path.join(pkgRoot, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'hooks', 'activate.js'),
      'process.stdout.write(JSON.stringify({ continue: true, additionalContext: "PONYTAIL_CTX" }));\n',
    );
    await persistPackageHookRoot(pkgRoot, { scope: 'global', cwd, id: 'ponytail-like' });
    await savePackageHookProfile(
      {
        id: 'ponytail-like',
        name: 'PonytailLike',
        activation: 'coding',
        enabled: true,
        packageRoot: path.join(process.env.CODEMINI_GLOBAL_DIR, 'hooks', 'packages', 'ponytail-like'),
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume|clear|compact',
              hooks: [
                {
                  type: 'command',
                  command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/activate.js"',
                  timeout: 5,
                },
              ],
            },
          ],
        },
      },
      cwd,
    );

    let executionMode = 'plan';
    const skillHooksSession = createSkillHooksSession();
    const sessionStartUiEvents = [];
    let sessionStartCompleted = false;

    const reloadWorkspaceHooks = async () => {
      const profiles = await listCustomHookProfiles(cwd);
      for (const name of [...skillHooksSession.activeSkills.keys()]) {
        if (String(name).startsWith('__package__:')) {
          disarmSkillHooks(skillHooksSession, name);
        }
      }
      for (const profile of profiles) {
        if (profile.kind !== 'package' || !hookProfileIsActive(profile, executionMode)) continue;
        const entry = packageProfileArmEntry(profile, cwd);
        if (Object.keys(entry.hooks).length) armSkillHooks(skillHooksSession, entry);
      }
    };

    await reloadWorkspaceHooks();
    const bootResult = await fireSkillHookEvent({
      session: skillHooksSession,
      eventName: 'SessionStart',
      input: { source: 'startup' },
      workspaceRoot: cwd,
      onAgentEvent: (event) => {
        if (event?.type === 'hook:start' || event?.type === 'hook:end' || event?.type === 'hook:error') {
          sessionStartUiEvents.push(event);
        }
      },
    });
    skillHooksSession.sessionStartContexts = [
      '[Hook] SessionStart ← PonytailLike (allow)',
      ...(bootResult.contexts || []),
    ];
    sessionStartCompleted = true;
    assert.ok(sessionStartUiEvents.some((event) => /PonytailLike/.test(event.summary || '')));
    assert.ok(skillHooksSession.sessionStartContexts.some((line) => /PONYTAIL_CTX|PonytailLike/.test(line)));

    const previouslyArmed = new Set([...skillHooksSession.activeSkills.keys()]);
    executionMode = 'normal';
    await reloadWorkspaceHooks();
    await reconcileSessionStartAfterActivationChange({
      skillHooksSession,
      sessionStartUiEvents,
      sessionStartCompleted,
      previouslyArmed,
      workspaceRoot: cwd,
    });

    const replayed = sessionStartUiEvents.splice(0, sessionStartUiEvents.length);
    assert.equal(
      replayed.filter((event) => event.type === 'hook:start' && /PonytailLike/.test(event.summary || '')).length,
      0,
      'first submit after daily switch must not show coding SessionStart',
    );
    assert.equal(
      (skillHooksSession.sessionStartContexts || []).filter((line) => /PONYTAIL_CTX|PonytailLike/.test(line)).length,
      0,
      'coding SessionStart context must not linger after daily switch',
    );
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
