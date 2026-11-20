import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPanelSection, newBySection, sectionOf } from '../src/lib/admin-sections';
import { asksForRoom, guestsIn } from '../src/server/chat/room-cards';

test('panel: each notification lights up its menu item', () => {
  assert.equal(sectionOf({ type: 'nuova_prenotazione', href: '/admin/prenotazioni?b=b-1' }), '/admin/prenotazioni');
  assert.equal(sectionOf({ type: 'nuovo_pagamento', href: null }), '/admin/pagamenti');
  assert.equal(sectionOf({ type: 'errore_sincronizzazione', href: '/admin/automazioni#booking' }), '/admin/automazioni');
  assert.equal(sectionOf({ type: 'nuovo_arrivo', href: null }), '/admin');
  assert.equal(sectionOf({ type: 'camera_da_controllare', href: '/admin/camere/r-1' }), '/admin/camere', 'a page inside a section');
  // the link wins over the kind
  assert.equal(sectionOf({ type: 'messaggio_ospite', href: '/admin/prenotazioni?b=x' }), '/admin/prenotazioni');
  const n = (type: 'nuova_prenotazione' | 'nuovo_pagamento', read = false) => ({ type, href: null, read });
  assert.deepEqual(newBySection([n('nuova_prenotazione'), n('nuova_prenotazione'), n('nuovo_pagamento', true), n('nuovo_pagamento')]), { '/admin/prenotazioni': 2, '/admin/pagamenti': 1 });
  assert.ok(isPanelSection('/admin') && isPanelSection('/admin/prezzi') && !isPanelSection('/admin/x') && !isPanelSection('/'));
});

test('chat: "which room do you suggest?" in every language, and for how many people', () => {
  for (const q of ['Mi consigli una camera?', 'Quale camera mi proponi per 2?', 'Which room would you recommend?', 'Polecisz mi jakiś pokój?', 'Jaki pokój dla 3 osób?', 'Welches Zimmer empfehlen Sie?', 'Quelle chambre me recommandez-vous ?', '¿Qué habitación me recomiendas?']) assert.ok(asksForRoom(q), q);
  for (const q of ['A che ora è il check-in?', 'Is there parking?', 'Gdzie jest plaża?']) assert.ok(!asksForRoom(q), q);
  assert.equal(guestsIn('una camera per 3 persone'), 3);
  assert.equal(guestsIn('pokój dla 2 osób'), 2);
  assert.equal(guestsIn('room for 4 people please'), 4);
  assert.equal(guestsIn('una camera tranquilla'), 1);
});
