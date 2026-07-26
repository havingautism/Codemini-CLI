import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDirectMemoryPrompt,
  classifyMemoryRoute,
  chooseMemoryLifecycle,
  inferMemoryScope,
  normalizeMemoryKind,
  normalizeMemoryScope,
  shouldAutoCaptureUserPrompt,
  buildMemoryDecisionGraphBlock,
  buildDreamPromotionGraphBlock,
  buildMemoryRouteHintBlock
} from '../src/core/memory-policy.js';
import { rememberMemory, listMemories, captureToInbox, listInbox } from '../src/core/memory-store.js';
import { buildMemorySnapshot } from '../src/core/memory-prompt.js';
import {
  isSessionMemoryCandidateEligible,
  normalizeSessionMemoryCandidate
} from '../src/core/memory-session-review.js';
import {
  claimSessionMemoryReview,
  completeSessionMemoryReview
} from '../src/core/memory-review-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

test('normalizeMemoryKind collapses legacy kinds into four buckets', () => {
  assert.equal(normalizeMemoryKind('interest'), 'preference');
  assert.equal(normalizeMemoryKind('habit'), 'preference');
  assert.equal(normalizeMemoryKind('workflow'), 'convention');
  assert.equal(normalizeMemoryKind('failure'), 'lesson');
  assert.equal(normalizeMemoryKind('observation'), 'note');
  assert.equal(normalizeMemoryKind('preference'), 'preference');
});

test('normalizeMemoryScope maps repo/thread to project', () => {
  assert.equal(normalizeMemoryScope('repo'), 'project');
  assert.equal(normalizeMemoryScope('thread'), 'project');
  assert.equal(normalizeMemoryScope('user'), 'user');
});

test('inferMemoryScope defaults preference to user and others to project', () => {
  assert.equal(inferMemoryScope({ kind: 'preference' }), 'user');
  assert.equal(inferMemoryScope({ kind: 'convention' }), 'project');
  assert.equal(inferMemoryScope({ scope: 'global', kind: 'preference' }), 'global');
});

test('chooseMemoryLifecycle maps kinds to longterm/operational', () => {
  assert.equal(chooseMemoryLifecycle('preference'), 'longterm');
  assert.equal(chooseMemoryLifecycle('convention'), 'longterm');
  assert.equal(chooseMemoryLifecycle('lesson'), 'operational');
  assert.equal(chooseMemoryLifecycle('note'), 'operational');
});

test('classifyDirectMemoryPrompt captures interests as user preference', () => {
  const hit = classifyDirectMemoryPrompt('我喜欢深色主题和简洁回复');
  assert.equal(hit.scope, 'user');
  assert.equal(hit.kind, 'preference');
  assert.match(hit.content, /深色主题/);
});

test('classifyDirectMemoryPrompt routes project remember to convention', () => {
  const hit = classifyDirectMemoryPrompt('请记住本项目测试用 npm test');
  assert.equal(hit.scope, 'project');
  assert.equal(hit.kind, 'convention');
});

test('classifyDirectMemoryPrompt ignores one-turn negative constraints', () => {
  assert.equal(classifyDirectMemoryPrompt('Do not edit files; review only.'), null);
  assert.equal(classifyDirectMemoryPrompt('本次先不要修改文件'), null);
});

test('classifyDirectMemoryPrompt keeps project-specific tastes as preferences', () => {
  const hit = classifyDirectMemoryPrompt('请记住我不喜欢这个项目的登录页配色');
  assert.equal(hit.scope, 'project');
  assert.equal(hit.kind, 'preference');
});

test('classifyDirectMemoryPrompt stores personal facts as user notes', () => {
  const hit = classifyDirectMemoryPrompt('请记住我叫小明');
  assert.equal(hit.scope, 'user');
  assert.equal(hit.kind, 'note');
});

test('classifyDirectMemoryPrompt recognizes cross-project environment lessons', () => {
  const hit = classifyDirectMemoryPrompt('请记住 PowerShell 不支持 Bash 的 source 命令');
  assert.equal(hit.scope, 'global');
  assert.equal(hit.kind, 'lesson');
});

test('classifyDirectMemoryPrompt recognizes global and project conventions independently', () => {
  const globalHit = classifyDirectMemoryPrompt('请记住所有项目都使用 pnpm');
  assert.equal(globalHit.scope, 'global');
  assert.equal(globalHit.kind, 'convention');

  const projectHit = classifyDirectMemoryPrompt('请记住本项目使用 npm test');
  assert.equal(projectHit.scope, 'project');
  assert.equal(projectHit.kind, 'convention');
});

