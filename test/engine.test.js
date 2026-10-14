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

test('dollar boxes show thousands commas, with cents only when there are cents', () => {
  assert.equal(E.formatMoneyInput(187425.37), '187,425.37');
  assert.equal(E.formatMoneyInput(9876.5), '9,876.50');
  assert.equal(E.formatMoneyInput(300000), '300,000');
  assert.equal(E.formatMoneyInput(1234567.891), '1,234,567.89');
  assert.equal(E.formatMoneyInput(999.995), '1,000');
  assert.equal(E.formatMoneyInput(650.25), '650.25');
  assert.equal(E.formatMoneyInput(0), '');
});

test('dollar boxes read back typed or pasted amounts', () => {
  assert.equal(E.parseMoneyInput('187,425.37'), 187425.37);
  assert.equal(E.parseMoneyInput('$187,425.37'), 187425.37);
  assert.equal(E.parseMoneyInput('187425.37'), 187425.37);
  assert.equal(E.parseMoneyInput(' 1,000 '), 1000);
  assert.ok(Number.isNaN(E.parseMoneyInput('')));
  assert.ok(Number.isNaN(E.parseMoneyInput('abc')));
  for (const v of [187425.37, 42918.64, 9876.5, 1234.56, 300000]) {
    assert.equal(E.parseMoneyInput(E.formatMoneyInput(v)), v, `round trip ${v}`);
  }
});

test('rebase records the day a debt was paid off, and keeps it', () => {
  const asOf = new Date(2026, 0, 15, 0, 0, 0).getTime();
  const state = {
    asOf, assets: [],
    debts: [
      { balance: 1200, apr: 0, payment: 300 },              // last payment lands in month 4
      { balance: 50000, apr: 5, payment: 600 },             // still owed
      { balance: 0, apr: 0, payment: 0 },                   // blank row: never "paid off"
    ],
  };
  const sim = E.simulateDebts(state.debts, { method: 'minimums' });
  const moved = E.rebase(state, sim, E.addMonths(asOf, 6) + 86400000);
  assert.equal(moved.debts[0].balance, 0);
  assert.equal(moved.debts[0].paidOffAt, E.addMonths(asOf, 4));
  assert.equal(moved.debts[1].paidOffAt, undefined);
  assert.equal(moved.debts[2].paidOffAt, undefined);
  // A later rebase keeps the original payoff day
  const sim2 = E.simulateDebts(moved.debts, { method: 'minimums' });
  const again = E.rebase(moved, sim2, E.addMonths(asOf, 9) + 86400000);
  assert.equal(again.debts[0].paidOffAt, E.addMonths(asOf, 4));
});

// ---------- one-time payments, goals, progress ----------
const cards = [
  { balance: 4200, apr: 24.9, payment: 120 },     // high rate
  { balance: 9800, apr: 6.5, payment: 240 },      // low rate
];

test('a one-time payment pays debt off sooner and saves interest', () => {
  const plain = E.simulateDebts(cards, { method: 'avalanche', extra: 100 });
  const withRefund = E.simulateDebts(cards, { method: 'avalanche', extra: 100, lumps: [{ month: 5, amount: 2000 }] });
  assert.ok(withRefund.months < plain.months, `${withRefund.months} < ${plain.months}`);
  assert.ok(withRefund.totalInterest < plain.totalInterest);
  // it lands in month 5, on the highest rate first: month 5 drops by ~2,000 more than the plan without it
  const drop = (sim) => sim.series[0][4] - sim.series[0][5];
  close(drop(withRefund) - drop(plain), 2000, 0.01, 'refund applied to the 24.9% card in month 5');
  assert.equal(withRefund.series[1][5], plain.series[1][5], 'the 6.5% loan is untouched that month');
});

test('one-time payments also work on a minimums plan, highest rate first', () => {
  const sim = E.simulateDebts(cards, { method: 'minimums', lumps: [{ month: 1, amount: 1000 }] });
  const base = E.simulateDebts(cards, { method: 'minimums' });
  close(base.series[0][1] - sim.series[0][1], 1000, 0.01, 'went to the card');
  assert.equal(sim.series[1][1], base.series[1][1]);
});

