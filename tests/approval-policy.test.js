import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectWorkspaceIsGit,
  resolveApprovalProjectIsGit,
  toolRequiresUserApproval
} from '../src/core/approval-policy.js';
import { resolvePlanSubAgentApprovalOptions, ROLE_TOOL_POLICY } from '../src/core/chat-runtime.js';

test('resolveApprovalProjectIsGit treats workspace .git as git even when tracker disabled', () => {
  assert.equal(
    resolveApprovalProjectIsGit({
      projectIsGit: false,
      changeTrackerEnabled: false,
      workspaceHasGit: true
    }),
    true
  );
  assert.equal(
    resolveApprovalProjectIsGit({
      projectIsGit: false,
      changeTrackerEnabled: false,
      workspaceHasGit: false
    }),
    false
  );
});

test('detectWorkspaceIsGit finds .git directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-git-detect-'));
  try {
    assert.equal(await detectWorkspaceIsGit(dir), false);
    await fs.mkdir(path.join(dir, '.git'));
    assert.equal(await detectWorkspaceIsGit(dir), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('auto mode skips edit approval in git projects', () => {
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    false
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: false,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    true
  );
});

test('review mode still prompts for coder edits unless role tools are always-allowed', () => {
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    true
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ROLE_TOOL_POLICY.coder
    }),
    false
  );
});

test('plan sub-agent approval options inherit role tools and workspace git', () => {
  const options = resolvePlanSubAgentApprovalOptions({
    role: 'coder',
    config: {},
    projectIsGit: false,
    changeTrackerEnabled: false,
    workspaceHasGit: true
  });
  assert.equal(options.projectIsGit, true);
  assert.ok(options.alwaysAllowTools.includes('edit'));
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: options.projectIsGit,
      toolName: 'edit',
      alwaysAllowTools: options.alwaysAllowTools
    }),
    false
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: options.projectIsGit,
      toolName: 'write',
      alwaysAllowTools: ['run', 'read']
    }),
    false
  );
});
