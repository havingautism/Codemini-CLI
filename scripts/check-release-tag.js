import fs from 'node:fs';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();

if (!tag) {
  console.error('Usage: node scripts/check-release-tag.js vX.Y.Z');
  process.exit(1);
}

const expected = `v${version}`;
if (tag !== expected) {
  console.error(`Tag ${tag} does not match package.json version ${expected}.`);
  process.exit(1);
}

console.log(`ok ${tag}`);
