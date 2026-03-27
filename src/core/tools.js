import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDangerousCommand, runShellCommand } from './shell.js';
import { evaluateCommandPolicy } from './command-policy.js';

function resolveInWorkspace(root, targetPath = '.') {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(absRoot, targetPath);
  if (!absTarget.startsWith(absRoot)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absTarget;
}

async function readFile(root, args) {
  const target = resolveInWorkspace(root, args?.path);
  const stat = await fs.stat(target);
  const text = await fs.readFile(target, 'utf8');
  const lines = text.split('\n');
  const totalLines = lines.length;
  const startLineRaw = Number(args?.start_line);
  const endLineRaw = Number(args?.end_line);
  const defaultLines = Number(args?.default_lines || 220);
  const maxChars = Number(args?.max_chars || 24000);
  const includeContent = Boolean(args?.include_content);

  let startLine = Number.isFinite(startLineRaw) && startLineRaw > 0 ? startLineRaw : 1;
  let endLine =
    Number.isFinite(endLineRaw) && endLineRaw >= startLine
      ? endLineRaw
      : Math.min(totalLines, startLine + Math.max(1, defaultLines) - 1);
  startLine = Math.max(1, Math.min(startLine, totalLines));
  endLine = Math.max(startLine, Math.min(endLine, totalLines));

  const tokenSeed = `${args?.path}|${stat.size}|${stat.mtimeMs}|${startLine}|${endLine}`;
  const readToken = crypto.createHash('sha1').update(tokenSeed).digest('hex').slice(0, 16);

  if (!includeContent) {
    return {
      path: args?.path,
      phase: 'metadata',
      size_bytes: stat.size,
      modified_at: new Date(stat.mtimeMs).toISOString(),
      total_lines: totalLines,
      suggested_start_line: startLine,
      suggested_end_line: endLine,
      read_token: readToken,
      next: 'Call read_file again with include_content=true and this read_token'
    };
  }

  if (String(args?.read_token || '') !== readToken) {
    return {
      path: args?.path,
      phase: 'metadata',
      error: 'read_token mismatch or missing',
      size_bytes: stat.size,
      modified_at: new Date(stat.mtimeMs).toISOString(),
      total_lines: totalLines,
      suggested_start_line: startLine,
      suggested_end_line: endLine,
      read_token: readToken,
      next: 'Retry with include_content=true and read_token from latest metadata'
    };
  }

  let content = lines.slice(startLine - 1, endLine).join('\n');
  let truncated = false;
  if (maxChars > 0 && content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n... [truncated by max_chars]`;
    truncated = true;
  }

  return {
    path: args?.path,
    phase: 'content',
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    truncated,
    content
  };
}

async function writeFile(root, args) {
  const target = resolveInWorkspace(root, args?.path);
  let before = '';
  let existed = true;
  try {
    before = await fs.readFile(target, 'utf8');
  } catch {
    existed = false;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (args?.append) {
    await fs.appendFile(target, args?.content || '', 'utf8');
  } else {
    await fs.writeFile(target, args?.content || '', 'utf8');
  }
  const after = args?.append ? `${before}${args?.content || ''}` : args?.content || '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let changeLine = 0;
  const scanMax = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < scanMax; i += 1) {
    if ((beforeLines[i] || '') !== (afterLines[i] || '')) {
      changeLine = i + 1;
      break;
    }
  }
  const previewStart = Math.max(0, (changeLine || 1) - 1);
  const previewLines = afterLines.slice(previewStart, previewStart + 6);
  return {
    ok: true,
    path: args?.path,
    action: args?.append ? 'append' : existed ? 'overwrite' : 'create',
    changed_line: changeLine || Math.max(1, afterLines.length),
    diff_preview: previewLines.map((line, idx) => `${previewStart + idx + 1}| ${line}`).join('\n')
  };
}

async function runCommand(root, config, args) {
  const command = args?.command || '';
  if (!command.trim()) {
    throw new Error('run_command requires command');
  }
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(command, config.policy.blocked_command_patterns)
  ) {
    throw new Error('Command blocked by policy');
  }

  const check = evaluateCommandPolicy(command, config, root);
  if (!check.allowed) {
    throw new Error(
      `Command blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ''}`
    );
  }

  const result = await runShellCommand({
    command,
    cwd: root,
    shell: config.shell.default,
    timeoutMs: config.shell.timeout_ms
  });
  return { ...result, command };
}

export function getBuiltinTools({ workspaceRoot = process.cwd(), config, sessionId = '' }) {
  const definitions = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Two-phase read: first call returns metadata+read_token; second call with include_content=true and matching read_token returns content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            max_chars: { type: 'number' },
            include_content: { type: 'boolean' },
            read_token: { type: 'string' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write a UTF-8 text file in workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            append: { type: 'boolean' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command in workspace',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' }
          },
          required: ['command']
        }
      }
    }
  ];

  const handlers = {
    read_file: (args) =>
      readFile(workspaceRoot, {
        ...args,
        default_lines: config.context?.read_file_default_lines ?? 220,
        max_chars:
          typeof args?.max_chars === 'number'
            ? args.max_chars
            : config.context?.read_file_max_chars ?? 24000
      }),
    write_file: (args) => writeFile(workspaceRoot, args),
    run_command: (args) => runCommand(workspaceRoot, config, args)
  };

  return { definitions, handlers };
}
