import { createChatCompletion } from './provider/index.js';
import { getReadOnlyCommandTokens } from './command-risk.js';
import { getReplyLanguageName } from './reply-language.js';
import { parseModelJsonObject } from './model-json.js';

const EVAL_TIMEOUT_MS = 15000;

function buildSystemPrompt(config = {}) {
  const readOnlyTokens = getReadOnlyCommandTokens().join(', ');
  const replyLanguage = getReplyLanguageName(config);
  return `You are a command safety evaluator for a coding assistant. Analyze the shell command and respond with valid JSON only, no markdown fences:
{"risk":"low|medium|high","description":"what this command does in one sentence","sideEffects":"potential side effects in one sentence, or none","recommendation":"allow|deny"}

Rules:
- Read-only command tokens are low risk and allow when used without write/network side effects: ${readOnlyTokens}.
- Treat common read-only subcommands such as git status, git diff, git log, git show, npm list, npm view, node --version, python --version, rg, fd, bat, Get-ChildItem, Get-Content, Select-String, and Test-Path as low risk.
- Consider the active shell and OS context, including Windows PowerShell command names and aliases.
- Commands that install/uninstall packages, modify files, push code, start servers, or have network side effects are medium or high.
- Destructive commands (rm -rf, format, sudo, dd) are high risk and deny.
- Do not mark pure inspection as medium: searching for words like install/rm/commit inside rg/grep/find/git log arguments is still low risk.
- Consider the workspace context: the command runs in the project directory.
- Write description and sideEffects in ${replyLanguage}. Keep risk and recommendation enum values in English exactly as specified.
- Be concise. Maximum 1 sentence per field.`;
}

function failedEvaluation(failureReason) {
  return {
    risk: 'high',
    description: '',
    sideEffects: '',
    recommendation: 'deny',
    failed: true,
    failureReason
  };
}

export function parseEvaluation(text) {
  try {
    const json = parseModelJsonObject(text);
    if (!json) throw new Error('invalid response');
    const risk = String(json?.risk || '').toLowerCase();
    const recommendation = String(json?.recommendation || '').toLowerCase();
    return {
      risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'high',
      description: String(json?.description || '').slice(0, 200),
      sideEffects: String(json?.sideEffects || '').slice(0, 200),
      recommendation: recommendation === 'allow' ? 'allow' : 'deny',
      failed: false
    };
  } catch {
    return failedEvaluation('invalid_response');
  }
}

/**
 * 用轻量 LLM 调用评估命令风险。
 * @param {{ command: string, config: object, workspaceRoot?: string }} params
 * @returns {Promise<{ risk: 'low'|'medium'|'high', description: string, sideEffects: string, recommendation: 'allow'|'deny' }>}
 */
export async function evaluateCommandWithLLM({ command, config, workspaceRoot }) {
  const cmd = String(command || '').trim();
  if (!cmd) return failedEvaluation('empty_command');

  try {
    const result = await createChatCompletion({
      sdkProvider: config?.sdk?.provider,
      baseUrl: config?.gateway?.base_url,
      apiKey: config?.gateway?.api_key,
      model: config?.model?.fast_name || config?.model?.name,
      messages: [
        { role: 'system', content: buildSystemPrompt(config) },
        { role: 'user', content: `Command: ${cmd}\nWorkspace: ${workspaceRoot || process.cwd()}` }
      ],
      temperature: 0,
      timeoutMs: EVAL_TIMEOUT_MS
    });

    const text = result?.text || '';
    return parseEvaluation(text);
  } catch (error) {
    const message = String(error?.message || error || '');
    return failedEvaluation(/abort|timed?\s*out|timeout/i.test(message) ? 'timeout' : 'provider_error');
  }
}
