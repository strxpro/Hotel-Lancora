import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMarkdown } from '../src/lib/plain-text';

test('answers never show raw markdown: no asterisks, hashes or backticks, one thing per line', () => {
  const ai = '### Prezzi\nPer cambiare i **prezzi** apri *Prezzi*:\n* tocca la camera\n- scrivi il prezzo\n`Salva` e fatto. Guida: [qui](https://example.com/guida)';
  assert.equal(cleanMarkdown(ai), 'Prezzi\nPer cambiare i prezzi apri Prezzi:\n• tocca la camera\n• scrivi il prezzo\nSalva e fatto. Guida: qui: https://example.com/guida');
  // what is not markdown stays as it is
  assert.equal(cleanMarkdown('🛎 Arrivi di oggi: 2\n• Rossi · cam. 101 · 2 × 3 notti'), '🛎 Arrivi di oggi: 2\n• Rossi · cam. 101 · 2 × 3 notti');
  assert.equal(cleanMarkdown('Sconto 5% * 2 notti'), 'Sconto 5% * 2 notti');
});
