import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTextSegment,
  appendThinkingSegment,
} from '../codemini-web/shared/transcript-segments.js';

test('preamble text stays above create_plan before plan steps exist', () => {
  const segments = [
    {
      type: 'tools',
      cards: [{ id: 'p1', name: 'create_plan', status: 'running' }],
    },
  ];
  const next = appendTextSegment(segments, '先说明一下再开 plan');
  assert.equal(next[0].type, 'text');
  assert.match(next[0].text, /先说明/);
  assert.equal(next[1].type, 'tools');
});

test('post-plan body text stays below create_plan once steps exist', () => {
  const segments = [
    {
      type: 'tools',
      cards: [
        {
          id: 'p1',
          name: 'create_plan',
          status: 'running',
          planRun: {
            phase: 'executing',
            steps: [{ status: 'done' }, { status: 'running' }],
          },
        },
      ],
    },
  ];
  const next = appendTextSegment(segments, 'Plan 跑完后的总结正文');
  assert.equal(next[0].type, 'tools');
  assert.equal(next[1].type, 'text');
  assert.match(next[1].text, /总结正文/);
});

test('thinking after completed plan stays below the card', () => {
  const segments = [
    {
      type: 'tools',
      cards: [
        {
          id: 'p1',
          name: 'create_plan',
          status: 'done',
          planRun: { phase: 'completed', steps: [{ status: 'done' }] },
        },
      ],
    },
  ];
  const next = appendThinkingSegment(segments, '事后思考');
  assert.equal(next[0].type, 'tools');
  assert.equal(next[1].type, 'thinking');
});
