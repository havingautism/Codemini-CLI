import { createChatCompletion } from './provider/index.js';

const EVAL_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `You are a memory consolidation evaluator for a coding assistant. You receive a batch of inbox items (tool errors, observations, etc.) and decide for each one:

1. **keep or discard** — Does this contain a reusable, durable insight? Discard transient errors, one-off issues, and noise.
2. **scope** — "global" for cross-project knowledge (e.g., "WSL bash exec does not support cd"), "project" for project-specific context (e.g., "this project uses vitest for testing").
3. **kind** — One of: pattern, observation, correction, decision, failure
4. **content** — A refined, actionable sentence describing the insight. NOT the raw error text.
5. **summary** — A short label (under 80 chars) for quick scanning.
6. **confidence** — 0.5–1.0 based on how certain and durable the insight is.

Respond with valid JSON only, no markdown fences:
{"results":[{"id":"<inbox-id>","action":"keep","scope":"global|project","kind":"pattern|observation|correction|decision|failure","content":"...","summary":"...","confidence":0.8},{"id":"<inbox-id>","action":"discard","reason":"..."}]}

Rules:
- Raw tool error messages are NOT insights by themselves. Only keep if they reveal a reusable lesson.
- "exit 127", "command not found", "permission denied", "blocked by policy" → always discard (transient/config issues)
- A repeated pattern across multiple errors → keep as a "pattern" or "correction"
- Project-specific paths, file names, or commands → scope "project"
- General coding/environment knowledge → scope "global"
- If in doubt, discard. Memory is expensive; only promote what future sessions will genuinely benefit from.`;

function parseResults(text) {
  try {
    const json = JSON.parse(text);
    if (!json?.results || !Array.isArray(json.results)) return [];
    return json.results.map((r) => ({
      id: String(r.id || ''),
      action: r.action === 'keep' ? 'keep' : 'discard',
      scope: r.scope === 'project' ? 'project' : 'global',
      kind: ['pattern', 'observation', 'correction', 'decision', 'failure'].includes(r.kind) ? r.kind : 'observation',
      content: String(r.content || '').slice(0, 300),
      summary: String(r.summary || '').slice(0, 120),
      confidence: Math.min(1, Math.max(0.5, Number(r.confidence) || 0.7)),
      reason: String(r.reason || '')
    }));
  } catch {
    return [];
  }
}

/**
 * 用 LLM 批量评估 inbox 条目，决定保留/丢弃、scope、内容提炼。
 * @param {{ entries: Array, config: object, workspaceRoot?: string }} params
 * @returns {Promise<Array<{ id, action, scope?, kind?, content?, summary?, confidence?, reason? }>>}
 */
export async function evaluateInboxBatch({ entries, config, workspaceRoot }) {
  if (!entries || entries.length === 0) return [];

  const batch = entries.map((e) => ({
    id: e.id,
    type: e.type || '',
    source: e.source || '',
    summary: (e.summary || '').slice(0, 150),
    details: (e.details || '').slice(0, 400)
  }));

  try {
    const result = await createChatCompletion({
      sdkProvider: config?.sdk?.provider,
      baseUrl: config?.gateway?.base_url,
      apiKey: config?.gateway?.api_key,
      model: config?.model?.name,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Evaluate these ${batch.length} inbox items. Workspace: ${workspaceRoot || process.cwd()}\n\n${JSON.stringify(batch, null, 2)}`
        }
      ],
      temperature: 0,
      timeoutMs: EVAL_TIMEOUT_MS
    });

    const text = result?.text || '';
    const parsed = parseResults(text);
    /* 确保每个 entry 都有结果，LLM 没返回的一律 discard */
    const covered = new Set(parsed.map((r) => r.id));
    for (const entry of entries) {
      if (!covered.has(entry.id)) {
        parsed.push({
          id: entry.id,
          action: 'discard',
          reason: 'LLM did not return a result for this entry'
        });
      }
    }
    return parsed;
  } catch {
    /* LLM 调用失败 → 全部 discard（fail-safe） */
    return entries.map((e) => ({
      id: e.id,
      action: 'discard',
      reason: 'LLM evaluation failed'
    }));
  }
}
