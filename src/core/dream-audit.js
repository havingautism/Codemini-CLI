import fs from 'node:fs/promises';
import path from 'node:path';
import { getDreamAuditDir } from './paths.js';

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function renderReport(report) {
  const lines = [
    `# Dream Consolidation Report`,
    `Date: ${report.timestamp}`,
    ``
  ];

  if (report.filesRead?.length) {
    lines.push('## Files Read');
    for (const f of report.filesRead) lines.push(`- ${f}`);
    lines.push('');
  }

  if (report.candidatesGenerated) {
    lines.push(`## Candidates Generated: ${report.candidatesGenerated}`);
    lines.push('');
  }

  if (report.promotions?.length) {
    lines.push('## Promotions');
    for (const p of report.promotions) {
      lines.push(`- [${p.lifecycle}] ${p.summary} (scope: ${p.scope})`);
      if (p.rationale) lines.push(`  Rationale: ${p.rationale}`);
    }
    lines.push('');
  }

  if (report.rejections?.length) {
    lines.push('## Rejections');
    for (const r of report.rejections) {
      lines.push(`- ${r.summary}`);
      if (r.reason) lines.push(`  Reason: ${r.reason}`);
    }
    lines.push('');
  }

  if (report.archives?.length) {
    lines.push('## Archives');
    for (const a of report.archives) {
      lines.push(`- ${a.summary} (reason: ${a.reason || 'expired'})`);
    }
    lines.push('');
  }

  if (report.filesChanged?.length) {
    lines.push('## Files Changed');
    for (const fc of report.filesChanged) lines.push(`- ${fc.file}: ${fc.why}`);
    lines.push('');
  }

  if (report.disagreements?.length) {
    lines.push('## Reviewer Disagreements');
    for (const d of report.disagreements) {
      lines.push(`- ${d.item}: main=${d.mainVerdict}, reviewer=${d.reviewerVerdict}, resolved=${d.resolution}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeDreamAuditReport(report) {
  const dir = getDreamAuditDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = nowStamp();
  const filePath = path.join(dir, `dream-${stamp}.md`);
  const content = renderReport(report);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function listDreamAuditReports() {
  const dir = getDreamAuditDir();
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.startsWith('dream-') && e.endsWith('.md'))
    .sort()
    .reverse()
    .map((e) => path.join(dir, e));
}
