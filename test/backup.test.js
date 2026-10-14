const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/backup.js');

const asOf = new Date(2026, 9, 12).getTime();
const state = {
  v: 1, example: false, asOf,
  debts: [
    { id: 'd1', name: 'Car loan', balance: 18250.5, apr: 6.4, payment: 412.75 },
    { id: 'd2', name: 'Mortgage', balance: 240000, apr: 5.9, payment: 1650, inCountdown: false },
    { id: 'd3', name: 'Old card', balance: 0, apr: 22.9, payment: 60, paidOffAt: asOf - 86400000 * 40 },
  ],
  assets: [{ id: 'a1', name: '401(k)', value: 52000, rate: 6, contribution: 400 }],
  plan: { method: 'avalanche', extra: 250 },
  celebratedFor: asOf - 86400000 * 40,
};

test('a backup round-trips the whole clock, plus the Pro key', () => {
  const file = B.makeBackup(state, { key: 'AAAA1111-BBBB-4CCC-8DDD-EEEEFFFF0000', instanceId: 'x' }, asOf);
  const r = B.readBackup(file);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, state);
  assert.equal(r.savedAt, asOf);
  assert.equal(r.proKey, 'AAAA1111-BBBB-4CCC-8DDD-EEEEFFFF0000');
  assert.equal(r.debts, 3);
  assert.equal(r.assets, 1);
  assert.ok(!file.includes('"instanceId"'), 'device-specific activation id is not saved');
});

test('free users get a backup without a key', () => {
  const r = B.readBackup(B.makeBackup(state, null, asOf));
  assert.equal(r.ok, true);
  assert.equal(r.proKey, null);
});

test('files that are not our backups are refused', () => {
  assert.equal(B.readBackup('not json at all').reason, 'not-json');
  assert.equal(B.readBackup('').reason, 'not-json');
  assert.equal(B.readBackup('{"hello":"world"}').reason, 'not-backup');
  assert.equal(B.readBackup('[1,2,3]').reason, 'not-backup');
  assert.equal(B.readBackup(JSON.stringify({ app: 'debt-free-clock', kind: 'backup', version: 1, state: { debts: [] } })).reason, 'not-backup');
  assert.equal(B.readBackup(JSON.stringify({ app: 'debt-free-clock', kind: 'backup', version: 99, state })).reason, 'newer');
});

test('bad values are cleaned up, never trusted', () => {
  const messy = {
    app: 'debt-free-clock', kind: 'backup', version: 1, savedAt: asOf,
    state: {
      asOf, example: 'yes', plan: { method: 'pay-whatever', extra: 999999 },
      debts: [
        { id: 'd1', name: '  Visa  ', balance: '1200.50', apr: 400, payment: -5, extra: '<script>' },
        { id: 'd1', name: 42, balance: 'abc', apr: null, payment: true, paidOffAt: 'soon' },   // duplicate id
        null, 'junk',
      ],
      assets: [{ id: '../../evil', value: -100, rate: 300, contribution: 50 }],
    },
  };
  const r = B.readBackup(JSON.stringify(messy));
  assert.equal(r.ok, true);
  const [a, b] = r.state.debts;
  assert.equal(r.state.debts.length, 2);
  assert.deepEqual(a, { id: 'd1', name: 'Visa', balance: 1200.5, apr: 100, payment: 0 });
  assert.notEqual(b.id, 'd1');
  assert.deepEqual({ ...b, id: 'x' }, { id: 'x', name: '', balance: 0, apr: 0, payment: 0 });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(r.state.assets[0].id));
  assert.deepEqual({ ...r.state.assets[0], id: 'x' }, { id: 'x', name: '', value: 0, rate: 50, contribution: 50 });
  assert.deepEqual(r.state.plan, { method: 'minimums', extra: 999999 });
  assert.equal(r.state.example, false);
});

test('a paid-off date only sticks to a $0 balance', () => {
  const s = { ...state, debts: [{ id: 'd1', balance: 500, apr: 0, payment: 100, paidOffAt: asOf }] };
  const r = B.readBackup(B.makeBackup(s, null, asOf));
  assert.equal(r.state.debts[0].paidOffAt, undefined);
});

test('backup file names use the local date', () => {
  assert.equal(B.fileName(new Date(2026, 9, 5, 23, 30).getTime()), 'debt-free-clock-backup-2026-10-05.json');
});

test('one-time payments, the goal and progress survive a backup, cleaned', () => {
  const s = {
    ...state,
    debts: [{ ...state.debts[0], cheered: true }, ...state.debts.slice(1)],
    plan: { method: 'avalanche', extra: 250, goal: '2029-06',
      lumps: [{ id: 'l1', ym: '2027-03', amount: 2000, note: 'Tax refund' }, { id: 'l2', ym: '2026-11', amount: 500, note: '', done: true, doneAt: asOf }] },
    progress: { since: asOf - 86400000 * 90, paid: 3210.55, avoided: 412.2, cheers: [25] },
  };
  const r = B.readBackup(B.makeBackup(s, null, asOf));
  assert.deepEqual(r.state, s);
  const messy = JSON.parse(B.makeBackup(s, null, asOf));
  messy.state.plan.goal = 'June';
  messy.state.plan.lumps.push({ id: 'x', ym: '2027-13', amount: 5 }, { id: 'y', ym: '2027-05', amount: -9, note: 7 });
  messy.state.progress = { since: asOf, paid: -5, avoided: 'lots', cheers: [25, 99, '50'] };
  const m = B.readBackup(JSON.stringify(messy));
  assert.equal(m.state.plan.goal, undefined);
  assert.deepEqual(m.state.plan.lumps.map((l) => [l.ym, l.amount, l.note]), [['2027-03', 2000, 'Tax refund'], ['2026-11', 500, ''], ['2027-05', 0, '']]);
  assert.deepEqual(m.state.progress, { since: asOf, paid: 0, avoided: 0, cheers: [25] });
});

test('rate changes and the safety cushion survive a backup', () => {
  const s = { ...state, buffer: 4500, essentials: 2200,
    debts: [{ ...state.debts[0], newApr: 24.99, rateChangeYm: '2027-04' }, ...state.debts.slice(1)] };
  const r = B.readBackup(B.makeBackup(s, null, asOf));
  assert.deepEqual(r.state, s);
  const messy = JSON.parse(B.makeBackup(s, null, asOf));
  messy.state.debts[0].newApr = 'high'; messy.state.buffer = -3;
  const m = B.readBackup(JSON.stringify(messy));
  assert.equal(m.state.debts[0].newApr, undefined);
  assert.equal(m.state.debts[0].rateChangeYm, undefined);
  assert.equal(m.state.buffer, undefined);
});
