import { createChatCompletion } from './provider/index.js';
import { inferMemoryFamily, normalizeMemoryKind, normalizeMemoryScope, buildDreamPromotionGraphBlock } from './memory-policy.js';
import { appendStructuredOutputLanguageRule } from './reply-language.js';
import { isMemoryStale } from './memory-lifecycle.js';
import { retentionScore } from './memory-ranker.js';

const EVAL_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `You are a memory consolidation evaluator for a coding assistant. You receive a batch of inbox items (tool errors, observations, user signals, etc.) and decide for each one:

1. **keep or discard** — Does this contain a reusable, durable insight? Discard transient errors, one-off issues, and noise.
2. **scope** — "user" for lasting personal preferences/interests/habits; "project" for this repository only; "global" for cross-project environment/tool knowledge.
3. **kind** — Exactly one of:
   - preference — user tastes, interests, habits, interaction style
   - convention — durable workflows, commands, architecture/tool rules
   - lesson — corrections and reusable learnings from failures or wins
   - note — other durable facts
4. **content** — A refined, actionable sentence. NOT raw error text.
5. **summary** — Short label (under 80 chars).
6. **confidence** — 0.5–1.0.

Respond with valid JSON only, no markdown fences:
{"results":[{"id":"<inbox-id>","action":"keep","scope":"user|global|project","kind":"preference|convention|lesson|note","content":"...","summary":"...","confidence":0.8},{"id":"<inbox-id>","action":"discard","reason":"..."}]}

Rules:
- Raw tool error messages are NOT insights by themselves. Only keep if they reveal a reusable lesson.
- "exit 127", "command not found", "permission denied", "blocked by policy" → always discard
- User interests, hobbies, likes/dislikes, and interaction preferences → scope "user", kind "preference"
- Project-specific paths, file names, or commands → scope "project", kind "convention" or "lesson"
- General coding/environment knowledge → scope "global"
- For source="session-review", discard proposed/brainstormed ideas, durable_score below 5, and candidates without grounded user/verified evidence.
- Treat session-review items as nominations only; independently confirm they are durable before keeping them.
- If in doubt, discard. Memory is expensive; only promote what future sessions will genuinely benefit from.

${buildDreamPromotionGraphBlock()}`;

const MAINTENANCE_SYSTEM_PROMPT = `You are maintaining an existing persistent memory bucket for a coding assistant.

Your job:
1. Merge duplicates and near-duplicates.
2. Summarize clusters into fewer, higher-signal memories.
3. Remove stale, contradictory, trivial, or overly specific noise. An item with "stale":true or an expired expected_valid_days should be archived (reason "stale") unless it is still clearly valid.
4. Preserve important exact commands, file paths, preferences, and constraints.
5. Keep memories scoped exactly to the bucket you receive.
6. Use only these kinds: preference | convention | lesson | note.

Respond with valid JSON only, no markdown fences. Return all four arrays, even when empty:
{"promotions":[],"staleness":[{"memory_id":"mem_...","action":"extend","extend_days":90}],"consolidations":[{"source_ids":["mem_...","mem_..."],"result":{"kind":"preference|convention|lesson|note","content":"durable memory text","summary":"under 80 chars","semantic_key":"stable key when provided","confidence":0.5,"pinned":false,"lifecycle":"longterm|operational"}}],"archives":[{"memory_id":"mem_...","reason":"superseded|stale|duplicate|noise|contradiction"}]}

Rules:
- Prefer fewer, clearer items, but do not collapse unrelated facts.
- User preferences belong in user memory and should not become project rules.
- Project conventions belong in project memory and should not become user preferences.
- Global memory is only for reusable cross-project/tool/environment knowledge.
- Keep a newly learned lesson operational unless the input already marks it longterm or clearly records repeated verification.
- Preserve a supplied semantic_key when retaining the same fact; use one stable key when merging duplicates.
- If a pinned item is still valid, keep it.
- Do not return unchanged memories. Return actions only.
- Use staleness action "extend" when an expired fact is still valid. extend_days must be between 1 and 3650.
- Consolidations must cite at least two source_ids from the input. Archives and staleness must cite a memory_id from the input.
- promotions is reserved for inbox candidates and must be [] for this existing-memory request.`;

function buildEvalSystemPrompt(config = {}) {
  return appendStructuredOutputLanguageRule(SYSTEM_PROMPT, config, {
    fields: 'content, summary, and discard reason'
  });
}

function buildMaintenanceSystemPrompt(config = {}) {
  return appendStructuredOutputLanguageRule(MAINTENANCE_SYSTEM_PROMPT, config, {
    fields: 'consolidation content, summary, and archive reason'
  });
}

