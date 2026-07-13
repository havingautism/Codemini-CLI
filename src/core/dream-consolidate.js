import {
  getMemoryBucketMaintenance,
  listMemories,
  listInbox,
  archiveEntry,
  promoteMemory,
  replaceMemoryBucket
} from './memory-store.js';
import { writeDreamAuditReport } from './dream-audit.js';
import { evaluateInboxBatch, evaluateMemoryMaintenance } from './dream-evaluator.js';
import { chooseMemoryLifecycle, normalizeMemoryScope } from './memory-policy.js';

let dreamConsolidationRunning = false;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function memoryContainsSummary(memory, summaryKey) {
  const content = normalizeText(memory?.content);
  const summary = normalizeText(memory?.summary);
  return content.includes(summaryKey) || summary.includes(summaryKey);
}

function maintenanceScopes(scopeFilter) {
  const scope = normalizeText(scopeFilter);
  if (!scope) return ['user', 'global', 'project'];
  const normalized = normalizeMemoryScope(scope, { fallback: '' });
  if (['user', 'global', 'project'].includes(normalized)) return [normalized];
  return ['user', 'global', 'project'];
}

async function runMemoryMaintenance({
  dryRun = false,
  scope = null,
  workspaceRoot = process.cwd(),
  config = {}
} = {}) {
  const reports = [];
  const filesChanged = [];

  for (const memoryScope of maintenanceScopes(scope)) {
    const maintenance = await getMemoryBucketMaintenance({ scope: memoryScope, workspaceRoot });
    const items = await listMemories({ scope: memoryScope, workspaceRoot });
    if (items.length === 0) {
      reports.push({ scope: memoryScope, skipped: true, reason: 'empty' });
      continue;
    }
    if (maintenance.fresh) {
      reports.push({ scope: memoryScope, skipped: true, reason: 'already-maintained', itemCount: items.length });
      continue;
    }

    const evaluated = dryRun
      ? { items, archives: [] }
      : await evaluateMemoryMaintenance({ scope: memoryScope, items, config, workspaceRoot });
    if (evaluated.error) {
      reports.push({ scope: memoryScope, skipped: true, reason: `maintenance-error: ${evaluated.error}`, itemCount: items.length });
      continue;
    }
    const nextItems = Array.isArray(evaluated.items) && evaluated.items.length > 0 ? evaluated.items : items;
    const changed =
      JSON.stringify(nextItems.map((item) => [item.kind, item.content, item.summary, item.lifecycle || ''])) !==
      JSON.stringify(items.map((item) => [item.kind, item.content, item.summary, item.lifecycle || '']));

    if (!dryRun) {
      await replaceMemoryBucket({
        scope: memoryScope,
        items: nextItems,
        workspaceRoot,
        markMaintained: true
      });
      filesChanged.push({
        file: memoryScope === 'project' ? 'memory/project/*.json' : `memory/${memoryScope}.json`,
        why: changed
          ? `LLM-maintained ${items.length} item(s) into ${nextItems.length} item(s)`
          : `Marked ${items.length} item(s) as maintained`
      });
    }

    reports.push({
      scope: memoryScope,
      skipped: false,
      before: items.length,
      after: nextItems.length,
      changed,
      archives: evaluated.archives || [],
      dryRun
    });
  }

  return { reports, filesChanged };
}

