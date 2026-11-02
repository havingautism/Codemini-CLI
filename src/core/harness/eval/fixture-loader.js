import fs from 'node:fs/promises';

export async function loadHarnessFixture(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.id) {
    throw new Error('Invalid harness fixture: id is required');
  }
  return {
    id: String(parsed.id),
    state: parsed.state && typeof parsed.state === 'object' ? parsed.state : {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
    expected: parsed.expected && typeof parsed.expected === 'object' ? parsed.expected : {},
  };
}
