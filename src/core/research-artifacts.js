/**
 * Deep Research artifact files — durable under Codemini global dir while Scout/Evaluator need them.
 * Cleaned after each criterion verifies successfully, and as session delete/done fallback.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { getBaseConfigDir } from './paths.js';

export function getResearchArtifactsRoot(rootDir = '') {
  const override = String(rootDir || '').trim();
  if (override) return override;
  return path.join(getBaseConfigDir(), 'research-artifacts');
}

export function researchArtifactDirForScope({
  sessionId,
  scoutRunId,
  criterionId,
  rootDir = '',
} = {}) {
  return path.join(
    getResearchArtifactsRoot(rootDir),
    String(sessionId || 'session'),
    String(scoutRunId || 'scout'),
    String(criterionId || 'criterion'),
  );
}

export function researchSessionArtifactsDir(sessionId, rootDir = '') {
  return path.join(
    getResearchArtifactsRoot(rootDir),
    String(sessionId || 'session'),
  );
}

/** Best-effort remove one criterion's on-disk artifacts after verify succeeds. */
export async function cleanupResearchCriterionArtifacts({
  sessionId,
  scoutRunId,
  criterionId,
  rootDir = '',
} = {}) {
  const dir = researchArtifactDirForScope({
    sessionId,
    scoutRunId,
    criterionId,
    rootDir,
  });
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  // Prune empty scout / session parents when possible.
  const scoutDir = path.dirname(dir);
  const sessionDir = path.dirname(scoutDir);
  await fs.rmdir(scoutDir).catch(() => {});
  await fs.rmdir(sessionDir).catch(() => {});
}

/** Best-effort remove all artifacts for a research session. */
export async function cleanupResearchSessionArtifacts(sessionId, rootDir = '') {
  const dir = researchSessionArtifactsDir(sessionId, rootDir);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