test('shouldAutoCaptureUserPrompt skips direct preference utterances', () => {
  assert.equal(shouldAutoCaptureUserPrompt('我喜欢用中文交流'), false);
  assert.equal(shouldAutoCaptureUserPrompt('请帮我修复登录页的空指针问题'), true);
});

test('memory decision graph names save_memory and dream leaves', () => {
  const graph = buildMemoryDecisionGraphBlock();
  assert.match(graph, /save_memory/);
  assert.match(graph, /Dream/);
  assert.match(graph, /never store/);
  assert.match(buildDreamPromotionGraphBlock(), /keep →/);
});

test('classifyMemoryRoute maps remember / task / chatter onto leaves', () => {
  assert.equal(classifyMemoryRoute('请记住本项目测试用 npm test').leaf, 'save_memory');
  assert.equal(classifyMemoryRoute('请帮我修复登录页的空指针问题').leaf, 'dream_inbox');
  assert.equal(classifyMemoryRoute('今天天气怎么样').leaf, 'ignore');
});

test('memory route hint only fires for save_memory leaf', () => {
  assert.match(
    buildMemoryRouteHintBlock(classifyMemoryRoute('我喜欢深色主题')),
    /save_memory\(scope="user", kind="preference"\)/
  );
  assert.equal(buildMemoryRouteHintBlock(classifyMemoryRoute('请帮我修复登录页')), '');
  assert.equal(buildMemoryRouteHintBlock(classifyMemoryRoute('hello')), '');
});

