import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSoulPrompt } from '../src/core/soul.js';

test('loadSoulPrompt loads bundled roleplay-style soul presets', async () => {
  const pirate = await loadSoulPrompt({ soul: { preset: 'pirate' } });
  const caveman = await loadSoulPrompt({ soul: { preset: 'caveman' } });
  const ceo = await loadSoulPrompt({ soul: { preset: 'ceo' } });

  assert.match(pirate, /\[Soul preset: pirate\]/);
  assert.match(pirate, /pirate/i);

  assert.match(caveman, /\[Soul preset: caveman\]/);
  assert.match(caveman, /caveman/i);

  assert.match(ceo, /\[Soul preset: ceo\]/);
  assert.match(ceo, /CEO-style/i);
});
