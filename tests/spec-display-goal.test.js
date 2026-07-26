import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpecDisplayGoal, renderStructuredSpec } from '../src/core/chat-runtime.js';

test('extractSpecDisplayGoal prefers Goals 目标 over document title', () => {
  const specText = renderStructuredSpec({
    title: '随手记 VIP — 笔记评论功能 (Add Comments)',
    goals: {
      goal: '评论功能目标',
      summary: '用户打开笔记详情页后可查看评论列表，并通过底部输入框新增评论。',
      requirements: [
        'R-COMM-001: 用户可在详情页底部看到评论列表'
      ]
    }
  }, '随手记 VIP — 笔记评论功能 (Add Comments)');

  assert.match(specText, /^# .+Design/m);
  assert.equal(
    extractSpecDisplayGoal(specText, {
      fallback: '随手记 VIP — 笔记评论功能 (Add Comments) Design'
    }),
    '评论功能目标'
  );
});

test('extractSpecDisplayGoal uses structured sections.goals.goal first', () => {
  assert.equal(
    extractSpecDisplayGoal('', {
      sections: {
        goals: { goal: '评论功能目标', summary: '概述文案' }
      },
      fallback: 'Wrong Title Design'
    }),
    '评论功能目标'
  );
});

test('extractSpecDisplayGoal falls back to cleaned topic title', () => {
  assert.equal(
    extractSpecDisplayGoal('# Title Only\n\n## Summary\n- x\n', {
      fallback: 'Some Feature Design'
    }),
    'Some Feature'
  );
});

test('extractSpecDisplayGoal keeps explicit non-title stored goals via snapshot preference', () => {
  // Document Goals say one thing; an explicit edited goal should remain usable as fallback input.
  const specText = [
    '# Feature Design',
    '',
    '## Goals',
    '- 目标：评论功能目标',
    '',
    '## Summary',
    '- x'
  ].join('\n');
  assert.equal(
    extractSpecDisplayGoal(specText, { fallback: 'Feature Design' }),
    '评论功能目标'
  );
});
