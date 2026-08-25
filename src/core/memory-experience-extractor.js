/**
 * Deterministic coding-lesson extractor (design §21).
 * Turns a VERIFIED experience episode (failed approach → verified working
 * approach) into a durable coding candidate. A future LLM refinement can
 * replace this module without changing the tracker contract.
 */
export function buildCodingLessonFromEpisode(episode = {}) {
  const failedApproach = episode.failedApproach || {};
  const workingApproach = episode.workingApproach || {};
  const failedText = `${failedApproach.tool || ''} ${failedApproach.argsSummary || ''}`.trim();
  const workingText = `${workingApproach.tool || ''} ${workingApproach.argsSummary || ''}`.trim();
  const summary = (failedText ? `${failedText} failed; use ${workingText || 'working approach'}` : (workingText || 'recovered approach')).slice(0, 120);
  const content = [
    `Failed approach: ${failedText}${failedApproach.errorClass ? ` (${failedApproach.errorClass})` : ''}`.trim(),
    `Verified working approach: ${workingText}`.trim(),
    Number(episode.failedCount) > 0 ? `Failed attempts: ${Number(episode.failedCount)}` : ''
  ].filter(Boolean).join('\n');
  const semanticKey = `coding-recovery:${failedText || workingText}`
    .slice(0, 120)
    .replace(/[^a-z0-9:._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    summary,
    content,
    semanticKey,
    evidence: {
      sessionId: String(episode.sessionId || '').slice(0, 120),
      failed_attempts: Number(episode.failedCount || 0),
      successful_recovery: true,
      verified: true,
      verification: { type: String(episode.verificationType || 'test_exit_zero') },
      tool_names: Array.isArray(episode.toolNames) ? episode.toolNames.slice(0, 8) : [],
      failed_approach: failedText.slice(0, 240),
      working_approach: workingText.slice(0, 240)
    }
  };
}