function parseResults(text) {
  try {
    const json = JSON.parse(text);
    if (!json?.results || !Array.isArray(json.results)) return [];
    return json.results.map((r) => ({
      id: String(r.id || ''),
      action: r.action === 'keep' ? 'keep' : r.action === 'retry' ? 'retry' : 'discard',
      scope: normalizeMemoryScope(r.scope, { fallback: 'global' }),
      kind: normalizeMemoryKind(r.kind, 'note'),
      family: inferMemoryFamily({
        family: r.family,
        scope: normalizeMemoryScope(r.scope, { fallback: 'global' }),
        kind: normalizeMemoryKind(r.kind, 'note'),
        content: String(r.content || ''),
        summary: String(r.summary || '')
      }),
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
    details: (e.details || '').slice(0, 400),
    semantic_key: String(e.semanticKey || '').slice(0, 160),
    decision_state: String(e.evidence?.decisionState || '').slice(0, 40),
    durable_score: Number(e.evidence?.durableScore || 0),
    evidence_roles: Array.isArray(e.evidence?.evidenceRoles) ? e.evidence.evidenceRoles.slice(0, 8) : []
  }));

  try {
    const result = await createChatCompletion({
      sdkProvider: config?.sdk?.provider,
      baseUrl: config?.gateway?.base_url,
      apiKey: config?.gateway?.api_key,
      model: config?.model?.name,
      messages: [
        { role: 'system', content: buildEvalSystemPrompt(config) },
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
    /* LLM 调用失败 → 保留 inbox，等待下次 dream 重试 */
    return entries.map((e) => ({
      id: e.id,
      action: 'retry',
      reason: 'evaluator-unavailable: LLM evaluation failed'
    }));
  }
}

export function parseMaintenanceResult(text) {
  try {
    const json = JSON.parse(text);
    const promotions = Array.isArray(json?.promotions) ? json.promotions : [];
    const staleness = Array.isArray(json?.staleness) ? json.staleness : [];
    const consolidations = Array.isArray(json?.consolidations) ? json.consolidations : [];
    const archives = Array.isArray(json?.archives) ? json.archives : [];
    return {
      promotions,
      staleness: staleness.map((item) => {
        const extendDays = Math.floor(Number(item.extend_days ?? item.extendDays));
        return {
          memoryId: String(item.memory_id || item.memoryId || ''),
          action: String(item.action || '').toLowerCase() === 'extend' ? 'extend' : 'ignore',
          extendDays: Number.isFinite(extendDays) ? Math.min(3650, Math.max(1, extendDays)) : 0
        };
      }).filter((item) => item.memoryId && item.action === 'extend' && item.extendDays > 0),
      consolidations: consolidations.map((entry) => {
        const result = entry?.result || {};
        return {
          sourceIds: Array.isArray(entry?.source_ids)
            ? entry.source_ids.map((id) => String(id)).filter(Boolean)
            : [],
          result: {
            kind: normalizeMemoryKind(result.kind, 'note'),
            content: String(result.content || '').slice(0, 600),
            summary: String(result.summary || result.content || '').slice(0, 120),
            semanticKey: String(result.semantic_key || result.semanticKey || '').slice(0, 160),
            confidence: Math.min(1, Math.max(0.5, Number(result.confidence) || 0.8)),
            pinned: result.pinned === true,
            lifecycle: ['longterm', 'operational'].includes(String(result.lifecycle || ''))
              ? String(result.lifecycle)
              : undefined
          }
        };
      }).filter((entry) => entry.sourceIds.length >= 2 && entry.result.content.trim()),
      archives: archives.map((archive) => ({
        memoryId: String(archive.memory_id || archive.memoryId || ''),
        reason: String(archive.reason || '').slice(0, 160)
      })).filter((archive) => archive.memoryId)
    };
  } catch {
    return { promotions: [], staleness: [], consolidations: [], archives: [] };
  }
}

export async function evaluateMemoryMaintenance({ scope, items, config, workspaceRoot }) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length === 0) {
    return { promotions: [], staleness: [], consolidations: [], archives: [] };
  }

  const compactItems = sourceItems.map((item) => ({
    id: item.id,
    kind: normalizeMemoryKind(item.kind, 'note'),
    content: String(item.content || '').slice(0, 600),
    summary: String(item.summary || '').slice(0, 160),
    semantic_key: String(item.semanticKey || '').slice(0, 160),
    confidence: item.confidence,
    pinned: item.pinned === true,
    lifecycle: item.lifecycle || '',
    success_count: Number(item.successCount || 0),
    failure_count: Number(item.failureCount || 0),
    utility_score: Number(item.utilityScore || 0),
    expected_valid_days: Number.isFinite(Number(item.expectedValidDays)) ? Number(item.expectedValidDays) : null,
    stale: config?.memory?.lifecycle?.staleness_review !== false ? isMemoryStale(item, Date.now()) : false,
    retention_score: retentionScore({
      confidence: item.confidence,
      lastConfirmedAt: item.lastConfirmedAt,
      accessCount: item.accessCount,
      now: Date.now()
    })
  }));

  try {
    const result = await createChatCompletion({
      sdkProvider: config?.sdk?.provider,
      baseUrl: config?.gateway?.base_url,
      apiKey: config?.gateway?.api_key,
      model: config?.model?.name,
      messages: [
        { role: 'system', content: buildMaintenanceSystemPrompt(config) },
        {
          role: 'user',
          content: `Maintain this ${scope} memory bucket. Workspace: ${workspaceRoot || process.cwd()}\n\n${JSON.stringify(compactItems, null, 2)}`
        }
      ],
      temperature: 0,
      timeoutMs: EVAL_TIMEOUT_MS
    });
    return parseMaintenanceResult(result?.text || '');
  } catch (error) {
    return {
      promotions: [],
      staleness: [],
      consolidations: [],
      archives: [],
      error: String(error?.message || error || 'memory maintenance failed')
    };
  }
}
