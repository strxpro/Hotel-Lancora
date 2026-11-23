import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLang, isBot, visitorLang } from '../src/lib/visitor-lang';

test('the first visit gets the visitor’s language: browser first, then the country', () => {
  // a phone in English in Poland: Polish
  assert.equal(visitorLang('en-US,en;q=0.9', 'PL'), 'pl');
  // a browser in Polish anywhere: Polish
  assert.equal(visitorLang('pl-PL,pl;q=0.9,en;q=0.8', 'IT'), 'pl');
  // German tourist in Italy with a German phone: German
  assert.equal(visitorLang('de-DE,de;q=0.9', 'IT'), 'de');
  // Italian browser in Switzerland: Italian
  assert.equal(visitorLang('it-CH,it;q=0.9,de;q=0.6', 'CH'), 'it');
  // English browser in Italy: English; Italian browser in Italy: Italian
  assert.equal(visitorLang('en-GB,en', 'IT'), 'en');
  assert.equal(visitorLang('it-IT,it;q=0.9,en;q=0.8', 'IT'), 'it');
  // a language the site does not have, from a country without one: English
  assert.equal(visitorLang('nl-NL,nl;q=0.9', 'NL'), 'en');
  // nothing known (no headers): Italian, the site's own language
  assert.equal(visitorLang(null, null), 'it');
  // Spanish-speaking countries, Austrians, Belgians
  assert.equal(visitorLang('', 'MX'), 'es');
  assert.equal(visitorLang('', 'AT'), 'de');
  assert.equal(visitorLang('en', 'BE'), 'fr');
  // the browser's order and weights count
  assert.equal(browserLang('ru;q=0.9,fr;q=0.8,de;q=0.5'), 'fr');
  assert.equal(browserLang('de;q=0.2,pl'), 'pl');
  assert.equal(browserLang('ru-RU'), null);
});

test('search engines and link previews are left on the address they asked for', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBot('WhatsApp/2.23.20.0'), true);
  assert.equal(isBot('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'), false);
});
