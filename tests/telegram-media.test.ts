import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telegramAudio, splitTelegramText } from '../src/server/telegram/media';

test('recognizes microphone notes, audio tracks and audio documents', () => {
  assert.equal(telegramAudio({ voice: { file_id: 'note' } })?.file_name, 'voce.ogg');
  assert.equal(telegramAudio({ audio: { file_id: 'mp3', mime_type: 'audio/mpeg' } })?.file_id, 'mp3');
  assert.equal(telegramAudio({ document: { file_id: 'file', file_name: 'recording.M4A' } })?.file_id, 'file');
  assert.equal(telegramAudio({ document: { file_id: 'file', mime_type: 'audio/wav' } })?.file_id, 'file');
  assert.equal(telegramAudio({ document: { file_id: 'pdf', mime_type: 'application/pdf' } }), undefined);
});

test('splits long replies without losing text or splitting emoji', () => {
  const text = 'a'.repeat(3499) + '🎙' + '<test> & tekst '.repeat(700);
  const chunks = splitTelegramText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(c => c.length <= 3500 && c.isWellFormed()));
  assert.deepEqual(splitTelegramText(''), []);
});
