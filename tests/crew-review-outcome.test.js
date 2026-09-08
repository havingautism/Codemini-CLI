import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCrewWorkerCompletedWake,
} from '../src/core/crew-snapshot.js';
import {
  buildCrewReviewVerdictPrompt,
  inferCrewReviewVerdictFromOutput,
  markCrewEventsDeliveredForWake,
  normalizeCrewReviewVerdict,
  parseCrewWakeNotification,
  readCrewStateFile,
  resolveCrewReviewOutcome,
} from '../src/core/crew-store.js';

test('resolveCrewReviewOutcome prefers tool verdict then inferred prose', () => {
  assert.deepEqual(
    resolveCrewReviewOutcome({
      verdict: { passed: false, findings: ['missing tests'] },
      outputText: 'Findings:\n- none\npass',
    }),
    {
      status: 'failed',
      passed: false,
      findings: ['missing tests'],
      source: 'tool',
    },
  );

  const inferred = resolveCrewReviewOutcome({
    outputText: [
      'Findings:',
      '- none',
      '',
      'Verified:',
      '- only notes.md changed',
      '',
      'Handoff:',
      '- clean to land; pass.',
    ].join('\n'),
  });
  assert.equal(inferred.status, 'passed');
  assert.equal(inferred.source, 'inferred');

  assert.deepEqual(resolveCrewReviewOutcome({ outputText: 'Still checking.' }), {
    status: 'incomplete',
    passed: undefined,
    findings: [],
    source: 'none',
  });
});

test('inferCrewReviewVerdictFromOutput accepts Chinese pass phrasing with empty findings', () => {
  const text = [
    'Findings:',
    '- none',
    '',
    'Verified:',
    '- docs/sample.md 内容与 diff 一致',
    '',
    'Handoff:',
    '- t1 提交干净可合入，请提交 pass。',
  ].join('\n');
  assert.deepEqual(inferCrewReviewVerdictFromOutput(text), {
    status: 'passed',
    passed: true,
    findings: [],
  });
});

test('normalizeCrewReviewVerdict strips sentinel findings on pass', () => {
  assert.deepEqual(normalizeCrewReviewVerdict({ passed: true, findings: ['- none', 'none'] }), {
    ok: true,
    passed: true,
    findings: [],
  });
});

test('buildCrewWorkerCompletedWake distinguishes incomplete review from failed review', () => {
  const incomplete = buildCrewWorkerCompletedWake({
    reviewOf: 't1',
    status: 'completed',
    reviewIncomplete: true,
  });
  assert.match(incomplete, /Review of "t1" incomplete/);
  assert.match(incomplete, /resume "t1" and rebase/);
  assert.match(incomplete, /dispatch reviewer again/);
  assert.doesNotMatch(incomplete, /Review did not pass/);

  const failed = buildCrewWorkerCompletedWake({
    reviewOf: 't1',
    status: 'completed',
    reviewPassed: false,
  });
  assert.match(failed, /Review did not pass/);
});

test('parseCrewWakeNotification and markCrewEventsDeliveredForWake ack matching events', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-wake-ack-'));
  try {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), `${JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
      events: [{
        id: 'evt_test',
        kind: 'worker.completed',
        from: 't3',
        to: 'coordinator',
        at: '2026-09-08T10:35:38.386Z',
        delivered: false,
        payload: { workerId: 't3', status: 'completed' },
      }],
    }, null, 2)}\n`);

    const note = parseCrewWakeNotification('<notification type="crew.worker.completed" workerId="t3" status="completed">');
    assert.equal(note.workerId, 't3');
    assert.equal(note.kind, 'worker.completed');

    await markCrewEventsDeliveredForWake(dir, [
      '<notification type="crew.worker.completed" workerId="t3" status="completed">',
      'Crew worker "t3" completed.',
      '</notification>',
    ].join('\n'));
    const saved = await readCrewStateFile(dir);
    assert.equal(saved.events[0].delivered, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('buildCrewReviewVerdictPrompt requires submit_crew_review before stop', () => {
  const prompt = buildCrewReviewVerdictPrompt();
  assert.match(prompt, /submit_crew_review exactly once/);
  assert.match(prompt, /Prose under Findings:/);
  assert.match(prompt, /passed true and findings \[\]/);
});
