import crypto from 'node:crypto';

export function shouldActivateHarness({ harness = {}, sessionId = '', projectDir = '', riskTier = 'low' } = {}) {
  if (harness.enabled !== true) return false;
  if (harness.rollout?.enabled !== true) return true;
  return shouldRollout({ rollout: harness.rollout, sessionId, projectDir, riskTier });
}

export function shouldRollout({ rollout = {}, sessionId = '', projectDir = '', riskTier = 'low' } = {}) {
  if (rollout.enabled !== true) return false;
  if (!Array.isArray(rollout.risk_tiers) || !rollout.risk_tiers.includes(String(riskTier).toLowerCase())) return false;
  if (rollout.projects?.length && !rollout.projects.includes(String(projectDir))) return false;
  if (rollout.sessions?.length && !rollout.sessions.includes(String(sessionId))) return false;
  const percentage = Math.max(0, Math.min(100, Number(rollout.percentage) || 0));
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  // Windows 路径大小写和分隔符不代表不同项目，否则同一个项目会因为
  // 从不同入口启动而落入不同灰度桶，导致任务决策助手时有时无。
  const stableProjectDir = String(projectDir || '').replaceAll('\\', '/').toLowerCase();
  const digest = crypto.createHash('sha256').update(`${rollout.salt || 'harness-v1'}:${sessionId}:${stableProjectDir}`).digest();
  const bucket = digest.readUInt32BE(0) % 10000;
  return bucket < percentage * 100;
}