export async function runDreamConsolidation({
  dryRun = false,
  scope = null,
  workspaceRoot = process.cwd(),
  config = {},
  writeAudit = true
} = {}) {
  if (dreamConsolidationRunning) {
    return {
      ok: true,
      skipped: true,
      reason: 'dream-already-running',
      dryRun,
      timestamp: new Date().toISOString(),
      candidatesGenerated: 0,
      promotions: [],
      rejections: [],
      archives: [],
      maintenance: []
    };
  }
  dreamConsolidationRunning = true;
  try {
  const scopeFilter = scope || null;
  const inbox = await listInbox({ scope: scopeFilter });

  const [globalMemories, userMemories, projectMemories] = await Promise.all([
    listMemories({ scope: 'global', workspaceRoot }),
    listMemories({ scope: 'user', workspaceRoot }),
    listMemories({ scope: 'project', workspaceRoot })
  ]);
  const projectMemoryCache = new Map([[String(workspaceRoot), projectMemories]]);
  const knownForEntry = async (entry) => {
    const entryScope = normalizeMemoryScope(entry?.scope, { fallback: 'project' });
    if (entryScope === 'user') return userMemories;
    if (entryScope === 'global') return globalMemories;
    const entryRoot = String(entry?.projectDir || workspaceRoot);
    if (!projectMemoryCache.has(entryRoot)) {
      projectMemoryCache.set(
        entryRoot,
        await listMemories({ scope: 'project', workspaceRoot: entryRoot }).catch(() => [])
      );
    }
    return projectMemoryCache.get(entryRoot);
  };

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
    const semanticKey = normalizeText(entry.semanticKey);
    const duplicateKey = semanticKey ? `semantic:${semanticKey}` : `summary:${summaryKey}`;
    if (!summaryKey) {
      if (!dryRun) await archiveEntry(entry, 'invalid-summary', 'Summary is empty after normalization');
      archives.push({ summary: String(entry.summary || ''), reason: 'invalid-summary' });
      continue;
    }

    if (seen.has(duplicateKey)) {
      if (!dryRun) await archiveEntry(entry, 'duplicate', `Duplicate of ${seen.get(duplicateKey)}`);
      archives.push({ summary: entry.summary, reason: 'duplicate' });
      continue;
    }
    seen.set(duplicateKey, entry.id);

    const knownMemories = await knownForEntry(entry);
    const alreadyKnown = knownMemories.some((memory) =>
      (semanticKey && normalizeText(memory?.semanticKey) === semanticKey) || memoryContainsSummary(memory, summaryKey)
    );
    if (alreadyKnown) {
      if (!dryRun) await archiveEntry(entry, 'already-known', 'Already present in memory');
      rejections.push({ summary: entry.summary, reason: 'already-known' });
      continue;
    }

    candidates.push(entry);
  }

  if (candidates.length > 0) {
    /* ── Phase 2: LLM 批量评估（质量门控 + scope 分类 + 内容提炼） ── */
    const llmResults = dryRun
      ? candidates.map((e) => ({ id: e.id, action: 'keep', scope: 'global', kind: e.type || 'observation', content: e.details || e.summary, summary: e.summary, confidence: 0.9 }))
      : await evaluateInboxBatch({ entries: candidates, config, workspaceRoot });

    const resultMap = new Map(llmResults.map((r) => [r.id, r]));

    /* ── Phase 3: 按评估结果 promote 或 archive ─────────────────── */
    for (const entry of candidates) {
      const evaluation = resultMap.get(entry.id);

      if (evaluation?.action === 'retry') {
        rejections.push({ summary: entry.summary, reason: evaluation.reason || 'evaluator-unavailable' });
        continue;
      }

      if (!evaluation || evaluation.action === 'discard') {
        const reason = evaluation?.reason || 'LLM discarded';
        if (!dryRun) await archiveEntry(entry, 'discarded-by-evaluator', reason);
        rejections.push({ summary: entry.summary, reason: `evaluator-discard: ${reason}` });
        continue;
      }

      const promoteScope = normalizeMemoryScope(evaluation.scope || 'global', { fallback: 'global' });
      const lifecycle = chooseMemoryLifecycle(evaluation.kind);
      const enrichedEntry = {
        ...entry,
        /* 用 LLM 提炼后的内容覆盖原始报错 */
        summary: evaluation.summary || entry.summary,
        details: evaluation.content || entry.details || entry.summary,
        type: evaluation.kind || entry.type || 'observation'
      };

      if (!dryRun) {
        try {
          const promotionWorkspaceRoot = promoteScope === 'project'
            ? String(entry.projectDir || workspaceRoot)
            : workspaceRoot;
          await promoteMemory({
            entry: enrichedEntry,
            scope: promoteScope,
            lifecycle,
            workspaceRoot: promotionWorkspaceRoot,
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
  }

  const maintenance = await runMemoryMaintenance({ dryRun, scope: scopeFilter, workspaceRoot, config });
  filesChanged.push(...maintenance.filesChanged);

  const report = {
    timestamp: new Date().toISOString(),
    filesRead,
    filesChanged,
    candidatesGenerated: inbox.length,
    promotions,
    rejections,
    archives,
    maintenance: maintenance.reports,
    ...(inbox.length === 0 ? { message: 'No inbox entries to consolidate; maintained existing memory buckets.' } : {})
  };

  if (!dryRun && writeAudit) {
    const reportPath = await writeDreamAuditReport(report);
    report.auditReport = reportPath;
  }

  return { ok: true, dryRun, ...report };
  } finally {
    dreamConsolidationRunning = false;
  }
}
