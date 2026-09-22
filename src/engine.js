/*
 * Debt-Free Clock — calculation engine.
 *
 * Model
 * - Every debt and asset is anchored to one shared date, `asOf`. Payments,
 *   contributions and monthly compounding happen on the same day of each
 *   month as `asOf` (clamped to month end, e.g. Jan 31 -> Feb 28).
 * - Debts: interest accrues monthly at APR / 12, then the payment is applied.
 *   This matches how most payoff calculators and lender schedules work.
 * - Live values between two payment dates are interpolated linearly, so the
 *   on-screen balance slides smoothly from one month's post-payment balance
 *   to the next and reaches exactly $0 on the final payment date.
 * - Plans: "minimums" pays each debt its own payment only. "avalanche" and
 *   "snowball" keep the total monthly outlay constant (all payments + extra);
 *   whatever isn't needed for minimums goes to the target debt, so a paid-off
 *   debt's payment rolls into the next one.
 */
(function (root) {
  'use strict';

  var EPS = 0.005;              // half a cent: below this a balance counts as paid
  var MAX_MONTHS = 600;         // 50 years; beyond that we call it "never"
  var SEC_PER_YEAR = 365 * 86400;

  // ---------- calendar helpers ----------

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  /** Add whole months to a timestamp (ms), keeping time of day, clamping the day. */
  function addMonths(ms, n) {
    var d = new Date(ms);
    var y = d.getFullYear();
    var m = d.getMonth() + n;
    var ty = y + Math.floor(m / 12);
    var tm = ((m % 12) + 12) % 12;
    var day = Math.min(d.getDate(), daysInMonth(ty, tm));
    return new Date(ty, tm, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
  }

  /** Fractional months elapsed from asOf to t (0 if t is before asOf). */
  function monthsSince(asOf, t) {
    if (t <= asOf) return 0;
    var k = Math.floor((t - asOf) / (30.436875 * 86400000));
    if (k < 0) k = 0;
    while (addMonths(asOf, k + 1) <= t) k++;
    while (k > 0 && addMonths(asOf, k) > t) k--;
    var a = addMonths(asOf, k);
    var b = addMonths(asOf, k + 1);
    return k + (t - a) / (b - a);
  }

  /** Length in seconds of month k (from asOf+k to asOf+k+1). */
  function monthSeconds(asOf, k) {
    return (addMonths(asOf, k + 1) - addMonths(asOf, k)) / 1000;
  }

  /**
   * Calendar difference from -> to as {years, months, days, hours, minutes, seconds}.
   * Returns null if `to` is not after `from`.
   */
  function calendarDiff(from, to) {
    if (!(to > from)) return null;
    var a = new Date(from), b = new Date(to);
    var months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    while (months > 0 && addMonths(from, months) > to) months--;
    while (addMonths(from, months + 1) <= to) months++;
    var rest = Math.floor((to - addMonths(from, months)) / 1000);
    var days = Math.floor(rest / 86400); rest -= days * 86400;
    var hours = Math.floor(rest / 3600); rest -= hours * 3600;
    var minutes = Math.floor(rest / 60);
    var seconds = rest - minutes * 60;
    return {
      years: Math.floor(months / 12),
      months: months % 12,
      days: days, hours: hours, minutes: minutes, seconds: seconds,
      totalMonths: months
    };
  }

  // ---------- debts ----------

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function payoffOrder(debts, method) {
    var idx = debts.map(function (_, i) { return i; });
    if (method === 'avalanche') {
      idx.sort(function (a, b) {
        return (num(debts[b].apr) - num(debts[a].apr)) || (num(debts[a].balance) - num(debts[b].balance)) || (a - b);
      });
    } else if (method === 'snowball') {
      idx.sort(function (a, b) {
        return (num(debts[a].balance) - num(debts[b].balance)) || (num(debts[b].apr) - num(debts[a].apr)) || (a - b);
      });
    }
    return idx;
  }

  /**
   * Simulate month by month.
   * @param debts [{balance, apr (percent), payment}]
   * @param opts  {method: 'minimums'|'avalanche'|'snowball', extra: number}
   * @returns {
   *   months: number|Infinity   month index of the final payment (Infinity if not within 50 yrs),
   *   series: number[][]        per-debt post-payment balance at month 0..lastMonth,
   *   total:  number[]          total balance at month 0..lastMonth,
   *   interest: number[]        per-debt interest paid over the simulation,
   *   totalInterest: number,
   *   payoffMonth: (number|null)[] per-debt month of final payment (null = never),
   *   order: number[]           payoff priority used (indices)
   * }
   */
  function simulateDebts(debts, opts) {
    opts = opts || {};
    var method = opts.method === 'avalanche' || opts.method === 'snowball' ? opts.method : 'minimums';
    var planned = method !== 'minimums';
    var n = debts.length;
    var bal = [], r = [], pay = [];
    for (var i = 0; i < n; i++) {
      bal.push(Math.max(0, num(debts[i].balance)));
      r.push(Math.max(0, num(debts[i].apr)) / 100 / 12);
      pay.push(Math.max(0, num(debts[i].payment)));
    }
    var extra = planned ? Math.max(0, num(opts.extra)) : 0;
    var budget = pay.reduce(function (s, p) { return s + p; }, 0) + extra;
    var order = payoffOrder(debts, method);

    var series = bal.map(function (b) { return [b]; });
    var total = [sum(bal)];
    var interest = bal.map(function () { return 0; });
    var payoffMonth = bal.map(function (b) { return b <= EPS ? 0 : null; });

    var month = 0;
    while (month < MAX_MONTHS && anyOpen(bal)) {
      month++;
      var spent = 0, j;
      for (j = 0; j < n; j++) {
        if (bal[j] > EPS) {
          var it = bal[j] * r[j];
          bal[j] += it;
          interest[j] += it;
        }
      }
      for (j = 0; j < n; j++) {
        if (bal[j] > EPS) {
          var p = Math.min(bal[j], pay[j]);
          bal[j] -= p;
          spent += p;
        }
      }
      if (planned) {
        var rem = budget - spent;
        for (var o = 0; o < order.length && rem > EPS; o++) {
          var t = order[o];
          if (bal[t] > EPS) {
            var q = Math.min(bal[t], rem);
            bal[t] -= q;
            rem -= q;
          }
        }
      }
      for (j = 0; j < n; j++) {
        if (bal[j] <= EPS) {
          bal[j] = 0;
          if (payoffMonth[j] === null) payoffMonth[j] = month;
        }
        series[j].push(bal[j]);
      }
      total.push(sum(bal));
    }

    var done = !anyOpen(bal);
    return {
      months: done ? month : Infinity,
      lastMonth: month,
      series: series,
      total: total,
      interest: interest,
      totalInterest: sum(interest),
      payoffMonth: payoffMonth,
      order: order,
      method: method,
      extra: extra
    };
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function anyOpen(a) { for (var i = 0; i < a.length; i++) if (a[i] > EPS) return true; return false; }

  /** True when a debt's payment doesn't cover its first month of interest. */
  function isGrowing(debt) {
    var b = Math.max(0, num(debt.balance));
    if (b <= EPS) return false;
    return num(debt.payment) <= b * Math.max(0, num(debt.apr)) / 100 / 12 + 1e-9;
  }

  function monthlyInterest(debt) {
    return Math.max(0, num(debt.balance)) * Math.max(0, num(debt.apr)) / 100 / 12;
  }

  // ---------- assets ----------

  /** Asset value after k whole months: monthly growth then end-of-month contribution. */
  function assetValueAt(asset, k) {
    var v0 = num(asset.value);
    var c = num(asset.contribution);
    var g = num(asset.rate) / 100 / 12;
    if (Math.abs(g) < 1e-12) return v0 + c * k;
    var G = Math.pow(1 + g, k);
    return v0 * G + c * (G - 1) / g;
  }

  // ---------- live snapshot ----------

  function valueAt(series, k, f) {
    var last = series.length - 1;
    if (k >= last) return series[last];
    return series[k] + (series[k + 1] - series[k]) * f;
  }

  /**
   * Everything the clock needs at time `now`.
   * @param state {asOf, debts, assets}
   * @param sim   result of simulateDebts for the active plan
   */
  function snapshot(state, sim, now) {
    var m = monthsSince(state.asOf, now);
    var k = Math.floor(m), f = m - k;
    var secs = monthSeconds(state.asOf, k);

    var debtTotal = 0, debtSlope = 0, interestPerSec = 0;
    var perDebt = [];
    for (var i = 0; i < state.debts.length; i++) {
      var s = sim.series[i];
      var b = valueAt(s, k, f);
      var last = s.length - 1;
      var slope = k >= last ? 0 : (s[k + 1] - s[k]) / secs;
      perDebt.push(b);
      debtTotal += b;
      debtSlope += slope;
      interestPerSec += b * Math.max(0, num(state.debts[i].apr)) / 100 / SEC_PER_YEAR;
    }

    var assetTotal = 0, assetSlope = 0, growthPerSec = 0;
    for (var a = 0; a < state.assets.length; a++) {
      var v0 = assetValueAt(state.assets[a], k);
      var v1 = assetValueAt(state.assets[a], k + 1);
      var v = v0 + (v1 - v0) * f;
      assetTotal += v;
      assetSlope += (v1 - v0) / secs;
      growthPerSec += v * num(state.assets[a].rate) / 100 / SEC_PER_YEAR;
    }

    var midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    var secToday = (now - midnight.getTime()) / 1000;

    return {
      monthIndex: m,
      debtTotal: debtTotal,
      debtPerSec: debtSlope,               // negative while paying down
      perDebt: perDebt,
      interestPerSec: interestPerSec,
      interestToday: interestPerSec * secToday,
      assetTotal: assetTotal,
      assetPerSec: assetSlope,
      growthPerSec: growthPerSec,
      netWorth: assetTotal - debtTotal,
      netPerSec: assetSlope - debtSlope,
      payoffAt: isFinite(sim.months) ? addMonths(state.asOf, sim.months) : null
    };
  }

  /**
   * Move the anchor to the most recent monthly payment date on or before `now`,
   * replacing balances/values with their projected amounts on that date.
   * Keeps the payment day fixed, so nothing drifts. Returns a new state, or the
   * same object if less than a month has passed.
   */
  function rebase(state, sim, now) {
    var k = Math.floor(monthsSince(state.asOf, now));
    if (k < 1) return state;
    var debts = state.debts.map(function (d, i) {
      var s = sim.series[i];
      var b = s[Math.min(k, s.length - 1)];
      return Object.assign({}, d, { balance: round2(b) });
    });
    var assets = state.assets.map(function (a) {
      return Object.assign({}, a, { value: round2(assetValueAt(a, k)) });
    });
    return Object.assign({}, state, { asOf: addMonths(state.asOf, k), debts: debts, assets: assets });
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  var api = {
    EPS: EPS, MAX_MONTHS: MAX_MONTHS, SEC_PER_YEAR: SEC_PER_YEAR,
    addMonths: addMonths, monthsSince: monthsSince, monthSeconds: monthSeconds,
    calendarDiff: calendarDiff, simulateDebts: simulateDebts, payoffOrder: payoffOrder,
    isGrowing: isGrowing, monthlyInterest: monthlyInterest, assetValueAt: assetValueAt,
    snapshot: snapshot, rebase: rebase
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFC = api;
})(this);
