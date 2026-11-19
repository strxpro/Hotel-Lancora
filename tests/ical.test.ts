import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, safeCalendarUrl, sourceOfUrl } from '../src/server/channels/ical';

// shaped like a Booking.com export (folded line, DATE values, CRLF)
const BOOKING = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//admin.booking.com//EN',
  'BEGIN:VEVENT',
  'UID:4a3f1c2e@booking.com',
  'DTSTART;VALUE=DATE:20270312',
  'DTEND;VALUE=DATE:20270315',
  'SUMMARY:CLOSED - Not available',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:77b@booking.com',
  'DTSTART:20270401T140000Z',
  'DTEND:20270403T100000Z',
  'SUMMARY:Reserved - long text that is fol',
  ' ded on the next line',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:no-end',
  'DTSTART;VALUE=DATE:20270501',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('reads stays from a portal calendar', () => {
  const ev = parseIcs(BOOKING);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0], { uid: '4a3f1c2e@booking.com', from: '2027-03-12', to: '2027-03-15', summary: 'CLOSED - Not available' });
  assert.deepEqual([ev[1]!.from, ev[1]!.to], ['2027-04-01', '2027-04-03']);
  assert.equal(ev[1]!.summary, 'Reserved - long text that is folded on the next line');
  assert.deepEqual([ev[2]!.from, ev[2]!.to], ['2027-05-01', '2027-05-02']); // missing end = one night
});

test('only public https links are accepted, and the portal is recognised', () => {
  assert.equal(safeCalendarUrl('http://admin.booking.com/x.ics'), null);
  assert.equal(safeCalendarUrl('https://localhost/x'), null);
  assert.equal(safeCalendarUrl('https://192.168.1.10/x'), null);
  assert.ok(safeCalendarUrl('https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc'));
  assert.equal(sourceOfUrl('https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc'), 'booking');
  assert.equal(sourceOfUrl('https://www.airbnb.it/calendar/ical/123.ics?s=x'), 'airbnb');
  assert.equal(sourceOfUrl('https://www.expediapartnercentral.com/ical/1'), 'expedia');
  assert.equal(sourceOfUrl('https://example.com/cal.ics'), 'altro');
});