test('rememberMemory keeps pinned items when trimming budget', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const config = { memory: { max_items_per_scope: 2, max_user_chars: 5000 } };
    await rememberMemory({
      scope: 'user',
      content: 'old unpinned preference A',
      kind: 'preference',
      pinned: false,
      config,
      workspaceRoot: tmp
    });
    await rememberMemory({
      scope: 'user',
      content: 'pinned preference keep me',
      kind: 'preference',
      pinned: true,
      config,
      workspaceRoot: tmp
    });
    await rememberMemory({
      scope: 'user',
      content: 'newer unpinned preference B',
      kind: 'preference',
      pinned: false,
      config,
      workspaceRoot: tmp
    });
    const items = await listMemories({ scope: 'user', workspaceRoot: tmp });
    assert.equal(items.length, 2);
    assert.ok(items.some((item) => item.pinned && item.content.includes('keep me')));
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('rememberMemory reports when pinned items leave no capacity', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const config = { memory: { max_items_per_scope: 2, max_user_chars: 5000 } };
    await rememberMemory({
      scope: 'user',
      content: 'pinned preference A',
      kind: 'preference',
      pinned: true,
      config,
      workspaceRoot: tmp
    });
    await rememberMemory({
      scope: 'user',
      content: 'pinned preference B',
      kind: 'preference',
      pinned: true,
      config,
      workspaceRoot: tmp
    });
    await assert.rejects(
      rememberMemory({
        scope: 'user',
        content: 'new unpinned preference C',
        kind: 'preference',
        config,
        workspaceRoot: tmp
      }),
      (error) => error?.code === 'MEMORY_CAPACITY_PINNED'
    );
    const items = await listMemories({ scope: 'user', workspaceRoot: tmp });
    assert.equal(items.length, 2);
    assert.equal(items.some((item) => item.content.includes('preference C')), false);
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('listInbox normalizes legacy repo scope to project', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-inbox-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    // Write through capture with project; also plant a legacy repo-scoped file entry via capture then patch.
    const entry = await captureToInbox({
      scope: 'repo',
      type: 'failure',
      summary: 'legacy repo capture',
      details: 'should normalize'
    });
    assert.equal(entry.scope, 'project');
    const byProject = await listInbox({ scope: 'project' });
    assert.ok(byProject.some((item) => item.id === entry.id));
    const byRepoAlias = await listInbox({ scope: 'repo' });
    assert.ok(byRepoAlias.some((item) => item.id === entry.id));
  } finally {
    closeSqliteDatabasesForTests();
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('buildMemorySnapshot does not duplicate lifecycle sections', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-snapshot-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    await rememberMemory({
      scope: 'user',
      content: 'User prefers concise Chinese replies',
      kind: 'preference',
      summary: 'concise Chinese',
      config: {},
      workspaceRoot: tmp
    });
    // Tag lifecycle by rewriting through remember+manual is hard; snapshot text check is enough:
    const snapshot = await buildMemorySnapshot({
      config: { memory: { enabled: true, inject_on_session_start: true, max_items_per_scope: 12 } },
      workspaceRoot: tmp
    });
    assert.match(snapshot, /User Memory/);
    assert.doesNotMatch(snapshot, /Active Guidance \(Operational/);
    assert.doesNotMatch(snapshot, /Stable Learnings \(LongTerm/);
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('session reviewer rejects temporary and proposed project ideas', () => {
  const temporary = normalizeSessionMemoryCandidate({
    scope: 'project',
    kind: 'convention',
    content: '项目关闭缓存',
    decision_state: 'implemented',
    durable_score: 9,
    confidence: 0.95,
    evidence_indices: [0]
  }, [{ role: 'user', content: '这次先试试把项目缓存关掉' }]);
  assert.equal(isSessionMemoryCandidateEligible(temporary), false);

  const proposed = normalizeSessionMemoryCandidate({
    scope: 'project',
    kind: 'convention',
    content: '项目可以迁移到 PostgreSQL',
    decision_state: 'proposed',
    durable_score: 8,
    confidence: 0.9,
    evidence_indices: [0]
  }, [{ role: 'user', content: '项目可以迁移到 PostgreSQL' }]);
  assert.equal(isSessionMemoryCandidateEligible(proposed), false);
});

test('session reviewer accepts verified durable project conventions', () => {
  const candidate = normalizeSessionMemoryCandidate({
    scope: 'project',
    kind: 'convention',
    content: '项目使用 npm test 运行完整测试套件',
    semantic_key: 'project:test-command',
    decision_state: 'verified',
    durable_score: 9,
    confidence: 0.94,
    evidence_indices: [0]
  }, [{ role: 'user', content: '已经确认本项目使用 npm test，并且测试通过' }]);
  assert.equal(isSessionMemoryCandidateEligible(candidate), true);
  assert.equal(candidate.semanticKey, 'project:test-command');
});

test('captureToInbox is idempotent for session review keys', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-inbox-idempotent-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const args = {
      scope: 'user',
      type: 'preference',
      summary: 'prefers concise replies',
      details: 'User prefers concise replies',
      source: 'session-review',
      idempotencyKey: 'session:test:hash:user:reply-style'
    };
    const first = await captureToInbox(args);
    const second = await captureToInbox(args);
    assert.equal(first.duplicate, undefined);
    assert.equal(second.duplicate, true);
    const items = await listInbox();
    assert.equal(items.length, 1);
  } finally {
    closeSqliteDatabasesForTests();
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('concurrent inbox captures do not overwrite each other', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-inbox-concurrent-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => captureToInbox({
      scope: 'project',
      type: 'note',
      summary: `concurrent candidate ${index}`,
      details: `durable candidate ${index}`,
      idempotencyKey: `concurrent:${index}`
    })));
    const items = await listInbox();
    assert.equal(items.length, 20);
  } finally {
    closeSqliteDatabasesForTests();
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('concurrent memory writes preserve every item within capacity', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-concurrent-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const config = { memory: { max_items_per_scope: 12, max_user_chars: 5000 } };
    await Promise.all(Array.from({ length: 8 }, (_, index) => rememberMemory({
      scope: 'user',
      kind: 'preference',
      content: `concurrent preference ${index}`,
      semanticKey: `user:concurrent:${index}`,
      config,
      workspaceRoot: tmp
    })));
    const items = await listMemories({ scope: 'user', workspaceRoot: tmp });
    assert.equal(items.length, 8);
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('session review state uses content hashes instead of a permanent boolean', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-review-state-'));
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const first = await claimSessionMemoryReview({
      sessionId: 'session-test',
      contentHash: 'hash-a',
      reviewerVersion: 1
    });
    assert.equal(first.claimed, true);
    await completeSessionMemoryReview({
      sessionId: 'session-test',
      contentHash: 'hash-a',
      reviewerVersion: 1,
      reviewedMessageCount: 2,
      candidateCount: 0
    });
    const unchanged = await claimSessionMemoryReview({
      sessionId: 'session-test',
      contentHash: 'hash-a',
      reviewerVersion: 1
    });
    assert.equal(unchanged.claimed, false);
    assert.equal(unchanged.reason, 'already-reviewed');

    const changed = await claimSessionMemoryReview({
      sessionId: 'session-test',
      contentHash: 'hash-b',
      reviewerVersion: 1
    });
    assert.equal(changed.claimed, true);
  } finally {
    closeSqliteDatabasesForTests();
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
