import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDay, parsePeriod, parseRange } from '../src/server/assistant/dates-it';

const TODAY = '2026-11-07'; // Saturday

test('“Chiudi la camera 105 dal 12 al 15 novembre” → nights 12–14, free on 15', () => {
  assert.deepEqual(parseRange('Chiudi la camera 105 dal 12 al 15 novembre', TODAY), { from: '2026-11-12', to: '2026-11-15' });
});

test('ranges across months and numeric dates', () => {
  assert.deepEqual(parseRange('blocca la 104 dal 28 dicembre al 3 gennaio', TODAY), { from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(parseRange('dal 20/11 al 22/11', TODAY), { from: '2026-11-20', to: '2026-11-22' });
  assert.deepEqual(parseRange('12-15 novembre', TODAY), { from: '2026-11-12', to: '2026-11-15' });
});

test('single days', () => {
  assert.equal(parseDay('Quali camere sono libere domani?', TODAY), '2026-11-08');
  assert.equal(parseDay('chi arriva oggi', TODAY), TODAY);
  assert.equal(parseDay('chi arriva lunedì', TODAY), '2026-11-09');
  assert.equal(parseDay('il 2 febbraio', TODAY), '2027-02-02');
});

test('reporting periods', () => {
  assert.deepEqual(parsePeriod('Quanto abbiamo guadagnato il mese scorso?', TODAY), { from: '2026-10-01', to: '2026-11-01', label: 'il mese scorso' });
  assert.deepEqual(parsePeriod('incassi di questa settimana', TODAY), { from: '2026-11-02', to: '2026-11-09', label: 'questa settimana' });
  assert.equal(parsePeriod('Mostrami le prenotazioni di dicembre', TODAY, 'future')?.from, '2026-12-01');
  assert.equal(parsePeriod('incassi di ottobre', TODAY, 'past')?.from, '2026-10-01');
});
