/** Clean-context handoff helper for legacy supervisor roles. */

/**
 * Build a ledger-only handoff for clean-context supervisor roles.
 * @param {Array} runItems
 * @param {string} role
 */
export function buildCleanContextHandoff(runItems = [], role = '') {
  const steps = Array.isArray(runItems) ? runItems : [];
  const relevant = steps.filter(
    (step) => step && !step.failed && step.role !== 'reviewer' && step.role !== 'tester',
  );
  if (relevant.length === 0) return '';

  const focusPaths = [];
  const seen = new Set();
  const ledger = [];

  for (const step of relevant.slice(-6)) {
    for (const artifactPath of Array.isArray(step.artifactPaths) ? step.artifactPaths : []) {
      if (!artifactPath || seen.has(artifactPath)) continue;
      seen.add(artifactPath);
      focusPaths.push(artifactPath);
      if (focusPaths.length >= 8) break;
    }
    const title = String(step.title || step.role || 'step').trim();
    const roleName = String(step.role || '').trim() || 'step';
    ledger.push(`- [${roleName}] ${title}`);
    const output = String(step.output || '');
    for (const section of ['Findings', 'Actions Taken', 'Verified', 'Not Verified', 'Failures', 'Artifacts', 'Handoff']) {
      const match = output.match(new RegExp(`(?:^|\\n)##?\\s*${section}\\s*\\n([\\s\\S]*?)(?=\\n##?\\s+|$)`, 'i'));
      if (!match?.[1]) continue;
      const bullets = match[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
        .filter((line) => line && !/^none\b/i.test(line))
        .slice(0, 3);
      if (bullets.length) {
        ledger.push(`  ${section}:`);
        for (const bullet of bullets) ledger.push(`  - ${bullet}`);
      }
    }
  }

  const lines = [
    `Clean-context handoff for ${role || 'supervisor'} (inspectable ledger only; no executor transcript):`,
  ];
  if (focusPaths.length) {
    lines.push('Focus paths:');
    for (const path of focusPaths) lines.push(`- ${path}`);
  }
  if (ledger.length) {
    lines.push('Ledger:');
    lines.push(...ledger.slice(0, 40));
  }
  return lines.join('\n');
}
