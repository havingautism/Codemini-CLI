import crypto from 'node:crypto';

export function shouldRollout({ rollout = {}, sessionId = '', projectDir = '', riskTier = 'low' } = {}) {
  if (rollout.enabled !== true) return false;
  if (!Array.isArray(rollout.risk_tiers) || !rollout.risk_tiers.includes(String(riskTier).toLowerCase())) return false;
  if (rollout.projects?.length && !rollout.projects.includes(String(projectDir))) return false;
  if (rollout.sessions?.length && !rollout.sessions.includes(String(sessionId))) return false;
  const percentage = Math.max(0, Math.min(100, Number(rollout.percentage) || 0));
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  const digest = crypto.createHash('sha256').update(`${rollout.salt || 'harness-v1'}:${sessionId}:${projectDir}`).digest();
  const bucket = digest.readUInt32BE(0) % 10000;
  return bucket < percentage * 100;
}
