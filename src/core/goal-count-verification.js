import { createHash } from 'node:crypto';

// 只接管可完整解释的数列要求。附加的格式、行动或交付条件仍须交给独立模型。
const integer = '(-?(?:0|[1-9]\\d*))';
const counting = new RegExp('^(?:请)?(?:在聊天中|在回复中)?从' + integer + '数到' + integer + '(?:[，,]?直到结束)?$');
const listing = new RegExp('^(?:请)?(?:在聊天中|在回复中|回复中)?(?:完整|依次|逐个)?列出从' + integer + '到' + integer + '的(?:全部|所有)?(?:连续整数|数字|整数)$');
const allNumbers = /^(?:在聊天中|在回复中|回复中)?(?:完整|依次|逐个)?列出(?:所有|全部)(?:数字|整数)$/;

function requirement(text) {
  const value = String(text || '').trim();
  return /\d\s+\d/.test(value) ? '' : value.replace(/\s+/g, '').replace(/[。！!]$/, '');
}

function range(text) {
  const match = counting.exec(text) || listing.exec(text);
  if (!match) return null;
  const endpoints = match.slice(1).map(Number);
  return endpoints.every(Number.isSafeInteger) && Number.isSafeInteger(Math.abs(endpoints[1] - endpoints[0]) + 1) ? endpoints : null;
}

function sequenceBody(report, goal, first, last) {
  const lines = report.trim().split(/\r?\n/).map(line => line.trim());
  const numeric = line => line && /^[-\d\s、，,。.]+$/u.test(line);
  const start = lines.findIndex(numeric);
  const end = lines.findLastIndex(numeric);
  if (start < 0 || !lines.slice(start, end + 1).every(line => !line || numeric(line))) return '';
  const annotations = [...lines.slice(0, start), ...lines.slice(end + 1)].filter(Boolean);
  const rangeLabel = new RegExp(first + '\\s*(?:→|->|数到|到|至)\\s*' + last);
  for (const line of annotations) {
    const label = goal.criteria.find(criterion => line.startsWith('[' + criterion.id + ']'));
    const note = (label ? line.slice(label.id.length + 2) : line).replace(rangeLabel, '');
    // 独立题头或尾注可以重述范围。其他数字不能藏在说明里，也不能从说明中补入数列。
    if (!/\p{L}/u.test(note) || /\d/u.test(note)) return '';
  }
  return lines.slice(start, end + 1).join('\n').replace(/[。.]$/, '').trim();
}

export function integerSequenceRange(goal) {
  if (String(goal.constraints || '').trim() || !goal.criteria?.length) return null;
  const endpoints = range(requirement(goal.objective));
  if (!endpoints) return null;
  const [first, last] = endpoints;
  const covers = goal.criteria.every(criterion => {
    if (criterion.evidence && criterion.evidence !== 'reply') return false;
    const text = requirement(criterion.text);
    const limits = range(text);
    return allNumbers.test(text) || (limits && limits[0] === first && limits[1] === last);
  });
  return covers ? endpoints : null;
}

export function reviewIntegerSequence(goal) {
  const endpoints = integerSequenceRange(goal);
  if (!endpoints || !goal.criteria.every(criterion => criterion.evidence === 'reply')) return null;
  const [first, last] = endpoints;
  const revision = 'reply:' + (goal.id || 'current');
  const history = goal.observations || [];
  const reply = history.slice(history.findLastIndex(item => item.kind === 'change') + 1).findLast(item => item.source === 'reply');
  const report = goal.report;
  const retry = reason => ({ decision: 'continue', reason, checks: [] });
  if (!reply || reply.kind !== 'observation' || reply.iteration !== goal.iteration || reply.revision !== revision ||
      typeof report !== 'string' || !report.trim() || createHash('sha256').update(report).digest('hex') !== reply.artifactHash ||
      !goal.criteria.every(criterion => reply.criterionIds?.includes(criterion.id))) {
    return retry('本轮缺少与完整聊天正文一致的数列证据。');
  }
  // 需要完整的独立数列段，省略号、区间简写以及「我已经数完」都不能充当数列。
  const sequence = sequenceBody(report, goal, first, last);
  if (!/^-?\d+(?:[\s、,，]+-?\d+)*$/u.test(sequence)) return retry('请在回复中逐个列出完整数列。');
  const numbers = sequence.matchAll(/-?\d+/g);
  const step = first <= last ? 1 : -1;
  const expectedCount = Math.abs(last - first) + 1;
  let count = 0;
  for (const [number] of numbers) {
    if (count === expectedCount) return retry('数列在终点 ' + last + ' 之后仍有多余数字。');
    const expected = first + step * count;
    if (number !== String(expected)) return retry('数列第 ' + (count + 1) + ' 项应为 ' + expected + '，实际为 ' + number + '。');
    count++;
  }
  if (count !== expectedCount) return retry('已列出 ' + count + ' 项，仍需列到 ' + last + '。');
  return { decision: 'completed', reason: '已按顺序逐项核对从 ' + first + ' 到 ' + last + ' 的 ' + count + ' 个整数。',
    checks: goal.criteria.map(criterion => ({ criterionId: criterion.id, evidenceIds: [reply.id] })) };
}
