(function () {
  'use strict';

  var E = window.DFC;
  var KEY = 'debt-free-clock:v1';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- formatting ----------
  var fmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var fmtCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  var dMonthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
  var dLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  var dShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function span(months) {
    var y = Math.floor(months / 12), m = months % 12, out = [];
    if (y) out.push(y + ' ' + plural(y, 'year', 'years'));
    if (m) out.push(m + ' ' + plural(m, 'month', 'months'));
    return out.join(' ') || '0 months';
  }
  function money6(v) {
    var neg = v < 0;
    var s = Math.abs(v).toFixed(6);
    var dot = s.indexOf('.');
    return {
      main: (neg ? '−' : '') + '$' + fmtInt.format(Number(s.slice(0, dot))) + '.' + s.slice(dot + 1, dot + 3),
      sub: s.slice(dot + 3)
    };
  }

  // ---------- state ----------
  function uid(p) { return p + Math.random().toString(36).slice(2, 9); }

  /** New clocks anchor to the start of today, so "payments on the 22nd" means the whole day. */
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function exampleState(now) {
    return {
      v: 1, example: true, asOf: now,
      debts: [
        { id: 'd1', name: 'Visa card', balance: 6240, apr: 24.99, payment: 190 },
        { id: 'd2', name: 'Personal loan', balance: 2300, apr: 11.5, payment: 110 },
        { id: 'd3', name: 'Car loan', balance: 18400, apr: 6.9, payment: 425 },
        { id: 'd4', name: 'Student loan', balance: 31500, apr: 5.5, payment: 340 },
        { id: 'd5', name: 'Mortgage', balance: 248000, apr: 6.25, payment: 1650, inCountdown: false }
      ],
      assets: [
        { id: 'a1', name: '401(k)', value: 64000, rate: 7, contribution: 500 },
        { id: 'a2', name: 'High-yield savings', value: 12000, rate: 4, contribution: 150 },
        { id: 'a3', name: 'Home value', value: 320000, rate: 3, contribution: 0 }
      ],
      plan: { method: 'avalanche', extra: 150 }
    };
  }

  function blankState(now) {
    return {
      v: 1, example: false, asOf: now,
      debts: [{ id: uid('d'), name: '', balance: 0, apr: 0, payment: 0 }],
      assets: [],
      plan: { method: 'minimums', extra: 0 }
    };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1 && Array.isArray(s.debts) && Array.isArray(s.assets) && isFinite(s.asOf)) {
          s.plan = s.plan && typeof s.plan === 'object' ? s.plan : { method: 'minimums', extra: 0 };
          return s;
        }
      }
    } catch (e) { /* storage blocked or corrupt: fall through to example */ }
    return exampleState(startOfToday());
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }

  var state = load();
  // incBase / incPlan: debts counted in the countdown (minimums vs. chosen plan).
  // plan: every debt's schedule merged back into list order, for the live tickers,
  //       rebasing and per-debt chips. Uncounted debts (e.g. a mortgage) just pay
  //       their own payment and never receive extra money.
  var base, plan, incBase, incPlan;

  function counted(d) { return d.inCountdown !== false; }

  function recompute() {
    var inc = [], exc = [], incIdx = [], excIdx = [];
    state.debts.forEach(function (d, i) {
      if (counted(d)) { inc.push(d); incIdx.push(i); } else { exc.push(d); excIdx.push(i); }
    });
    incBase = E.simulateDebts(inc, { method: 'minimums' });
    incPlan = state.plan.method === 'minimums' ? incBase : E.simulateDebts(inc, state.plan);
    var excSim = E.simulateDebts(exc, { method: 'minimums' });
    var n = state.debts.length, series = new Array(n), payoffMonth = new Array(n), interest = new Array(n);
    incIdx.forEach(function (i, k) { series[i] = incPlan.series[k]; payoffMonth[i] = incPlan.payoffMonth[k]; interest[i] = incPlan.interest[k]; });
    excIdx.forEach(function (i, k) { series[i] = excSim.series[k]; payoffMonth[i] = excSim.payoffMonth[k]; interest[i] = excSim.interest[k]; });
    base = incBase;
    plan = { months: incPlan.months, series: series, payoffMonth: payoffMonth, interest: interest, totalInterest: incPlan.totalInterest };
  }

  function hasCounted() {
    for (var i = 0; i < state.debts.length; i++) {
      if (counted(state.debts[i]) && (+state.debts[i].balance || 0) > E.EPS) return true;
    }
    return false;
  }
  function uncountedNames() {
    return state.debts.filter(function (d) { return !counted(d) && (+d.balance || 0) > E.EPS; })
      .map(function (d) { return d.name || 'unnamed debt'; });
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Apply a change: rebase to the latest payment date, mutate, recompute, save, repaint. */
  function update(mutate, opts) {
    opts = opts || {};
    var moved = E.rebase(state, plan, Date.now());
    var didMove = moved !== state;
    state = moved;
    if (mutate) mutate(state);
    if (opts.userEdit) state.example = false;
    recompute();
    save();
    if (didMove || opts.lists) renderLists();
    renderDerived();
  }

  function hasDebt() {
    for (var i = 0; i < state.debts.length; i++) if ((+state.debts[i].balance || 0) > E.EPS) return true;
    return false;
  }

  // ---------- DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }
  var ICON = {
    x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.7H1.4z" fill="currentColor"/><path d="M8 6v3.6" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="var(--surface)"/></svg>',
    stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="currentColor"/><path d="M5.2 5.2l5.6 5.6" stroke="var(--surface)" stroke-width="1.7" stroke-linecap="round"/></svg>',
    flag: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14V2.5M3.5 3h8l-1.6 2.7L11.5 8.4h-8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>'
  };
  function chip(kind, icon, text) {
    var c = h('span', { class: 'chip' + (kind ? ' ' + kind : '') });
    if (icon) c.innerHTML = ICON[icon];
    c.appendChild(document.createTextNode(text));
    return c;
  }

  // ---------- item rows ----------
  function numField(kind, item, key, label, pre, post, extra) {
    var inputId = kind + '-' + item.id + '-' + key;
    var wrap = h('div', { class: 'field' });
    wrap.appendChild(h('label', { for: inputId }, label));
    var box = h('div', { class: 'input-wrap' });
    if (pre) box.appendChild(h('span', { class: 'adorn', 'aria-hidden': 'true' }, pre));
    var inp = h('input', Object.assign({ id: inputId, type: 'number', inputmode: 'decimal', step: 'any', min: '0' }, extra || {}));
    var v = +item[key] || 0;
    inp.value = v ? String(Math.round(v * 100) / 100) : '';
    inp.placeholder = '0';
    inp.addEventListener('change', function () {
      var n = parseFloat(inp.value);
      if (!isFinite(n)) n = 0;
      if (extra && extra.min != null) n = Math.max(+extra.min, n); else n = Math.max(0, n);
      update(function (s) {
        var target = find(kind === 'debt' ? s.debts : s.assets, item.id);
        if (target) target[key] = n;
      }, { userEdit: true });
    });
    box.appendChild(inp);
    if (post) box.appendChild(h('span', { class: 'adorn', 'aria-hidden': 'true' }, post));
    wrap.appendChild(box);
    return wrap;
  }

  function itemRow(kind, item) {
    var row = h('div', { class: 'item', 'data-id': item.id });
    var top = h('div', { class: 'item-top' });
    var name = h('input', {
      class: 'name-input', id: kind + '-' + item.id + '-name', type: 'text', maxlength: '40',
      'aria-label': kind === 'debt' ? 'Debt name' : 'Asset name',
      placeholder: kind === 'debt' ? 'Name this debt, e.g. Visa card' : 'Name this asset, e.g. 401(k)'
    });
    name.value = item.name || '';
    name.addEventListener('change', function () {
      update(function (s) {
        var t = find(kind === 'debt' ? s.debts : s.assets, item.id);
        if (t) t.name = name.value.trim();
      }, { userEdit: true });
    });
    var rm = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + (item.name || (kind === 'debt' ? 'this debt' : 'this asset')) });
    rm.innerHTML = ICON.x;
    rm.addEventListener('click', function () { removeItem(kind === 'debt' ? 'debts' : 'assets', item.id); });
    top.appendChild(name);
    top.appendChild(rm);
    row.appendChild(top);

    var fields = h('div', { class: 'fields' });
    if (kind === 'debt') {
      fields.appendChild(numField('debt', item, 'balance', 'Balance', '$', null));
      fields.appendChild(numField('debt', item, 'apr', 'Interest rate (APR)', null, '%', { max: '100' }));
      fields.appendChild(numField('debt', item, 'payment', 'Monthly payment', '$', null));
    } else {
      fields.appendChild(numField('asset', item, 'value', 'Value', '$', null));
      fields.appendChild(numField('asset', item, 'rate', 'Growth per year', null, '%', { min: '-50', max: '50' }));
      fields.appendChild(numField('asset', item, 'contribution', 'Added monthly', '$', null));
    }
    row.appendChild(fields);
    if (kind === 'debt') {
      var tog = h('label', { class: 'count-toggle' });
      var cb = h('input', { type: 'checkbox', id: 'debt-' + item.id + '-count' });
      cb.checked = counted(item);
      cb.addEventListener('change', function () {
        update(function (s) { var t = find(s.debts, item.id); if (t) t.inCountdown = cb.checked; }, { userEdit: true });
      });
      tog.appendChild(cb);
      tog.appendChild(document.createTextNode('Count in debt-free countdown'));
      row.appendChild(tog);
    }
    row.appendChild(h('div', { class: 'chips', id: kind + '-' + item.id + '-chips' }));
    return row;
  }

  function renderLists() {
    var dl = $('debt-list'); dl.textContent = '';
    state.debts.forEach(function (d) { dl.appendChild(itemRow('debt', d)); });
    var al = $('asset-list'); al.textContent = '';
    state.assets.forEach(function (a) { al.appendChild(itemRow('asset', a)); });
  }

  // ---------- add / remove / undo ----------
  var lastRemoved = null, toastTimer = null;

  function removeItem(listKey, id) {
    var item = find(state[listKey], id);
    if (!item) return;
    var label = item.name || (listKey === 'debts' ? 'debt' : 'asset');
    update(function (s) {
      var i = s[listKey].findIndex(function (x) { return x.id === id; });
      if (i >= 0) { lastRemoved = { listKey: listKey, item: s[listKey][i], index: i }; s[listKey].splice(i, 1); }
    }, { lists: true, userEdit: true });
    showToast('Removed “' + label + '”');
  }

  function showToast(text) {
    $('toast-text').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; lastRemoved = null; }, 7000);
  }

  $('toast-undo').addEventListener('click', function () {
    if (!lastRemoved) return;
    var r = lastRemoved; lastRemoved = null;
    update(function (s) { s[r.listKey].splice(Math.min(r.index, s[r.listKey].length), 0, r.item); }, { lists: true, userEdit: true });
    $('toast').hidden = true;
  });

  function addItem(listKey) {
    var id = uid(listKey === 'debts' ? 'd' : 'a');
    update(function (s) {
      s[listKey].push(listKey === 'debts'
        ? { id: id, name: '', balance: 0, apr: 0, payment: 0 }
        : { id: id, name: '', value: 0, rate: 0, contribution: 0 });
    }, { lists: true, userEdit: true });
    var el = $((listKey === 'debts' ? 'debt-' : 'asset-') + id + '-name');
    if (el) el.focus();
  }
  $('add-debt').addEventListener('click', function () { addItem('debts'); });
  $('add-asset').addEventListener('click', function () { addItem('assets'); });

  function replaceState(next) {
    state = next;
    recompute();
    save();
    renderLists();
    renderDerived();
  }
  $('start-own').addEventListener('click', function () {
    replaceState(blankState(startOfToday()));
    var first = state.debts[0] && $('debt-' + state.debts[0].id + '-name');
    if (first) first.focus();
  });

  function armed(btn, idle, confirmText, action) {
    var t = null;
    btn.addEventListener('click', function () {
      if (btn.classList.contains('armed')) {
        clearTimeout(t); btn.classList.remove('armed'); btn.textContent = idle; action();
        return;
      }
      if (!state.example && hasAnything()) {
        btn.classList.add('armed'); btn.textContent = confirmText;
        t = setTimeout(function () { btn.classList.remove('armed'); btn.textContent = idle; }, 4000);
      } else {
        action();
      }
    });
  }
  function hasAnything() {
    return state.debts.some(function (d) { return +d.balance || +d.payment; }) ||
      state.assets.some(function (a) { return +a.value || +a.contribution; });
  }
  armed($('load-example'), 'Load example numbers', 'Click again to replace your numbers', function () {
    replaceState(exampleState(startOfToday()));
  });
  armed($('clear-all'), 'Clear everything', 'Click again to erase everything', function () {
    replaceState(blankState(startOfToday()));
  });

  // ---------- plan controls ----------
  var HELP = {
    minimums: 'Each debt gets its own payment and nothing more. When a debt is paid off, that money stops going to debt.',
    avalanche: 'Extra money, plus each paid-off payment, goes to the highest interest rate first. Saves the most interest.',
    snowball: 'Extra money, plus each paid-off payment, goes to the smallest balance first. Quick wins keep you going.'
  };
  Array.prototype.forEach.call(document.querySelectorAll('input[name="method"]'), function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      update(function (s) { s.plan.method = r.value; });
    });
  });
  $('extra').addEventListener('input', function () {
    var v = +$('extra').value;
    update(function (s) {
      s.plan.extra = v;
      if (v > 0 && s.plan.method === 'minimums') s.plan.method = 'avalanche';
    });
  });

  // ---------- derived rendering ----------
  function payoffDate(months) { return E.addMonths(state.asOf, months); }

  function renderDerived() {
    var method = state.plan.method;
    var extra = +state.plan.extra || 0;
    var any = hasCounted();

    $('example-note').hidden = !state.example;

    // plan controls
    var radio = $('method-' + method);
    if (radio) radio.checked = true;
    if (+$('extra').value !== extra) $('extra').value = String(extra);
    $('extra-out').textContent = fmt0.format(extra);
    $('method-help').textContent = HELP[method];

    // board tag + payoff line
    $('plan-tag').textContent = method === 'minimums' ? 'Minimums only'
      : (method === 'avalanche' ? 'Avalanche' : 'Snowball') + ' plan' + (extra ? ' · +' + fmt0.format(extra) + '/mo' : '');

    // debts header
    var totalBal = 0, monthlyInt = 0, count = 0;
    state.debts.forEach(function (d) {
      var b = +d.balance || 0;
      if (b > E.EPS) { count++; totalBal += b; monthlyInt += E.monthlyInterest(d); }
    });
    $('debts-sub').textContent = count
      ? count + ' ' + plural(count, 'debt', 'debts') + ' · ' + fmt0.format(totalBal) + ' · ' + fmt0.format(monthlyInt) + '/mo in interest'
      : 'Add what you owe to start the clock';

    var asOf = new Date(state.asOf);
    $('as-of').textContent = 'Balances as of ' + dShort.format(asOf) + '. Payments are assumed on the ' + ordinal(asOf.getDate()) + ' of each month; the clock projects forward from there.';

    // per-debt chips
    state.debts.forEach(function (d, i) {
      var box = $('debt-' + d.id + '-chips');
      if (!box) return;
      box.textContent = '';
      var b = +d.balance || 0;
      if (b <= E.EPS) {
        if (+d.payment || +d.apr || d.name) box.appendChild(chip('good', 'check', 'Paid off'));
        else box.appendChild(chip('', null, 'Fill in the balance, rate and payment to add it to the clock'));
        return;
      }
      var pm = plan.payoffMonth[i];
      var mi = E.monthlyInterest(d);
      if (!counted(d)) box.appendChild(chip('', null, 'Not in countdown · pays its own schedule'));
      if (pm === null) {
        box.appendChild(chip('crit', 'stop', 'Never paid off at this pace: the payment is under the ' + fmt2.format(mi) + ' monthly interest'));
        return;
      }
      box.appendChild(chip('', 'flag', 'Paid off ' + dMonthYear.format(new Date(payoffDate(pm)))));
      box.appendChild(chip('', null, fmt0.format(plan.interest[i]) + ' interest to go'));
      if (E.isGrowing(d) && counted(d)) box.appendChild(chip('warn', 'warn', 'Payment is under the ' + fmt2.format(mi) + ' monthly interest; your plan’s extra covers it'));
    });

    // assets header + chips
    var aTotal = 0, aDay = 0, aAdd = 0;
    state.assets.forEach(function (a) {
      var v = +a.value || 0;
      aTotal += v; aDay += v * (+a.rate || 0) / 100 / 365; aAdd += +a.contribution || 0;
      var box = $('asset-' + a.id + '-chips');
      if (!box) return;
      box.textContent = '';
      if (v > 0 && +a.rate) box.appendChild(chip('', null, 'Earns about ' + fmt2.format(v * a.rate / 100 / 365) + ' a day'));
      if (v > 0 || +a.contribution) box.appendChild(chip('', null, 'In 10 years: ' + fmt0.format(E.assetValueAt(a, 120))));
    });
    $('assets-sub').textContent = state.assets.length
      ? fmt0.format(aTotal) + ' · earns about ' + fmt2.format(aDay) + ' a day' + (aAdd ? ' + ' + fmt0.format(aAdd) + '/mo added' : '')
      : 'Add savings and investments to see net worth grow';

    renderResult(any);
    renderChart(any);
    renderOrder(any);
    paint(Date.now(), true);
  }

  function renderResult(any) {
    var big = $('result-big'), sub = $('result-sub');
    sub.textContent = '';
    if (!any) {
      if (hasDebt()) {
        big.textContent = 'Nothing in your countdown';
        sub.textContent = 'Tick “Count in debt-free countdown” on a debt to plan its payoff.';
      } else {
        big.textContent = 'Add a debt to see your plan';
        sub.textContent = 'Enter a balance, rate and monthly payment for each debt.';
      }
      return;
    }
    var method = state.plan.method;
    if (method === 'minimums') {
      big.textContent = isFinite(base.months) ? 'Debt-free ' + dMonthYear.format(new Date(payoffDate(base.months))) : 'Not at this pace';
      sub.textContent = 'Choose Avalanche or Snowball, or slide in a little extra, to see how much sooner you could be free.';
      return;
    }
    if (!isFinite(plan.months)) {
      big.textContent = 'Still not enough';
      sub.textContent = 'At least one debt keeps growing. Raise its payment or the extra amount.';
      return;
    }
    var planDate = dMonthYear.format(new Date(payoffDate(plan.months)));
    if (!isFinite(base.months)) {
      big.textContent = 'Paid off by ' + planDate;
      sub.textContent = 'Minimum payments alone would never clear it. Your plan does.';
      return;
    }
    var saved = base.months - plan.months;
    var interestSaved = base.totalInterest - plan.totalInterest;
    big.textContent = saved > 0 ? span(saved) + ' sooner' : 'Same finish line';
    sub.appendChild(h('strong', null, fmt0.format(Math.max(0, interestSaved)) + ' less interest'));
    sub.appendChild(document.createTextNode('. Debt-free ' + planDate + ' instead of ' + dMonthYear.format(new Date(payoffDate(base.months))) + ' on minimums alone.'));
  }

  function renderOrder(any) {
    var list = $('order'); list.textContent = '';
    var rows = [];
    state.debts.forEach(function (d, i) {
      if (counted(d) && (+d.balance || 0) > E.EPS) rows.push({ name: d.name || 'Unnamed debt', m: plan.payoffMonth[i] });
    });
    $('order-block').hidden = rows.length < 2;
    rows.sort(function (a, b) { return (a.m === null ? 1e9 : a.m) - (b.m === null ? 1e9 : b.m); });
    rows.forEach(function (r) {
      var li = h('li');
      li.appendChild(h('span', { class: 'o-name' }, r.name));
      li.appendChild(h('span', { class: 'o-when' }, r.m === null ? 'Never at this pace' : dMonthYear.format(new Date(payoffDate(r.m)))));
      list.appendChild(li);
    });
  }

  // ---------- chart ----------
  var chartState = null;

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= raw) return steps[i] * p;
    return 10 * p;
  }

  function renderChart(any) {
    var block = $('chart-block');
    block.hidden = !any;
    if (!any) return;
    var host = $('chart');
    var W = Math.max(260, host.clientWidth || 360), H = 210;
    var M = { l: 46, r: 16, t: 26, b: 26 };
    var single = state.plan.method === 'minimums';
    var series = single
      ? [{ label: 'Debt remaining', color: 'var(--plan)', sim: incPlan }]
      : [{ label: 'Your plan', color: 'var(--plan)', sim: incPlan }, { label: 'Minimums only', color: 'var(--base)', sim: incBase }];

    var finite = series.filter(function (s) { return isFinite(s.sim.months); }).map(function (s) { return s.sim.months; });
    var xMax = finite.length ? Math.max.apply(null, finite) : 360;
    if (finite.length < series.length) xMax = Math.min(E.MAX_MONTHS, Math.max(xMax + 24, Math.round(xMax * 1.5)));
    xMax = Math.max(xMax, 12);

    var vMax = 0;
    series.forEach(function (s) {
      for (var i = 0; i <= xMax && i < s.sim.total.length; i++) vMax = Math.max(vMax, s.sim.total[i]);
    });
    var step = niceStep(Math.max(vMax, 1) / 4);
    var yMax = Math.ceil(vMax / step) * step || step;

    var pw = W - M.l - M.r, ph = H - M.t - M.b;
    function X(m) { return M.l + (m / xMax) * pw; }
    function Y(v) { return M.t + (1 - Math.min(v, yMax * 1.02) / yMax) * ph; }

    var svg = '';
    // grid + y labels
    for (var v = 0; v <= yMax + 1e-6; v += step) {
      var y = Y(v).toFixed(1);
      svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line-2)" stroke-width="1"/>';
      svg += '<text x="' + (M.l - 8) + '" y="' + y + '" dy="0.32em" text-anchor="end" font-size="11" fill="var(--muted)">' + (v === 0 ? '$0' : fmtCompact.format(v)) + '</text>';
    }
    // x ticks at Jan 1 of selected years
    var startYear = new Date(state.asOf).getFullYear();
    var endYear = new Date(E.addMonths(state.asOf, xMax)).getFullYear();
    var yStep = [1, 2, 5, 10, 20].find(function (s) { return (endYear - startYear) / s <= 6; }) || 20;
    for (var yr = startYear + 1; yr <= endYear; yr++) {
      if (yr % yStep !== 0 && yStep > 1) continue;
      var mm = E.monthsSince(state.asOf, new Date(yr, 0, 1).getTime());
      if (mm <= 0 || mm > xMax) continue;
      var x = X(mm).toFixed(1);
      svg += '<line x1="' + x + '" x2="' + x + '" y1="' + (H - M.b) + '" y2="' + (H - M.b + 4) + '" stroke="var(--line)" stroke-width="1"/>';
      svg += '<text x="' + x + '" y="' + (H - M.b + 16) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + yr + '</text>';
    }
    svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + (H - M.b) + '" y2="' + (H - M.b) + '" stroke="var(--line)" stroke-width="1"/>';

    // series (draw base first so plan sits on top)
    var drawOrder = series.slice().reverse();
    drawOrder.forEach(function (s, idx) {
      var data = s.sim.total, n = Math.min(xMax, data.length - 1);
      var d = '';
      for (var i = 0; i <= n; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(data[i]).toFixed(1);
      if (s.sim === incPlan) {
        svg += '<path d="' + d + 'L' + X(n).toFixed(1) + ' ' + Y(0).toFixed(1) + 'L' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z" fill="' + s.color + '" fill-opacity="0.1" stroke="none"/>';
      }
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    });

    // end markers + direct labels at payoff
    var ends = series.filter(function (s) { return isFinite(s.sim.months); }).map(function (s) {
      return { x: X(s.sim.months), color: s.color, text: dMonthYear.format(new Date(payoffDate(s.sim.months))) };
    });
    ends.forEach(function (e, i) {
      svg += '<circle cx="' + e.x.toFixed(1) + '" cy="' + Y(0).toFixed(1) + '" r="4.5" fill="' + e.color + '" stroke="var(--surface)" stroke-width="2"/>';
      if (i > 0 && Math.abs(e.x - ends[0].x) < 76) return;
      // Lines arrive at the payoff dot from the upper left, so the label sits to the
      // right of the dot, just above the axis; near the right edge it flips left and up.
      var roomRight = e.x < W - M.r - 62;
      var lx = roomRight ? e.x + 8 : e.x - 8;
      var ly = roomRight ? Y(0) - 7 : Y(0) - 13;
      svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (roomRight ? 'start' : 'end') + '" font-size="11.5" font-weight="600" fill="var(--ink-2)">' + e.text + '</text>';
    });

    // hover layer
    svg += '<line id="xhair" x1="0" x2="0" y1="' + M.t + '" y2="' + (H - M.b) + '" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>';
    series.forEach(function (s, i) {
      svg += '<circle id="xdot' + i + '" r="4.5" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>';
    });
    svg += '<rect id="hit" x="' + M.l + '" y="0" width="' + pw + '" height="' + H + '" fill="transparent"/>';

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" tabindex="0" role="img" aria-label="Debt remaining over time. Use left and right arrow keys to read values.">' + svg + '</svg>';
    var tip = h('div', { class: 'tip', hidden: '' });
    host.appendChild(tip);

    chartState = { X: X, Y: Y, xMax: xMax, series: series, W: W, M: M, tip: tip, idx: null };

    // legend
    var lg = $('legend'); lg.textContent = '';
    if (!single) series.forEach(function (s) {
      var item = h('span');
      var key = h('span', { class: 'key' }); key.style.background = s.color;
      item.appendChild(key); item.appendChild(document.createTextNode(s.label));
      lg.appendChild(item);
    });

    var el = host.querySelector('svg');
    el.addEventListener('pointermove', function (ev) {
      var r = el.getBoundingClientRect();
      var px = (ev.clientX - r.left) * (W / r.width);
      showAt(Math.round(((px - M.l) / pw) * xMax));
    });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('blur', hideTip);
    el.addEventListener('focus', function () { showAt(chartState.idx == null ? 0 : chartState.idx); });
    el.addEventListener('keydown', function (ev) {
      var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      ev.preventDefault();
      showAt((chartState.idx || 0) + d * (ev.shiftKey ? 12 : 1));
    });

    renderTable(series, xMax);
  }

  function showAt(i) {
    var c = chartState; if (!c) return;
    i = Math.max(0, Math.min(c.xMax, i));
    c.idx = i;
    var host = $('chart'), svg = host.querySelector('svg');
    var x = c.X(i);
    var xh = svg.querySelector('#xhair');
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    c.tip.textContent = '';
    c.tip.appendChild(h('div', { class: 't-date' }, dMonthYear.format(new Date(payoffDate(i)))));
    c.series.forEach(function (s, k) {
      var data = s.sim.total;
      var v = data[Math.min(i, data.length - 1)];
      var dot = svg.querySelector('#xdot' + k);
      dot.setAttribute('cx', x); dot.setAttribute('cy', c.Y(v)); dot.setAttribute('visibility', 'visible');
      var row = h('div', { class: 'row' });
      var key = h('span', { class: 'k' }); key.style.background = s.color;
      row.appendChild(key);
      row.appendChild(h('strong', null, fmt0.format(v)));
      row.appendChild(h('span', null, s.label));
      c.tip.appendChild(row);
    });
    c.tip.hidden = false;
    // Sit beside the crosshair inside the plot, flipping sides near the right edge.
    var r = svg.getBoundingClientRect();
    var scale = r.width / c.W;
    var px = x * scale, tw = c.tip.offsetWidth || 170;
    var left = px + 12 + tw <= r.width ? px + 12 : Math.max(0, px - 12 - tw);
    c.tip.style.left = left + 'px';
    c.tip.style.top = (c.M.t * scale) + 'px';
  }

  function hideTip() {
    var c = chartState; if (!c) return;
    c.tip.hidden = true;
    var svg = $('chart').querySelector('svg'); if (!svg) return;
    svg.querySelector('#xhair').setAttribute('visibility', 'hidden');
    c.series.forEach(function (s, k) { svg.querySelector('#xdot' + k).setAttribute('visibility', 'hidden'); });
  }

  function renderTable(series, xMax) {
    var wrap = $('chart-table'); wrap.textContent = '';
    var t = h('table'), thead = h('thead'), tr = h('tr');
    tr.appendChild(h('th', { scope: 'col' }, 'Date'));
    series.forEach(function (s) { tr.appendChild(h('th', { scope: 'col' }, s.label)); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = h('tbody');
    for (var i = 0; i <= xMax; i += 6) {
      var row = h('tr');
      row.appendChild(h('td', null, dMonthYear.format(new Date(payoffDate(i)))));
      series.forEach(function (s) { var d = s.sim.total; row.appendChild(h('td', null, fmt0.format(d[Math.min(i, d.length - 1)]))); });
      tb.appendChild(row);
    }
    t.appendChild(tb); wrap.appendChild(t);
  }

  if (window.ResizeObserver) {
    var pending = false, lastW = 0;
    new ResizeObserver(function (entries) {
      var w = Math.round(entries[0].contentRect.width);
      if (w === lastW || pending) return;
      lastW = w; pending = true;
      requestAnimationFrame(function () { pending = false; renderChart(hasCounted()); });
    }).observe($('chart'));
  }

  // ---------- live clock ----------
  var els = {
    y: $('cd-y'), m: $('cd-m'), d: $('cd-d'), t: $('cd-t'),
    yl: $('cd-y-lab'), ml: $('cd-m-lab'), dl: $('cd-d-lab'),
    cd: $('countdown'), msg: $('cd-message'), line: $('payoff-line'),
    debt: $('tk-debt'), int: $('tk-int'), net: $('tk-net'),
    debtRate: $('tk-debt-rate'), intRate: $('tk-int-rate'), netRate: $('tk-net-rate')
  };

  function setMoney(el, v) {
    var p = money6(v);
    el.firstChild.textContent = p.main;
    el.lastChild.textContent = p.sub;
  }

  function setRate(el, lead, strong, tail) {
    el.textContent = '';
    if (lead) el.appendChild(document.createTextNode(lead));
    el.appendChild(h('strong', null, strong));
    if (tail) el.appendChild(document.createTextNode(tail));
  }

  var lastSecond = -1, lastTick = 0;

  function paint(now, force) {
    var snap = E.snapshot(state, plan, now);
    setMoney(els.debt, snap.debtTotal);
    setMoney(els.int, snap.interestToday);
    setMoney(els.net, snap.netWorth);
    els.net.classList.toggle('green', snap.netWorth >= 0);
    els.net.classList.toggle('red', snap.netWorth < 0);

    var sec = Math.floor(now / 1000);
    if (sec === lastSecond && !force) return;
    lastSecond = sec;

    // rates (per day)
    var dDay = snap.debtPerSec * 86400;
    if (snap.debtTotal <= E.EPS) setRate(els.debtRate, '', 'Nothing left to pay', '');
    else if (dDay < 0) setRate(els.debtRate, '▼ ', fmt2.format(-dDay) + ' a day', ' as you pay it down');
    else setRate(els.debtRate, '▲ ', fmt2.format(dDay) + ' a day', ': payments don’t cover the interest');
    var iDay = snap.interestPerSec * 86400;
    setRate(els.intRate, '', fmt2.format(iDay) + ' a day', ' · ' + fmt0.format(iDay * 365) + ' a year');
    var nDay = snap.netPerSec * 86400;
    setRate(els.netRate, nDay >= 0 ? '▲ ' : '▼ ', fmt2.format(Math.abs(nDay)) + ' a day', nDay >= 0 ? ' and climbing' : '');

    // countdown
    var mode = !hasDebt() ? 'empty' : !hasCounted() ? 'uncounted'
      : snap.payoffAt === null ? 'never' : snap.payoffAt <= now ? 'free' : 'count';
    els.cd.hidden = mode !== 'count';
    els.msg.hidden = mode === 'count';
    if (mode === 'count') {
      var diff = E.calendarDiff(now, snap.payoffAt);
      els.y.textContent = pad2(diff.years);
      els.m.textContent = pad2(diff.months);
      els.d.textContent = pad2(diff.days);
      els.t.textContent = pad2(diff.hours) + ':' + pad2(diff.minutes) + ':' + pad2(diff.seconds);
      els.yl.textContent = plural(diff.years, 'year', 'years');
      els.ml.textContent = plural(diff.months, 'month', 'months');
      els.dl.textContent = plural(diff.days, 'day', 'days');
      if (force || sec % 60 === 0) {
        els.line.textContent = '';
        els.line.appendChild(document.createTextNode('Your last payment lands '));
        els.line.appendChild(h('strong', null, dLong.format(new Date(snap.payoffAt))));
        els.line.appendChild(document.createTextNode('. You’ll pay ' + fmt0.format(plan.totalInterest) + ' more in interest before then.'));
        var skipped = uncountedNames();
        if (skipped.length) els.line.appendChild(document.createTextNode(' Not counted: ' + skipped.join(', ') + '.'));
        els.cd.setAttribute('aria-label', 'Debt-free in ' + diff.years + ' years, ' + diff.months + ' months, ' + diff.days + ' days');
      }
    } else if (force || els.msg.dataset.mode !== mode) {
      els.msg.dataset.mode = mode;
      els.msg.className = 'cd-message ' + mode;
      els.line.textContent = '';
      if (mode === 'never') {
        els.msg.textContent = 'NEVER';
        els.line.textContent = 'At these payments, at least one debt grows every month. Raise its payment, or choose a plan and add extra.';
      } else if (mode === 'free') {
        els.msg.textContent = 'DEBT-FREE';
        els.line.textContent = 'Every debt in your countdown is paid off. Keep the clock running to watch your net worth grow.';
      } else if (mode === 'uncounted') {
        els.msg.textContent = '--:--:--';
        els.msg.className = 'cd-message empty';
        els.line.textContent = 'None of your debts are in the countdown. Tick “Count in debt-free countdown” on at least one.';
      } else {
        els.msg.textContent = '--:--:--';
        els.line.textContent = 'Add a debt below to start the countdown.';
      }
    }
  }

  function frame() {
    var now = Date.now();
    if (now - lastTick >= (reduceMotion ? 1000 : 50)) {
      lastTick = now;
      paint(now, false);
    }
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  recompute();
  var moved = E.rebase(state, plan, Date.now());
  if (moved !== state) { state = moved; recompute(); }
  save();
  renderLists();
  renderDerived();
  requestAnimationFrame(frame);
})();
