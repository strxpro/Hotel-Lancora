import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseRules, ruleLines } from '../src/lib/house-rules';
import { textWithoutNumber, titleWithoutNumber } from '../src/lib/room-number';
import type { Settings } from '../src/lib/types';

const settings = (rules?: Settings['hotel']['rules'], animali: 'confermato' | 'non_disponibile' | 'da_confermare' = 'da_confermare') =>
  ({ hotel: { rules } as Settings['hotel'], services: [{ key: 'animali', label: 'Animali ammessi', status: animali, note: '' }] }) as Pick<Settings, 'hotel' | 'services'>;

test('house rules: pets not allowed unless the hotel says so, the owner choice wins', () => {
  assert.equal(houseRules(settings()).pets, 'no');
  assert.equal(houseRules(settings(undefined, 'confermato')).pets, 'yes');
  const own = houseRules(settings({ pets: 'request', smoking: 'no', parties: 'no', children: 'yes', quietFrom: '23:00', note: 'Niente ascensore' }));
  const it = ruleLines(own, 'it').map((l) => l.text);
  assert.deepEqual(it, ['Animali ammessi su richiesta', 'Vietato fumare in tutta la struttura', 'Feste ed eventi non ammessi', 'Bambini benvenuti', 'Silenzio dalle 23:00', 'Niente ascensore']);
  const pl = ruleLines(houseRules(settings()), 'pl');
  assert.equal(pl[0]!.text, 'Zwierzęta niedozwolone');
  assert.equal(pl[0]!.ok, false);
});

test('room numbers stay out of what guests read', () => {
  assert.equal(titleWithoutNumber('Camera 102 – Matrimoniale al piano terra', '102'), 'Matrimoniale al piano terra');
  assert.equal(titleWithoutNumber('Matrimoniale vista mare (102)', '102'), 'Matrimoniale vista mare');
  assert.equal(titleWithoutNumber('Room 106 - Double', '106'), 'Double');
  assert.equal(titleWithoutNumber('Suite 1 piano', '1'), 'Suite 1 piano');
  assert.equal(titleWithoutNumber('Camera 102', '102'), '');
  assert.equal(textWithoutNumber('La Camera 102 è una matrimoniale. Nella camera 102 trovi il Wi-Fi.', '102', 'it'), 'Questa camera è una matrimoniale. Nella camera trovi il Wi-Fi.');
  assert.equal(textWithoutNumber('Room 102 is a double room.', '102', 'en'), 'This room is a double room.');
  // other numbers are left alone
  assert.equal(textWithoutNumber('A 300 metri dalla spiaggia, camera 1020 a parte.', '102', 'it'), 'A 300 metri dalla spiaggia, camera 1020 a parte.');
});
