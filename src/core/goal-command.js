export const GOAL_COMMAND = Object.freeze({
  name: 'goal',
  kind: 'command',
  scope: 'builtin',
  description: '设置当前会话的目标和验收条件，查看、暂停或恢复执行',
});

export const DEFAULT_GOAL_ROUNDS = 5;
export const MAX_GOAL_ROUNDS = 100;

const USAGE = '请填写目标和至少一项可核对的验收条件。示例：\n/goal 修复导出功能\n验收：导出含中文的文件名时，下载成功且名称完整';
const SECTION = /(?:^|[\s；;]+)(目标|验收条件|验收标准|验收|约束|轮数)\s*[:：][ \t]*/gu;

function parseRounds(value) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const rounds = Number(text);
  return rounds <= MAX_GOAL_ROUNDS ? rounds : null;
}

function listItems(text) {
  return text.split(/[\n；]+/u)
    .map((item) => item.trim().replace(/^(?:[-*•]\s+|\d+[.、)]\s*)/u, '').trim())
    .filter(Boolean);
}

export function isImmediateGoalControl(text) {
  return /^\/goal(?:\s+(?:status|pause))?$/iu.test(String(text || '').trim());
}

export function parseGoalCommand(text) {
  const invocation = /^\/goal(?:\s+([\s\S]+))?$/iu.exec(String(text || '').trim());
  if (!invocation) return null;
  const body = (invocation[1] || '').trim();
  if (!body || /^status$/iu.test(body)) return { action: 'status' };
  if (/^pause$/iu.test(body)) return { action: 'pause' };
  if (/^resume(?:\s|$)/iu.test(body)) {
    if (/^resume$/iu.test(body)) return { action: 'resume' };
    const arg = /^resume\s+(?:\+|--add-rounds\s+)?(\d+)$/iu.exec(body);
    const extraRounds = arg && parseRounds(arg[1]);
    return extraRounds
      ? { action: 'resume', extraRounds }
      : { action: 'error', message: '恢复目标可用 /goal resume，追加轮数可用 /goal resume +2。轮数总计最多 100。' };
  }

  const headers = [...body.matchAll(SECTION)];
  const objectiveParts = [body.slice(0, headers[0]?.index ?? body.length).trim()];
  const acceptance = [];
  const constraints = [];
  let maxRounds = DEFAULT_GOAL_ROUNDS;
  for (const [index, header] of headers.entries()) {
    const value = body.slice(header.index + header[0].length, headers[index + 1]?.index ?? body.length).trim();
    if (header[1] === '目标') objectiveParts.push(value);
    else if (header[1] === '约束') constraints.push(...listItems(value));
    else if (header[1] === '轮数') {
      maxRounds = parseRounds(value);
      if (!maxRounds) return { action: 'error', message: '轮数须为 1 至 100 的整数，例如「轮数：5」。' };
    } else acceptance.push(...listItems(value));
  }
  const objective = objectiveParts.filter(Boolean).join('\n');
  if (!objective || !acceptance.length) return { action: 'error', message: USAGE };
  return { action: 'create', objective, acceptance, constraints, maxRounds };
}
