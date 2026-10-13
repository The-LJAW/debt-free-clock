const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/ics.js');

const now = Date.UTC(2026, 9, 12, 18, 30, 0);
const nov12 = new Date(2026, 10, 12).getTime();
const jul12 = new Date(2030, 6, 12).getTime();

test('a calendar file with a monthly payment series and one-off events', () => {
  const ics = C.makeCalendar([
    { uid: 'pay', date: nov12, day: 12, repeatUntil: jul12, title: 'Debt payment day', description: 'Your plan: $1,150 a month; extra goes to the highest rate first.' },
    { uid: 'free', date: jul12, title: 'Debt-free day!' },
  ], now);
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
  assert.equal(lines[lines.length - 1], '', 'ends with CRLF');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261112'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261113'));
  assert.ok(ics.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=12;UNTIL=20300712'));
  assert.ok(ics.includes('DTSTAMP:20261012T183000Z'));
  assert.ok(ics.includes('UID:free@debt-free-clock'));
  assert.ok(ics.includes('SUMMARY:Debt-free day!'));
  assert.ok(ics.includes('TRIGGER:-PT15H'), 'reminder the day before');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(!/[^\r]\n/.test(ics), 'every line break is CRLF');
});

test('text is escaped and long lines are folded at 75 octets', () => {
  assert.equal(C.esc('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const folded = C.fold(long).split('\r\n');
  assert.ok(folded.every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(folded.slice(1).every((l) => l.startsWith(' ')), true);
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(''), long);
  const accents = C.fold('SUMMARY:' + 'é'.repeat(60)).split('\r\n');
  assert.ok(accents.every((l) => Buffer.byteLength(l) <= 75), 'multi-byte characters never split');
});

test('payment days late in the month fall back to the last day of short months', () => {
  assert.equal(C.monthlyRule(12, jul12), 'FREQ=MONTHLY;BYMONTHDAY=12;UNTIL=20300712');
  assert.equal(C.monthlyRule(31, jul12), 'FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1;UNTIL=20300712');
});
