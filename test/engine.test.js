const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

function standardPayment(P, aprPct, n) {
  const r = aprPct / 100 / 12;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

test('10-year $80k loan at 4.5% pays off in exactly 120 months', () => {
  const pmt = standardPayment(80000, 4.5, 120);           // ≈ 829.10
  close(pmt, 829.10, 0.01, 'textbook payment');
  const sim = E.simulateDebts([{ balance: 80000, apr: 4.5, payment: pmt }], { method: 'minimums' });
  assert.equal(sim.months, 120);
  close(sim.totalInterest, pmt * 120 - 80000, 0.01, 'total interest');
  assert.equal(sim.total[120], 0);
});

test('credit card $6,240 at 24.99% paying $190/mo takes 56 payments', () => {
  // Closed form: n = -ln(1 - rB/P) / ln(1 + r) = 55.9 -> 56th payment is the partial last one
  const sim = E.simulateDebts([{ balance: 6240, apr: 24.99, payment: 190 }], { method: 'minimums' });
  assert.equal(sim.months, 56);
});

test('a payment that does not cover interest never pays off', () => {
  const d = { balance: 10000, apr: 24, payment: 150 };     // interest is $200/mo
  assert.equal(E.isGrowing(d), true);
  const sim = E.simulateDebts([d], { method: 'minimums' });
  assert.equal(sim.months, Infinity);
  assert.equal(sim.payoffMonth[0], null);
  assert.ok(sim.total[sim.total.length - 1] > 10000);
});

test('zero-interest debt pays off in balance / payment months', () => {
  const sim = E.simulateDebts([{ balance: 1000, apr: 0, payment: 100 }], { method: 'minimums' });
  assert.equal(sim.months, 10);
  assert.equal(sim.totalInterest, 0);
});

const example = [
  { name: 'Visa', balance: 6240, apr: 24.99, payment: 190 },
  { name: 'Car loan', balance: 18400, apr: 6.9, payment: 425 },
  { name: 'Student loan', balance: 31500, apr: 5.5, payment: 340 },
];

test('avalanche orders by rate, snowball by balance', () => {
  assert.deepEqual(E.payoffOrder(example, 'avalanche'), [0, 1, 2]);
  assert.deepEqual(E.payoffOrder(example, 'snowball'), [0, 1, 2]);
  const other = [
    { balance: 500, apr: 5, payment: 25 },
    { balance: 9000, apr: 20, payment: 200 },
  ];
  assert.deepEqual(E.payoffOrder(other, 'avalanche'), [1, 0]);
  assert.deepEqual(E.payoffOrder(other, 'snowball'), [0, 1]);
});

test('rolling payments over and adding extra is never slower or costlier', () => {
  const base = E.simulateDebts(example, { method: 'minimums' });
  const roll = E.simulateDebts(example, { method: 'avalanche', extra: 0 });
  const plus = E.simulateDebts(example, { method: 'avalanche', extra: 150 });
  assert.ok(roll.months <= base.months);
  assert.ok(plus.months < roll.months);
  assert.ok(plus.totalInterest < base.totalInterest);
  // Monthly outlay stays constant in plan mode: total paid = principal + interest
  const principal = example.reduce((s, d) => s + d.balance, 0);
  const budget = 190 + 425 + 340 + 150;
  assert.ok(principal + plus.totalInterest <= budget * plus.months + 0.01);
  assert.ok(principal + plus.totalInterest > budget * (plus.months - 1));
});

test('avalanche never pays more interest than snowball when rates differ', () => {
  const debts = [
    { balance: 500, apr: 5, payment: 25 },
    { balance: 9000, apr: 22, payment: 220 },
    { balance: 3000, apr: 12, payment: 90 },
  ];
  const av = E.simulateDebts(debts, { method: 'avalanche', extra: 200 });
  const sb = E.simulateDebts(debts, { method: 'snowball', extra: 200 });
  assert.ok(av.totalInterest <= sb.totalInterest + 1e-6);
});

test('extra money can rescue a debt that would otherwise grow', () => {
  const d = [{ balance: 10000, apr: 24, payment: 150 }];
  const plan = E.simulateDebts(d, { method: 'avalanche', extra: 200 });
  assert.ok(isFinite(plan.months));
});

test('addMonths clamps to month end and monthsSince inverts it', () => {
  const jan31 = new Date(2027, 0, 31, 9, 30).getTime();
  const feb = new Date(E.addMonths(jan31, 1));
  assert.equal(feb.getMonth(), 1);
  assert.equal(feb.getDate(), 28);
  const asOf = new Date(2026, 8, 22, 13, 36, 0).getTime();
  for (const k of [0, 1, 7, 12, 119]) {
    close(E.monthsSince(asOf, E.addMonths(asOf, k)), k, 1e-9, `k=${k}`);
  }
  const mid = (E.addMonths(asOf, 3) + E.addMonths(asOf, 4)) / 2;
  close(E.monthsSince(asOf, mid), 3.5, 1e-9);
});

test('calendarDiff breaks a span into y/m/d h:m:s', () => {
  const from = new Date(2026, 0, 1, 0, 0, 0).getTime();
  const to = new Date(2029, 2, 2, 1, 2, 3).getTime();
  const d = E.calendarDiff(from, to);
  assert.deepEqual(
    [d.years, d.months, d.days, d.hours, d.minutes, d.seconds],
    [3, 2, 1, 1, 2, 3]
  );
  assert.equal(E.calendarDiff(to, from), null);
});

test('asset closed form matches a month-by-month loop', () => {
  const a = { value: 64000, rate: 7, contribution: 500 };
  let v = a.value;
  for (let k = 1; k <= 240; k++) {
    v = v * (1 + 0.07 / 12) + 500;
    close(E.assetValueAt(a, k), v, 1e-6, `k=${k}`);
  }
  close(E.assetValueAt({ value: 100, rate: 0, contribution: 10 }, 5), 150, 1e-9);
});

test('snapshot starts at the entered totals and ends at $0 on the payoff date', () => {
  const asOf = new Date(2026, 8, 22, 13, 36, 0).getTime();
  const state = { asOf, debts: example, assets: [{ value: 64000, rate: 7, contribution: 500 }] };
  const sim = E.simulateDebts(example, { method: 'avalanche', extra: 150 });
  const s0 = E.snapshot(state, sim, asOf);
  close(s0.debtTotal, 56140, 1e-6);
  close(s0.assetTotal, 64000, 1e-6);
  assert.ok(s0.debtPerSec < 0, 'debt shrinks while paying');
  // interest per day ≈ Σ balance × APR / 365
  const perDay = (6240 * 0.2499 + 18400 * 0.069 + 31500 * 0.055) / 365;
  close(s0.interestPerSec * 86400, perDay, 1e-9);
  const end = E.snapshot(state, sim, s0.payoffAt);
  close(end.debtTotal, 0, 1e-9);
  const later = E.snapshot(state, sim, s0.payoffAt + 86400000 * 40);
  assert.equal(later.debtTotal, 0);
  assert.equal(later.debtPerSec, 0);
});

test('rebase keeps the projection continuous', () => {
  const asOf = new Date(2026, 0, 15, 8, 0, 0).getTime();
  const state = {
    asOf, debts: example,
    assets: [{ value: 12000, rate: 4, contribution: 150 }],
  };
  for (const method of ['minimums', 'avalanche']) {
    const opts = { method, extra: method === 'minimums' ? 0 : 150 };
    const sim = E.simulateDebts(state.debts, opts);
    const now = E.addMonths(asOf, 5) + 3 * 86400000;           // 5 months and 3 days later
    const before = E.snapshot(state, sim, now);
    const moved = E.rebase(state, sim, now);
    assert.equal(moved.asOf, E.addMonths(asOf, 5));
    const sim2 = E.simulateDebts(moved.debts, opts);
    const after = E.snapshot(moved, sim2, now);
    close(after.debtTotal, before.debtTotal, 0.05, `${method} debt`);
    close(after.assetTotal, before.assetTotal, 0.05, `${method} assets`);
    assert.equal(after.payoffAt, before.payoffAt, `${method} payoff date unchanged`);
  }
  // Less than a month: untouched
  const sim = E.simulateDebts(state.debts, { method: 'minimums' });
  assert.equal(E.rebase(state, sim, asOf + 86400000), state);
});
