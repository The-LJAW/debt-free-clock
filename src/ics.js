/*
 * Debt-Free Clock — calendar files (.ics, RFC 5545).
 *
 * The site has no server, so it can't send reminders itself. Instead it hands people a
 * calendar file: their own calendar app (Apple, Google, Outlook) does the reminding.
 * All-day events, each with a 9 am reminder the day before. Stable UIDs, so importing a
 * newer file can update the old events instead of piling up copies (calendar-dependent).
 * Pure functions, no DOM: runs in Node for tests.
 */
(function (root) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Local calendar date of a timestamp as YYYYMMDD. */
  function ymd(t) {
    var d = new Date(t);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  function nextDay(t) { var d = new Date(t); d.setDate(d.getDate() + 1); return d.getTime(); }

  function utcStamp(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  /** Escape a TEXT value: backslash, semicolon, comma and line breaks. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /** Fold lines longer than 75 octets (UTF-8), continuing with a leading space. */
  function fold(line) {
    var out = [], cur = '', bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var code = line.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) { ch += line[++i]; }
      var b = encodeURIComponent(ch).replace(/%[0-9A-F]{2}/gi, 'x').length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  /**
   * A monthly rule that lands on `day` every month, or on the last day when the month is
   * shorter (the 31st becomes Apr 30 and Feb 28), matching how the clock schedules payments.
   */
  function monthlyRule(day, until) {
    var by = day <= 28 ? 'BYMONTHDAY=' + day : 'BYMONTHDAY=' + day + ',-1;BYSETPOS=1';
    return 'FREQ=MONTHLY;' + by + ';UNTIL=' + ymd(until);
  }

  /**
   * @param events [{uid, date, title, description?, repeatUntil?, day?}]  date = timestamp;
   *        repeatUntil + day make it a monthly series.
   * @param now    timestamp for DTSTAMP
   */
  function makeCalendar(events, now) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Debt-Free Clock//Payment reminders//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Debt-Free Clock'];
    events.forEach(function (e) {
      L.push('BEGIN:VEVENT');
      L.push('UID:' + e.uid + '@debt-free-clock');
      L.push('DTSTAMP:' + utcStamp(now));
      L.push('DTSTART;VALUE=DATE:' + ymd(e.date));
      L.push('DTEND;VALUE=DATE:' + ymd(nextDay(e.date)));
      if (e.repeatUntil) L.push('RRULE:' + monthlyRule(e.day || new Date(e.date).getDate(), e.repeatUntil));
      L.push('SUMMARY:' + esc(e.title));
      if (e.description) L.push('DESCRIPTION:' + esc(e.description));
      L.push('TRANSP:TRANSPARENT');
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:-PT15H', 'END:VALARM');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  var api = { makeCalendar: makeCalendar, monthlyRule: monthlyRule, esc: esc, fold: fold, ymd: ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFCCalendar = api;
})(this);
