import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getSkillRegistryPath as getSkillRegistryPathFromPaths } from './paths.js';

function defaultRegistry() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: []
  };
}

export function getSkillRegistryPath() {
  return getSkillRegistryPathFromPaths();
}

export async function readSkillRegistry(registryPath = getSkillRegistryPath()) {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.skills)) {
      return defaultRegistry();
    }
    return parsed;
  } catch {
    return defaultRegistry();
  }
}

export async function writeSkillRegistry(registryPath = getSkillRegistryPath(), registry) {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  registry.updatedAt = new Date().toISOString();
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export async function upsertSkillRegistryEntry(registryPath = getSkillRegistryPath(), entry) {
  const registry = await readSkillRegistry(registryPath);
  const index = registry.skills.findIndex((s) => s.name === entry.name);
  if (index === -1) {
    registry.skills.push(entry);
  } else {
    registry.skills[index] = { ...registry.skills[index], ...entry };
  }
  await writeSkillRegistry(registryPath, registry);
}

export function getEnabledSkills(registry) {
  return (registry.skills || []).filter((s) => s.enabled !== false);
}

export async function computeFileSha256(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}
