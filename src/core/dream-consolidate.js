import { listMemories, listInbox, archiveEntry, promoteMemory } from './memory-store.js';
import { writeDreamAuditReport } from './dream-audit.js';

const LONGTERM_TYPES = new Set(['preference', 'pattern', 'win', 'decision']);
const OPERATIONAL_TYPES = new Set(['correction', 'failure', 'gap', 'observation']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function mapInboxScopeToMemoryScope(scope) {
  const value = normalizeText(scope);
  if (value === 'repo' || value === 'project') return 'project';
  if (value === 'thread') return 'global';
  if (value === 'user') return 'user';
  return 'global';
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

    const lifecycle = chooseLifecycle(entry.type);
    const promoteScope = mapInboxScopeToMemoryScope(entry.scope);

    if (!dryRun) {
      try {
        await promoteMemory({ entry, scope: promoteScope, lifecycle, workspaceRoot, config });
        filesChanged.push({ file: `memory/${promoteScope}.json`, why: `Promoted "${entry.summary}" as ${lifecycle}` });
        promotions.push({ summary: entry.summary, scope: promoteScope, lifecycle, rationale: entry.type });
      } catch (error) {
        const reason = String(error?.message || error || 'promotion failed').slice(0, 180);
        await archiveEntry(entry, 'promotion-failed', reason);
        rejections.push({ summary: entry.summary, reason: `promotion-failed: ${reason}` });
        archives.push({ summary: entry.summary, reason: 'promotion-failed' });
      }
      continue;
    }

    promotions.push({ summary: entry.summary, scope: promoteScope, lifecycle, rationale: entry.type, dryRun: true });
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
