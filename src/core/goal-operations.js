import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { isMcpToolName } from './mcp-tool-display.js';
import { isReplayableShellQuery } from './command-risk.js';
import { canonicalShellToolName, isShellToolName } from './shell-tool-name.js';

const journal = new AsyncLocalStorage();

// 只保存规范参数的摘要。命令、MCP 参数与原始返回值都可能包含凭据。
function digest(value) {
  const json = JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return createHash('sha256').update(json ?? 'null').digest('hex');
}

export function unresolvedGoalOperations(goal) {
  return goal?.operations?.filter(op => op.status === 'pending') ?? [];
}

export function goalResolutionHint(op) {
  return `请按工具调用 ${op.callId || op.id}（${op.label || op.tool}）核对目标系统。已生效用 /goal resolve ${op.id} done，确认可重试用 /goal resolve ${op.id} retry。`;
}

export function resolveGoalOperation(goal, id, resolution) {
  const op = goal?.operations?.find(item => item.id === id);
  if (!op) throw new Error('找不到指定的目标操作，请用 /goal status 查看。');
  if (goal.status !== 'paused') throw new Error('请先暂停目标再核对操作。');
  if (!['done', 'retry'].includes(resolution)) throw new Error('核对结果须为 done 或 retry。');
  return { ...goal, operations: goal.operations.map(item => item.id === id
    ? { ...item, status: resolution === 'done' ? 'confirmed' : 'retry' } : item) };
}

function receipt(result) {
  const exitCode = result?.code ?? result?.exit_code ?? result?.exitCode;
  const status = result?.background ? '已返回后台任务，需核对最终状态'
    : Number.isInteger(exitCode) ? `退出码 ${exitCode}`
    : result?.isError || result?.error || result?.ok === false ? '工具返回错误' : '工具已返回';
  const remoteId = result?.structuredContent?.id ?? result?.structuredContent?.number ?? result?.completed_task_id ?? result?.task_id ?? result?.id;
  const reference = ['number', 'string'].includes(typeof remoteId) && /^[\w.-]{1,100}$/u.test(String(remoteId))
    ? '，ID ' + remoteId : '';
  return { summary: status + reference, resultHash: digest(result) };
}

function operationLabel(tool, args) {
  if (isShellToolName(tool)) {
    const verbs = /^(gh\s+(?:issue|pr|release)\s+(?:create|edit|close|comment|merge|upload)|git\s+push|npm\s+publish|curl|Invoke-RestMethod)\b/iu.exec(String(args.command || '').trim());
    return verbs ? tool + ' ' + verbs[1] : tool;
  }
  const target = [args.owner, args.repo, args.issue_number ?? args.pull_number]
    .filter(item => ['string', 'number'].includes(typeof item) && /^[\w.-]{1,100}$/u.test(String(item)));
  return target.length ? tool + ' ' + target.join('/') : tool;
}

export function withGoalOperations({ current, save, stop, signal }, execute) {
  const goal = current();
  const protectedIds = new Set(goal.operations.filter(op => op.status === 'returned').map(op => op.id));
  const check = () => {
    if (signal.aborted || current()?.id !== goal.id || current().status !== 'active') throw new Error('目标执行已结束。');
  };
  return journal.run({
    begin(spec, args, context) {
      check();
      const tool = spec.name;
      const state = current();
      // 内置 Shell 始终使用创建工具时绑定的根目录，忽略模型自填的 cwd/workdir。
      // 两个空位保留之前未提供 cwd/workdir 时的操作摘要。
      const shell = isShellToolName(tool);
      const workspace = spec.handler.goalWorkingDirectory ?? context.workspaceRoot;
      const key = shell ? digest([canonicalShellToolName(tool), workspace, [args.command, null, null]])
        : digest([tool, args]);
      // MCP 客户端向同一服务发出同一组参数时，父代理和子代理的工作区不参与调用。
      const legacyKey = shell ? key : digest([tool, context.workspaceRoot, args]);
      const previous = state.operations.findLast(op => op.key === key || op.key === legacyKey);
      if (previous?.status === 'confirmed' || previous && previous.status !== 'retry' && protectedIds.has(previous.id)) {
        throw new Error(`该操作已有记录 ${previous.id}（${previous.summary || '用户已核实生效'}）。请读取现场并继续；确需再次执行可暂停后用 /goal resolve ${previous.id} retry。`);
      }
      const op = { id: randomUUID(), callId: String(context.toolCallId || ''), tool, label: operationLabel(tool, args), key,
        iteration: state.iteration, status: 'pending' };
      save({ ...state, operations: [...state.operations, op] });
      return op;
    },
    finish(op, result) {
      // 用户暂停时底层进程也可能被终止，此时工具的返回不足以确认外部写入结果。
      check();
      const state = current();
      const details = receipt(result);
      save({ ...state, operations: state.operations.map(item => item.id === op.id
        ? { ...item, status: 'returned', ...details } : item) });
    },
    interrupt(op) {
      if (!signal.aborted && current()?.id === goal.id) stop(goalResolutionHint(op));
    },
  }, execute);
}

// 位于参数校验和调用审批之后。普通会话、纯本地工具沿用原分发路径。
export async function dispatchGoalTool(spec, args, context) {
  const active = journal.getStore();
  if (!active) return spec.handler(args, context);
  const track = isShellToolName(spec.name) ? !isReplayableShellQuery(args)
    : isMcpToolName(spec.name) && spec.handler.goalReadOnly !== true;
  if (!track) return spec.handler(args, context);
  const op = active.begin(spec, args, context);
  try {
    const result = await spec.handler(args, context);
    active.finish(op, result);
    return result;
  } catch (error) {
    active.interrupt(op);
    throw error;
  }
}