test('past, finished or malformed one-time payments are ignored', () => {
  const asOf = new Date(2026, 9, 12).getTime();          // Oct 12, 2026
  assert.equal(E.lumpMonth(asOf, '2026-11'), 1);
  assert.equal(E.lumpMonth(asOf, '2027-03'), 5);
  assert.equal(E.lumpMonth(asOf, 'March'), null);
  const live = E.activeLumps(asOf, [
    { id: 'a', ym: '2027-03', amount: 2000 },
    { id: 'b', ym: '2026-10', amount: 500 },              // this month's payment already landed
    { id: 'c', ym: '2027-01', amount: 800, done: true },  // already applied
    { id: 'd', ym: '2027-02', amount: 0 },
  ]);
  assert.deepEqual(live, [{ month: 5, amount: 2000, id: 'a' }]);
});

test('the goal solver finds the smallest extra that hits the date', () => {
  const plan = { method: 'minimums', extra: 0, lumps: [] };
  const base = E.simulateDebts(cards, { method: 'avalanche', extra: 0 });
  const target = base.months - 18;
  const g = E.extraForGoal(cards, plan, target);
  assert.equal(g.ok, true);
  assert.equal(g.method, 'avalanche');
  assert.equal(g.extra % 5, 0);
  assert.ok(E.simulateDebts(cards, { method: 'avalanche', extra: g.extra }).months <= target, 'meets the date');
  assert.ok(E.simulateDebts(cards, { method: 'avalanche', extra: g.extra - 5 }).months > target, 'and $5 less would not');
});

test('the goal solver: already on track, too soon, and one-time payments count', () => {
  const plan = { method: 'avalanche', extra: 300, lumps: [] };
  const now = E.simulateDebts(cards, plan);
  const g = E.extraForGoal(cards, plan, now.months + 6);
  assert.equal(g.already, true);
  assert.equal(E.extraForGoal(cards, plan, 0).reason, 'too-soon');
  const target = now.months - 6;
  const noLump = E.extraForGoal(cards, plan, target);
  const lump = E.extraForGoal(cards, { ...plan, lumps: [{ month: 2, amount: 3000 }] }, target);
  assert.ok(lump.extra < noLump.extra, `${lump.extra} < ${noLump.extra}`);
});

test('progress over the first months: paid off, interest, and interest minimums would charge', () => {
  const plan = E.simulateDebts(cards, { method: 'avalanche', extra: 200 });
  const base = E.simulateDebts(cards, { method: 'minimums' });
  const p = E.progressOver(cards, plan, base, 3);
  const expectPaid = cards.reduce((s, d, i) => s + plan.series[i][0] - plan.series[i][3], 0);
  close(p.paid, expectPaid, 1e-6, 'paid');
  close(p.interest, cards[0].balance * 0.249 / 12 + plan.series[0][1] * 0.249 / 12 + plan.series[0][2] * 0.249 / 12
    + cards[1].balance * 0.065 / 12 + plan.series[1][1] * 0.065 / 12 + plan.series[1][2] * 0.065 / 12, 1e-6, 'interest');
  assert.ok(p.baseInterest > p.interest, 'the plan charges less interest than minimums');
  assert.deepEqual(E.progressOver(cards, plan, base, 0), { paid: 0, interest: 0, baseInterest: 0 });
});

test('a year ago: the plan would have put you further along, and avoids interest daily', () => {
  const plan = E.simulateDebts(cards, { method: 'avalanche', extra: 200 });
  const base = E.simulateDebts(cards, { method: 'minimums' });
  const hs = E.headStart(cards, plan, base, 12);
  close(hs.ahead, base.total[12] - plan.total[12], 0.01, 'extra principal gone after 12 months');
  assert.ok(hs.ahead > 2400, 'at least the $200 x 12 of extra, plus interest avoided');
  assert.ok(hs.interestSaved > 0 && hs.interestSaved < hs.ahead);
  assert.ok(hs.perDay > 0 && hs.perDay < 5, `${hs.perDay} a day is a sane first-month figure`);
  const none = E.headStart(cards, base, base, 12);
  assert.deepEqual(none, { ahead: 0, interestSaved: 0, perDay: 0 });
});
