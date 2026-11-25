export const GOAL_COMMAND = Object.freeze({
  name: 'goal',
  kind: 'command',
  scope: 'builtin',
  description: '用一句话设置目标，可查看、修改、清除、暂停或恢复目标',
});

export const DEFAULT_GOAL_ROUNDS = 5;
export const MAX_GOAL_ROUNDS = 100;

const SECTION = /(?:^|[\s；;]+)(目标|验收条件|验收标准|验收|约束|轮数|token预算|令牌预算)\s*[:：]/giu;

function parseRounds(value) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const rounds = Number(text);
  return rounds <= MAX_GOAL_ROUNDS ? rounds : null;
}

function listItems(text) {
  return text.split(/[\n；]+/u)
    .map((item) => item.trim().replace(/^(?:[-*•](?:\s+|$)|\d+[.、)]\s*)/u, '').trim())
    .filter(Boolean);
}

export function isGoalSteeringInput(input) {
  const message = typeof input === 'string' ? { text: input } : input;
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  return Boolean(text) && !/^[!/]/u.test(text) && !message.attachmentIds?.length
    && !message.attachments?.length && !message.fileReferences?.length && !message.skillNames?.length;
}

export function isImmediateGoalControl(text) {
  return /^\/goal(?:\s+(?:status|pause|clear|edit(?:\s+[\s\S]+)?))?$/iu.test(String(text || '').trim());
}

function parseTokens(value) {
  const n = Number(value);
  return /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(n) ? n : null;
}

export function parseGoalCommand(text) {
  const invocation = /^\/goal(?:\s+([\s\S]+))?$/iu.exec(String(text || '').trim());
  if (!invocation) return null;
  let body = (invocation[1] || '').trim();
  if (!body || /^status$/iu.test(body)) return { action: 'status' };
  if (/^pause$/iu.test(body)) return { action: 'pause' };
  if (/^clear$/iu.test(body)) return { action: 'clear' };
  if (/^clear\s/iu.test(body)) return { action: 'error', message: '清除当前目标请使用 /goal clear。' };
  if (/^(?:status|pause)\s+(?:--?\S+|[+-]?\d+)$/iu.test(body)) {
    return { action: 'error', message: '查看或暂停目标可用 /goal status 或 /goal pause，无需追加参数。' };
  }
  if (/^resume(?:\s|$)/iu.test(body)) {
    if (/^resume$/iu.test(body)) return { action: 'resume' };
    const args = /^resume(?:\s+(?:\+|--add-rounds\s+)?(\d+))?(?:\s+--add-tokens\s+(\d+))?$/iu.exec(body);
    const extraRounds = args?.[1] && parseRounds(args[1]);
    const extraTokens = args?.[2] && parseTokens(args[2]);
    if (!args || (args[1] && !extraRounds) || (args[2] && !extraTokens)) {
      return { action: 'error', message: '恢复目标可用 /goal resume，可单独或同时追加预算，例如 /goal resume +2 --add-tokens 10000。' };
    }
    return { action: 'resume', ...(extraRounds && { extraRounds }), ...(extraTokens && { extraTokens }) };
  }

  const editing = /^edit(?:\s|$)/iu.test(body);
  if (editing) {
    body = body.slice(4).trim();
    if (!body) return { action: 'error', message: '请在 /goal edit 后填写修改后的完整目标。' };
  }
  const headers = [...body.matchAll(SECTION)];
  const objectiveParts = [body.slice(0, headers[0]?.index ?? body.length).trim()];
  const acceptance = [];
  const constraints = [];
  let maxRounds = editing ? undefined : DEFAULT_GOAL_ROUNDS;
  let tokenBudget;
  for (const [index, header] of headers.entries()) {
    const value = body.slice(header.index + header[0].length, headers[index + 1]?.index ?? body.length).trim();
    if (header[1] === '目标') objectiveParts.push(value);
    else if (header[1] === '约束') constraints.push(...listItems(value));
    else if (header[1] === '轮数') {
      maxRounds = parseRounds(value);
      if (!maxRounds) return { action: 'error', message: '轮数须为 1 至 100 的整数，例如「轮数：5」。' };
    } else if (/^(token预算|令牌预算)$/iu.test(header[1])) {
      tokenBudget = parseTokens(value);
      if (!tokenBudget) return { action: 'error', message: 'Token 预算须为正安全整数，例如「Token预算：20000」。' };
    } else {
      const items = listItems(value);
      if (!items.length) return { action: 'error', message: '请填写验收条件，或直接输入 /goal 和目标描述。' };
      acceptance.push(...items);
    }
  }
  const objective = objectiveParts.filter(Boolean).join('\n');
  if (!objective && !acceptance.length) {
    return { action: 'error', message: '请在 /goal 后填写目标，例如「/goal 修复导出功能」。' };
  }
  return {
    action: editing ? 'edit' : 'create',
    objective: objective || acceptance.join('\n'),
    acceptance: acceptance.length ? acceptance : [objective],
    constraints,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    criteriaPending: acceptance.length ? 'classify' : 'infer',
  };
}
