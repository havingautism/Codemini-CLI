import { listMemories, listInbox, archiveEntry, promoteMemory } from './memory-store.js';
import { writeDreamAuditReport } from './dream-audit.js';
import { evaluateInboxBatch } from './dream-evaluator.js';

const LONGTERM_TYPES = new Set(['preference', 'pattern', 'win', 'decision']);
const OPERATIONAL_TYPES = new Set(['correction', 'failure', 'gap', 'observation']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function chooseLifecycle(type) {
  const value = normalizeText(type);
  if (LONGTERM_TYPES.has(value)) return 'longterm';
  if (OPERATIONAL_TYPES.has(value)) return 'operational';
  return 'operational';
}

function memoryContainsSummary(memory, summaryKey) {
  const content = normalizeText(memory?.content);
  const summary = normalizeText(memory?.summary);
  return content.includes(summaryKey) || summary.includes(summaryKey);
}

export async function runDreamConsolidation({
  dryRun = false,
  scope = null,
  workspaceRoot = process.cwd(),
  config = {},
  writeAudit = true
} = {}) {
  const scopeFilter = scope || null;
  const inbox = await listInbox({ scope: scopeFilter });
  if (inbox.length === 0) {
    return { ok: true, dryRun, message: 'No inbox entries to consolidate.', promotions: [], rejections: [], archives: [] };
  }

  const [globalMemories, userMemories, projectMemories] = await Promise.all([
    listMemories({ scope: 'global', workspaceRoot }),
    listMemories({ scope: 'user', workspaceRoot }),
    listMemories({ scope: 'project', workspaceRoot })
  ]);
  const knownMemories = [...globalMemories, ...userMemories, ...projectMemories];

  const promotions = [];
  const rejections = [];
  const archives = [];
  const filesRead = ['memory/inbox/*', 'memory/global.json', 'memory/user.json', 'memory/project/*.json'];
  const filesChanged = [];

  /* ── Phase 1: 规则预过滤（快速剔除明显垃圾） ─────────────────── */
  const candidates = [];
  const seen = new Map();

  for (const entry of inbox) {
    const summaryKey = normalizeText(entry.summary);
    if (!summaryKey) {
      if (!dryRun) await archiveEntry(entry, 'invalid-summary', 'Summary is empty after normalization');
      archives.push({ summary: String(entry.summary || ''), reason: 'invalid-summary' });
      continue;
    }

    if (seen.has(summaryKey)) {
      if (!dryRun) await archiveEntry(entry, 'duplicate', `Duplicate of ${seen.get(summaryKey)}`);
      archives.push({ summary: entry.summary, reason: 'duplicate' });
      continue;
    }
    seen.set(summaryKey, entry.id);

    const alreadyKnown = knownMemories.some((memory) => memoryContainsSummary(memory, summaryKey));
    if (alreadyKnown) {
      if (!dryRun) await archiveEntry(entry, 'already-known', 'Already present in memory');
      rejections.push({ summary: entry.summary, reason: 'already-known' });
      continue;
    }

    candidates.push(entry);
  }

  if (candidates.length === 0) {
    const report = { timestamp: new Date().toISOString(), filesRead, filesChanged: [], candidatesGenerated: inbox.length, promotions, rejections, archives };
    if (!dryRun && writeAudit) {
      const reportPath = await writeDreamAuditReport(report);
      report.auditReport = reportPath;
    }
    return { ok: true, dryRun, ...report };
  }

  /* ── Phase 2: LLM 批量评估（质量门控 + scope 分类 + 内容提炼） ── */
  const llmResults = dryRun
    ? candidates.map((e) => ({ id: e.id, action: 'keep', scope: 'global', kind: e.type || 'observation', content: e.details || e.summary, summary: e.summary, confidence: 0.9 }))
    : await evaluateInboxBatch({ entries: candidates, config, workspaceRoot });

  const resultMap = new Map(llmResults.map((r) => [r.id, r]));

  /* ── Phase 3: 按评估结果 promote 或 archive ─────────────────── */
  for (const entry of candidates) {
    const evaluation = resultMap.get(entry.id);

    if (!evaluation || evaluation.action === 'discard') {
      const reason = evaluation?.reason || 'LLM discarded';
      if (!dryRun) await archiveEntry(entry, 'discarded-by-evaluator', reason);
      rejections.push({ summary: entry.summary, reason: `evaluator-discard: ${reason}` });
      continue;
    }

    const promoteScope = evaluation.scope || 'global';
    const lifecycle = chooseLifecycle(evaluation.kind);
    const enrichedEntry = {
      ...entry,
      /* 用 LLM 提炼后的内容覆盖原始报错 */
      summary: evaluation.summary || entry.summary,
      details: evaluation.content || entry.details || entry.summary,
      type: evaluation.kind || entry.type || 'observation'
    };

    if (!dryRun) {
      try {
        await promoteMemory({
          entry: enrichedEntry,
          scope: promoteScope,
          lifecycle,
          workspaceRoot,
          config,
          confidence: evaluation.confidence || 0.8
        });
        filesChanged.push({ file: `memory/${promoteScope}.json`, why: `Promoted "${enrichedEntry.summary}" as ${lifecycle} (${promoteScope})` });
        promotions.push({ summary: enrichedEntry.summary, scope: promoteScope, lifecycle, rationale: evaluation.kind, confidence: evaluation.confidence });
      } catch (error) {
        const reason = String(error?.message || error || 'promotion failed').slice(0, 180);
        await archiveEntry(entry, 'promotion-failed', reason);
        rejections.push({ summary: entry.summary, reason: `promotion-failed: ${reason}` });
        archives.push({ summary: entry.summary, reason: 'promotion-failed' });
      }
      continue;
    }

    promotions.push({ summary: enrichedEntry.summary, scope: promoteScope, lifecycle, rationale: evaluation.kind, confidence: evaluation.confidence, dryRun: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    filesRead,
    filesChanged,
    candidatesGenerated: inbox.length,
    promotions,
    rejections,
    archives
  };

  if (!dryRun && writeAudit) {
    const reportPath = await writeDreamAuditReport(report);
    report.auditReport = reportPath;
  }

  return { ok: true, dryRun, ...report };
}
