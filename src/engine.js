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
   * @param opts  {method: 'minimums'|'avalanche'|'snowball', extra: number,
   *                lumps: [{month, amount}] one-time payments landing with month `month`'s
   *                payment (month 1 = the next payment). They follow the plan's payoff order;
   *                under 'minimums' they go to the highest rate first.}
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
    var lumpOrder = planned ? order : payoffOrder(debts, 'avalanche');
    var bonusAt = {};
    (opts.lumps || []).forEach(function (l) {
      var m = Math.round(num(l && l.month)), a = Math.max(0, num(l && l.amount));
      if (m >= 1 && a > 0) bonusAt[m] = (bonusAt[m] || 0) + a;
    });

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
      var bonus = bonusAt[month] || 0;
      if (planned || bonus > 0) {
        var rem = (planned ? budget - spent : 0) + bonus;
        var ord = planned ? order : lumpOrder;
        for (var o = 0; o < ord.length && rem > EPS; o++) {
          var t = ord[o];
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

  // ---------- one-time payments, goals, progress ----------

  /** Month index (1 = next payment) of the payment that lands in calendar month 'YYYY-MM'. */
  function lumpMonth(asOf, ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return null;
    var a = new Date(asOf);
    return (Number(m[1]) * 12 + Number(m[2]) - 1) - (a.getFullYear() * 12 + a.getMonth());
  }

  /** The plan's one-time payments that are still ahead, as {month, amount} for simulateDebts. */
  function activeLumps(asOf, lumps) {
    var out = [];
    (lumps || []).forEach(function (l) {
      if (!l || l.done) return;
      var m = lumpMonth(asOf, l.ym), a = num(l.amount);
      if (m !== null && m >= 1 && a > 0) out.push({ month: m, amount: a, id: l.id });
    });
    return out;
  }

  /**
   * The smallest extra monthly amount (rounded up to $5) that makes the final payment land in
   * month `target` or sooner, keeping the plan's one-time payments. Uses the plan's method, or
   * avalanche when the plan is minimums.
   * @returns {ok:true, extra, method, months, already} | {ok:false, reason:'too-soon'|'never'}
   */
  function extraForGoal(debts, plan, target) {
    var method = plan.method === 'snowball' ? 'snowball' : 'avalanche';
    var lumps = plan.lumps || [];
    if (!(target >= 1)) return { ok: false, reason: 'too-soon' };
    var current = simulateDebts(debts, { method: plan.method, extra: plan.extra, lumps: lumps });
    if (current.months <= target) return { ok: true, already: true, extra: num(plan.extra), method: plan.method, months: current.months };
    var monthsWith = function (x) { return simulateDebts(debts, { method: method, extra: x, lumps: lumps }).months; };
    if (monthsWith(0) <= target) return { ok: true, already: false, extra: 0, method: method, months: monthsWith(0) };
    var lo = 0, hi = 50;
    while (monthsWith(hi) > target) {
      lo = hi; hi *= 2;
      if (hi > 1e8) return { ok: false, reason: 'never' };
    }
    while (hi - lo > 1) {                       // payoff only moves earlier as extra grows
      var mid = Math.floor((lo + hi) / 2);
      if (monthsWith(mid) <= target) hi = mid; else lo = mid;
    }
    var extra = Math.ceil(hi / 5) * 5;
    return { ok: true, already: false, extra: extra, method: method, months: monthsWith(extra) };
  }

  /**
   * What the first k months of a plan did: principal paid off, interest charged, and the
   * interest minimum payments alone would have charged. Used to keep a running total of
   * progress as the clock rolls forward.
   */
  function progressOver(debts, planSim, baseSim, k) {
    var paid = 0, interest = 0, baseInterest = 0;
    for (var i = 0; i < debts.length; i++) {
      var r = Math.max(0, num(debts[i].apr)) / 100 / 12;
      var s = planSim.series[i], b = baseSim.series[i];
      paid += s[0] - s[Math.min(k, s.length - 1)];
      for (var m = 1; m <= k; m++) {
        if (m - 1 < s.length && s[m - 1] > EPS) interest += s[m - 1] * r;
        if (m - 1 < b.length && b[m - 1] > EPS) baseInterest += b[m - 1] * r;
      }
    }
    return { paid: paid, interest: interest, baseInterest: baseInterest };
  }

  /**
   * Had this plan started `k` months ago (from today's balances), how much further along
   * you'd be now versus minimum payments: extra principal gone and interest saved over
   * those months, plus the daily interest the plan avoids today (month 1's difference / 30).
   */
  function headStart(debts, planSim, baseSim, k) {
    var p = progressOver(debts, planSim, baseSim, k);
    var b = progressOver(debts, baseSim, baseSim, k);
    // interest the plan avoids per day right now: after the next payment, the plan's
    // balances carry less interest than the minimums-only balances would
    var perMonth = 0;
    for (var i = 0; i < debts.length; i++) {
      var r = Math.max(0, num(debts[i].apr)) / 100 / 12;
      var ps = planSim.series[i], bs = baseSim.series[i];
      perMonth += (bs[Math.min(1, bs.length - 1)] - ps[Math.min(1, ps.length - 1)]) * r;
    }
    return {
      ahead: Math.max(0, p.paid - b.paid),
      interestSaved: Math.max(0, p.baseInterest - p.interest),
      perDay: Math.max(0, perMonth) / (365.25 / 12)
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
      var b = round2(s[Math.min(k, s.length - 1)]);
      var next = Object.assign({}, d, { balance: b });
      // Remember the day the final payment landed, so a $0 balance reads as "paid off"
      // (and the clock can celebrate) rather than as a debt nobody filled in yet.
      var pm = sim.payoffMonth ? sim.payoffMonth[i] : null;
      if (num(d.balance) > EPS && b <= EPS && pm != null && !d.paidOffAt) next.paidOffAt = addMonths(state.asOf, pm);
      return next;
    });
    var assets = state.assets.map(function (a) {
      return Object.assign({}, a, { value: round2(assetValueAt(a, k)) });
    });
    return Object.assign({}, state, { asOf: addMonths(state.asOf, k), debts: debts, assets: assets });
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  // Dollar input boxes. Show "187,425.37" (cents only when there are cents, so a round
  // "300,000" stays clean) and read back whatever a person types or pastes:
  // "$187,425.37", "187425.37", " 1,000 ". Unreadable text comes back as NaN.
  var fmtMoneyWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var fmtMoneyCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function formatMoneyInput(v) {
    var cents = Math.round((+v || 0) * 100);
    if (!cents) return '';
    return (cents % 100 === 0 ? fmtMoneyWhole : fmtMoneyCents).format(cents / 100);
  }
  function parseMoneyInput(s) {
    var n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  var api = {
    EPS: EPS, MAX_MONTHS: MAX_MONTHS, SEC_PER_YEAR: SEC_PER_YEAR,
    addMonths: addMonths, monthsSince: monthsSince, monthSeconds: monthSeconds,
    calendarDiff: calendarDiff, simulateDebts: simulateDebts, payoffOrder: payoffOrder,
    isGrowing: isGrowing, monthlyInterest: monthlyInterest, assetValueAt: assetValueAt,
    snapshot: snapshot, rebase: rebase,
    formatMoneyInput: formatMoneyInput, parseMoneyInput: parseMoneyInput,
    lumpMonth: lumpMonth, activeLumps: activeLumps, extraForGoal: extraForGoal, progressOver: progressOver, headStart: headStart
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFC = api;
})(this);
