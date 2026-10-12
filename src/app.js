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

  // ---------- Pro (license) state ----------
  // The lock is only on when Lemon Squeezy is configured (or in the preview build);
  // otherwise everyone gets the full planner.
  var L = window.DFCLicense;
  var CFG = window.DFC_PRO || {};
  var PREVIEW = !!window.DFC_PREVIEW;
  var PRO_KEY = 'debt-free-clock:pro';
  var gating = PREVIEW || L.isConfigured(CFG);
  var pro = loadPro();
  var teaser = null;

  function loadPro() {
    try {
      var raw = window.localStorage.getItem(PRO_KEY);
      if (raw) { var p = JSON.parse(raw); if (p && p.key && p.instanceId) return p; }
    } catch (e) { /* storage blocked: treated as not unlocked */ }
    return null;
  }
  function savePro() {
    try {
      if (pro) window.localStorage.setItem(PRO_KEY, JSON.stringify(pro));
      else window.localStorage.removeItem(PRO_KEY);
    } catch (e) { /* ignore */ }
  }
  function proActive() { return !gating || !!pro; }
  /** Free users run on minimum payments; Pro users run the plan they chose. */
  function effectivePlan() { return proActive() ? state.plan : { method: 'minimums', extra: 0 }; }
  function teaserExtra() { return (+state.plan.extra || 0) > 0 ? +state.plan.extra : 100; }
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
    var ep = effectivePlan();
    incPlan = ep.method === 'minimums' ? incBase : E.simulateDebts(inc, ep);
    teaser = proActive() ? null : E.simulateDebts(inc, { method: 'avalanche', extra: teaserExtra() });
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
  /**
   * Once the clock has paid off every debt in the countdown: the day the last one landed.
   * Null otherwise, including blank $0 rows nobody has filled in yet.
   */
  function freeSince() {
    var latest = null;
    for (var i = 0; i < state.debts.length; i++) {
      var d = state.debts[i];
      if (!counted(d)) continue;
      if ((+d.balance || 0) > E.EPS) return null;
      if (d.paidOffAt && (latest === null || +d.paidOffAt > latest)) latest = +d.paidOffAt;
    }
    return latest;
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
    // Dollar boxes are text inputs so they can show thousands commas (number inputs can't).
    // The commas go in when you leave the box, so typing never jumps the cursor around.
    var dollars = pre === '$';
    var attrs = dollars
      ? { id: inputId, type: 'text', inputmode: 'decimal', autocomplete: 'off' }
      : { id: inputId, type: 'number', inputmode: 'decimal', step: 'any', min: '0' };
    var inp = h('input', Object.assign(attrs, extra || {}));
    var v = +item[key] || 0;
    inp.value = dollars ? E.formatMoneyInput(v) : (v ? String(Math.round(v * 100) / 100) : '');
    inp.placeholder = '0';
    inp.addEventListener('change', function () {
      var n = dollars ? E.parseMoneyInput(inp.value) : parseFloat(inp.value);
      if (!isFinite(n)) n = 0;
      if (extra && extra.min != null) n = Math.max(+extra.min, n); else n = Math.max(0, n);
      if (dollars) inp.value = E.formatMoneyInput(n);
      update(function (s) {
        var target = find(kind === 'debt' ? s.debts : s.assets, item.id);
        if (target) {
          target[key] = n;
          if (key === 'balance') delete target.paidOffAt;   // a typed balance replaces the clock's record
        }
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
    undoRestore = null;
    showToast('Removed “' + label + '”', true);
  }

  function showToast(text, withUndo) {
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !withUndo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; lastRemoved = null; undoRestore = null; }, 7000);
  }

  $('toast-undo').addEventListener('click', function () {
    if (undoRestore) {               // put back the numbers a restore replaced
      state = undoRestore; undoRestore = null;
      recompute();
      update(null, { lists: true });
      $('toast').hidden = true;
      return;
    }
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

    // board tag follows the plan actually on the clock
    var ep = effectivePlan(), epExtra = +ep.extra || 0;
    $('plan-tag').textContent = ep.method === 'minimums' ? 'Minimums only'
      : (ep.method === 'avalanche' ? 'Avalanche' : 'Snowball') + ' plan' + (epExtra ? ' · +' + fmt0.format(epExtra) + '/mo' : '');
    renderPro();
    renderBackup();

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
        if (d.paidOffAt) box.appendChild(chip('good', 'check', 'Paid off ' + dMonthYear.format(new Date(d.paidOffAt))));
        else if (+d.payment || +d.apr || d.name) box.appendChild(chip('good', 'check', 'Paid off'));
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
    var method = effectivePlan().method;
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

  // ---------- Pro gate, unlock, removal ----------
  var KEY_ERRORS = {
    'not-found': 'We couldn’t find that key. Check it against your purchase email from Lemon Squeezy and try again.',
    'limit': 'This key is already unlocked on the most browsers it allows. Remove Pro from one you no longer use, then try again.',
    'wrong-product': 'That key is for a different product.',
    'disabled': 'This key has been turned off, usually because the purchase was refunded.',
    'expired': 'This key has expired.',
    'network': 'Couldn’t reach Lemon Squeezy. Check your internet connection and try again.',
    'busy': 'Too many tries in a row. Wait a minute, then try again.',
    'server': 'Lemon Squeezy couldn’t confirm the key right now. Try again in a few minutes.',
    'rejected': 'Lemon Squeezy couldn’t confirm that key. Check it and try again.'
  };

  function keyMsg(kind, text) {
    var el = $('key-msg');
    el.className = 'key-msg' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  function renderPro() {
    var on = proActive();
    var body = $('plan-body');
    $('pro-gate').hidden = on;
    body.classList.toggle('locked', !on);
    if ('inert' in body) body.inert = !on;
    if (on) body.removeAttribute('aria-hidden'); else body.setAttribute('aria-hidden', 'true');

    var showStatus = gating && !!pro;
    $('pro-status').hidden = !showStatus;
    if (showStatus) {
      var c = $('pro-status-chip');
      c.innerHTML = ICON.check;
      c.appendChild(document.createTextNode('Pro'));
      $('pro-status-text').textContent = pro.instanceId === 'preview'
        ? 'Unlocked in this preview.'
        : 'Unlocked on this browser with key ' + L.maskKey(pro.key) + '.';
    }
    if (on) return;

    var buy = $('buy-pro');
    buy.textContent = 'Unlock Pro · ' + (CFG.price || '$9') + ' once';
    buy.href = PREVIEW || !CFG.checkoutUrl ? '#' : CFG.checkoutUrl;
    $('preview-note').hidden = !PREVIEW;
    $('buy-fine').hidden = PREVIEW;
    renderTeaser();
  }

  function renderTeaser() {
    var big = $('teaser-big'), sub = $('teaser-sub');
    sub.textContent = '';
    var x = fmt0.format(teaserExtra());
    if (!hasCounted() || !teaser) {
      big.textContent = 'Find your fastest way out';
      sub.textContent = 'Add your debts, then compare payoff methods and extra payments to see how much sooner you could be free.';
      return;
    }
    if (!isFinite(incBase.months) && isFinite(teaser.months)) {
      big.textContent = 'A plan clears it by ' + dMonthYear.format(new Date(payoffDate(teaser.months)));
      sub.textContent = 'Minimum payments alone never pay off your debt. The avalanche method with ' + x + ' extra a month does.';
      return;
    }
    var saved = isFinite(incBase.months) && isFinite(teaser.months) ? incBase.months - teaser.months : 0;
    if (saved > 0) {
      big.textContent = span(saved) + ' sooner';
      sub.appendChild(document.createTextNode('That’s what the avalanche method plus ' + x + ' extra a month could do for your debts, saving about '));
      sub.appendChild(h('strong', null, fmt0.format(Math.max(0, incBase.totalInterest - teaser.totalInterest)) + ' in interest'));
      sub.appendChild(document.createTextNode('. Pro lets you try any plan and puts it on your clock.'));
      return;
    }
    big.textContent = 'Find your fastest way out';
    sub.textContent = 'Compare avalanche and snowball and test extra payments on your own debts.';
  }

  function grant(key, instanceId) {
    var now = Date.now();
    pro = { key: key, instanceId: instanceId, activatedAt: now, checkedAt: now };
    savePro();
    $('license-key').value = '';
    keyMsg('', '');
    update();
    showToast('Pro unlocked. Your plan is now on the clock.', false);
  }

  $('buy-pro').addEventListener('click', function (ev) {
    if (PREVIEW) { ev.preventDefault(); grant('PREVIEW', 'preview'); return; }
    if (!CFG.checkoutUrl) { ev.preventDefault(); return; }
    // Checkout opens in a new tab; have the key box ready for when they come back.
    $('have-key').open = true;
  });

  var keyBusy = false;
  $('key-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (keyBusy) return;
    var key = L.normalizeKey($('license-key').value);
    if (!L.looksLikeKey(key)) {
      keyMsg('error', 'That doesn’t look like a license key. Copy the long code from your purchase email, like 38B1460A-5104-4067-A91D-77B872934D51.');
      return;
    }
    if (PREVIEW) { grant(key, 'preview'); return; }
    keyBusy = true;
    $('key-submit').disabled = true;
    keyMsg('', 'Checking your key…');
    L.activate(CFG, key, L.instanceName(navigator.userAgent), window.fetch.bind(window)).then(function (res) {
      keyBusy = false;
      $('key-submit').disabled = false;
      if (res.ok) grant(key, res.instanceId);
      else keyMsg('error', KEY_ERRORS[res.reason] || KEY_ERRORS.rejected);
    });
  });

  var removeTimer = null;
  function resetRemove() {
    var b = $('pro-remove');
    b.classList.remove('armed');
    b.textContent = 'Remove from this browser';
  }
  $('pro-remove').addEventListener('click', function () {
    var btn = $('pro-remove');
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Click again to remove Pro here';
      removeTimer = setTimeout(resetRemove, 4000);
      return;
    }
    clearTimeout(removeTimer);
    resetRemove();
    var old = pro;
    function finish(text) { pro = null; savePro(); update(); showToast(text, false); }
    if (!old || old.instanceId === 'preview') { finish('Pro removed from this preview.'); return; }
    btn.disabled = true;
    L.deactivate(CFG, old.key, old.instanceId, window.fetch.bind(window)).then(function (r) {
      btn.disabled = false;
      finish(r.ok ? 'Pro removed from this browser. That frees a slot on your key.'
        : 'Pro removed from this browser, but Lemon Squeezy couldn’t be reached, so the slot may still count.');
    });
  });

  /** Every couple of weeks, confirm the key is still good (refunds turn keys off). */
  function recheckPro() {
    if (PREVIEW || !gating || !pro || pro.instanceId === 'preview') return;
    if (!L.isDue(pro, Date.now(), CFG.recheckDays)) return;
    L.validate(CFG, pro.key, pro.instanceId, window.fetch.bind(window)).then(function (r) {
      if (r.state === 'valid') { pro.checkedAt = Date.now(); savePro(); }
      else if (r.state === 'invalid') {
        pro = null; savePro(); update();
        showToast('Pro is no longer active on this browser. Enter your license key again to unlock it.', false);
      }
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
    var single = effectivePlan().method === 'minimums';
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

  // ---------- share card ----------
  // A square image of the countdown for group chats and social posts. It shows only the
  // time left and the payoff month, never balances or dollar amounts.
  var SHARE_URL = 'https://the-ljaw.github.io/debt-free-clock/';
  var dMonthLong = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  var share = { file: null, url: null, text: '' };

  /** What the card says right now, or null when there's nothing worth sharing. */
  function shareInfo(now) {
    if (state.example) return null;
    var since = freeSince();
    if (since !== null) return { free: true, since: since };
    if (!hasDebt() || !hasCounted()) return null;
    var snap = E.snapshot(state, plan, now);
    if (snap.payoffAt === null) return null;
    if (snap.payoffAt <= now) return { free: true, since: snap.payoffAt };
    var diff = E.calendarDiff(now, snap.payoffAt);
    var sooner = 0;
    if (proActive() && effectivePlan().method !== 'minimums' && isFinite(base.months) && isFinite(plan.months)) {
      sooner = Math.max(0, base.months - plan.months);
    }
    return { free: false, diff: diff, payoffAt: snap.payoffAt, sooner: sooner };
  }

  function timeWords(diff) {
    var parts = [];
    if (diff.years) parts.push(diff.years + ' ' + plural(diff.years, 'year', 'years'));
    if (diff.months) parts.push(diff.months + ' ' + plural(diff.months, 'month', 'months'));
    if (diff.days || !parts.length) parts.push(diff.days + ' ' + plural(diff.days, 'day', 'days'));
    if (parts.length < 2) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  function shareText(info) {
    if (info.free) return 'I’m debt-free! Every debt on my countdown is paid off' + (info.since ? ' (last payment ' + dMonthLong.format(new Date(info.since)) + ')' : '') + '. Start your own clock:';
    return 'I’ll be debt-free in ' + timeWords(info.diff) + ' (last payment ' + dMonthLong.format(new Date(info.payoffAt)) + '). Counting down with Debt-Free Clock:';
  }

  function loadShareFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var want = ['900 200px Doto', '700 40px "Public Sans"', '600 40px "Public Sans"'];
    var all = Promise.all(want.map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 1500); })]);
  }

  function spaced(ctx, text, x, y, track) {
    // canvas letterSpacing isn't everywhere yet, so space characters by hand
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, y);
      x += ctx.measureText(text[i]).width + track;
    }
    return x;
  }

  function drawShareCard(info) {
    var S = 1080, c = document.createElement('canvas');
    c.width = S; c.height = S;
    var ctx = c.getContext('2d');
    var LED = '#F3F1E7', DIM = '#85918A', GREEN = '#5FE094', RED = '#FF5B4D', BOARD = '#0C110E';
    var BODY = '"Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var DOTO = 'Doto, "Courier New", monospace';
    var PAD = 88;

    ctx.fillStyle = BOARD; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(243, 241, 231, .05)';
    for (var gy = 7; gy < S; gy += 14) for (var gx = 7; gx < S; gx += 14) { ctx.beginPath(); ctx.arc(gx, gy, 1.4, 0, 6.2832); ctx.fill(); }
    ctx.textBaseline = 'alphabetic';

    // brand mark
    ctx.fillStyle = '#1B2420'; roundRect(ctx, PAD, PAD, 52, 52, 12); ctx.fill();
    for (var di = 0; di < 12; di++) {               // countdown ring: 3/4 paid (green), 1/4 owed (red)
      var ang = -Math.PI / 2 + di * Math.PI / 6;
      ctx.fillStyle = di < 9 ? GREEN : RED;
      ctx.beginPath(); ctx.arc(PAD + 26 + 16.25 * Math.cos(ang), PAD + 26 + 16.25 * Math.sin(ang), 3.6, 0, 6.2832); ctx.fill();
    }
    ctx.fillStyle = DIM; ctx.font = '700 24px ' + BODY;
    spaced(ctx, 'DEBT-FREE CLOCK', PAD + 74, PAD + 35, 4);

    if (info.free) {
      ctx.fillStyle = DIM; ctx.font = '700 34px ' + BODY;
      spaced(ctx, 'AS OF TODAY, I’M', PAD, 380, 6);
      glowText(ctx, 'DEBT', PAD, 560, '900 210px ' + DOTO, GREEN, 'rgba(95, 224, 148, .35)');
      glowText(ctx, 'FREE', PAD, 740, '900 210px ' + DOTO, GREEN, 'rgba(95, 224, 148, .35)');
      ctx.fillStyle = LED; ctx.font = '600 40px ' + BODY;
      ctx.fillText(info.since ? 'Paid in full since ' + dMonthLong.format(new Date(info.since)) + '.' : 'Every debt on my countdown is paid off.', PAD, 840);
    } else {
      ctx.fillStyle = DIM; ctx.font = '700 34px ' + BODY;
      spaced(ctx, 'I’LL BE DEBT-FREE IN', PAD, 300, 6);

      var d = info.diff, units = [];
      if (d.years) units.push([d.years, plural(d.years, 'YEAR', 'YEARS')]);
      if (d.years || d.months) units.push([d.months, plural(d.months, 'MONTH', 'MONTHS')]);
      units.push([d.days, plural(d.days, 'DAY', 'DAYS')]);
      // size the numbers so every unit fits across the card
      var gap = 64, size = 250, nums = units.map(function (u) { return pad2(u[0]); });
      for (; size > 120; size -= 6) {
        ctx.font = '900 ' + size + 'px ' + DOTO;
        var w = nums.reduce(function (t, n) { return t + ctx.measureText(n).width; }, 0) + gap * (units.length - 1);
        if (w <= S - PAD * 2) break;
      }
      var x = PAD, baseY = 300 + 40 + size * 0.86;
      units.forEach(function (u, i) {
        var wNum = (ctx.font = '900 ' + size + 'px ' + DOTO, ctx.measureText(nums[i]).width);
        glowText(ctx, nums[i], x, baseY, '900 ' + size + 'px ' + DOTO, LED, 'rgba(243, 241, 231, .25)');
        ctx.fillStyle = DIM; ctx.font = '700 26px ' + BODY;
        spaced(ctx, u[1], x + 4, baseY + 52, 5);
        x += wNum + gap;
      });

      var y = baseY + 150;
      ctx.fillStyle = DIM; ctx.font = '600 38px ' + BODY;
      var lead = 'Last payment: ';
      ctx.fillText(lead, PAD, y);
      ctx.fillStyle = LED; ctx.font = '700 38px ' + BODY;
      ctx.fillText(dMonthLong.format(new Date(info.payoffAt)), PAD + (ctx.font = '600 38px ' + BODY, ctx.measureText(lead).width), y);

      if (info.sooner > 0) {
        var pill = span(info.sooner) + ' sooner with my payoff plan';
        ctx.font = '700 30px ' + BODY;
        var pw = ctx.measureText(pill).width + 52;
        ctx.fillStyle = 'rgba(95, 224, 148, .12)'; roundRect(ctx, PAD, y + 34, pw, 62, 31); ctx.fill();
        ctx.strokeStyle = 'rgba(95, 224, 148, .45)'; ctx.lineWidth = 2; roundRect(ctx, PAD, y + 34, pw, 62, 31); ctx.stroke();
        ctx.fillStyle = GREEN; ctx.fillText(pill, PAD + 26, y + 76);
      }
    }

    // footer
    ctx.fillStyle = '#26312B'; ctx.fillRect(PAD, S - 170, S - PAD * 2, 2);
    ctx.fillStyle = DIM; ctx.font = '600 28px ' + BODY;
    ctx.fillText('Count down to your own debt-free day', PAD, S - 112);
    ctx.fillStyle = LED; ctx.font = '700 30px ' + BODY;
    ctx.fillText(SHARE_URL.replace(/^https:\/\//, '').replace(/\/$/, ''), PAD, S - 68);
    return c;
  }

  function glowText(ctx, text, x, y, font, color, glow) {
    ctx.save();
    ctx.font = font; ctx.fillStyle = color;
    ctx.shadowColor = glow; ctx.shadowBlur = 36;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function openShare() {
    var info = shareInfo(Date.now());
    if (!info) return;
    share.text = shareText(info);
    loadShareFonts().then(function () {
      var canvas = drawShareCard(info);
      canvas.toBlob(function (blob) {
        if (!blob) { showToast('Couldn’t make the image in this browser.'); return; }
        if (share.url) URL.revokeObjectURL(share.url);
        share.url = URL.createObjectURL(blob);
        share.file = typeof File === 'function' ? new File([blob], 'debt-free-countdown.png', { type: 'image/png' }) : null;
        var img = $('share-img');
        img.src = share.url;
        img.alt = info.free ? 'Share card: I’m debt-free' : 'Share card: I’ll be debt-free in ' + timeWords(info.diff);
        var canFiles = false;
        try { canFiles = !!(share.file && navigator.canShare && navigator.canShare({ files: [share.file] })); } catch (e) {}
        $('share-go').hidden = !canFiles;
        var dlg = $('share-dlg');
        if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
      }, 'image/png');
    });
  }

  function closeShare() {
    var dlg = $('share-dlg');
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
  }

  $('share-open').addEventListener('click', openShare);
  $('share-close').addEventListener('click', closeShare);
  $('share-dlg').addEventListener('click', function (e) { if (e.target === this) closeShare(); });
  $('share-go').addEventListener('click', function () {
    if (!share.file) return;
    navigator.share({ files: [share.file], text: share.text + ' ' + SHARE_URL }).catch(function () {});
  });
  $('share-dl').addEventListener('click', function () {
    if (!share.url) return;
    var a = h('a', { href: share.url, download: 'debt-free-countdown.png' });
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('share-copy').addEventListener('click', function () {
    var t = share.text + ' ' + SHARE_URL;
    var done = function () { showToast('Copied. Paste it with the image.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { showToast('Couldn’t copy here. Select the text yourself: ' + t); });
    else showToast(t);
  });

  // ---------- live clock ----------
  var els = {
    y: $('cd-y'), m: $('cd-m'), d: $('cd-d'), t: $('cd-t'),
    yl: $('cd-y-lab'), ml: $('cd-m-lab'), dl: $('cd-d-lab'),
    cd: $('countdown'), msg: $('cd-message'), line: $('payoff-line'),
    board: $('board'), title: $('board-title'), tag: $('plan-tag'), caption: $('cd-caption'),
    share: $('share-row'), shareText: $('share-open-text'),
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

  var ZERO_DIFF = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

  // ---------- debt-free celebration ----------
  // A burst of LED-pixel confetti from the DEBT-FREE sign: once per payoff (remembered in
  // this browser), and again whenever someone taps the sign. Skipped for reduced motion.
  var confetti = { canvas: null, raf: 0 };

  function maybeCelebrate(freeAt) {
    if (state.example || state.celebratedFor === freeAt) return;
    state.celebratedFor = freeAt;
    save();
    setTimeout(celebrate, 350);
  }

  function celebrate() {
    if (reduceMotion || !els.board.getBoundingClientRect) return;
    var box = els.board.getBoundingClientRect();
    var W = box.width, H = box.height;
    if (!W || !H) return;
    if (!confetti.canvas) {
      confetti.canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
      els.board.appendChild(confetti.canvas);
    }
    var cv = confetti.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sign = els.msg.getBoundingClientRect();
    var ox = sign.left - box.left + Math.min(sign.width, W) * 0.35, oy = sign.top - box.top + sign.height * 0.5;
    var colors = ['#5FE094', '#5FE094', '#F3F1E7', '#FF5B4D', '#85918A'];
    var bits = [];
    for (var i = 0; i < 150; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      var v = 5 + Math.random() * 9;
      bits.push({
        x: ox + (Math.random() - 0.5) * 60, y: oy, vx: Math.cos(a) * v * 1.25, vy: Math.sin(a) * v,
        s: 3 + Math.random() * 4, c: colors[i % colors.length], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3
      });
    }
    cancelAnimationFrame(confetti.raf);
    var start = performance.now();
    (function step(t) {
      var age = t - start;
      ctx.clearRect(0, 0, W, H);
      var alive = 0;
      ctx.globalAlpha = age > 2200 ? Math.max(0, 1 - (age - 2200) / 800) : 1;
      bits.forEach(function (b) {
        b.vy += 0.28; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        if (b.y > H + 20) return;
        alive++;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s);
        ctx.restore();
      });
      if (alive && age < 3000) confetti.raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    })(start);
  }

  els.msg.addEventListener('click', function () { if (els.msg.dataset.mode === 'free') celebrate(); });

  var lastSecond = -1, lastTick = 0;

  function paint(now, force) {
    var snap = E.snapshot(state, plan, now);
    setMoney(els.debt, snap.debtTotal);
    setMoney(els.int, snap.interestToday);
    var noDebt = snap.debtTotal <= E.EPS;   // nothing owed: show the zeros in green, not red
    if (els.debt.classList.contains('green') !== noDebt) {
      [els.debt, els.int].forEach(function (el) { el.classList.toggle('green', noDebt); el.classList.toggle('red', !noDebt); });
    }
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

    // countdown. Once every counted debt is paid off, the same digits count UP:
    // how long you've been debt-free.
    var freeAt = freeSince();
    var mode = freeAt !== null ? 'free' : !hasDebt() ? 'empty' : !hasCounted() ? 'uncounted'
      : snap.payoffAt === null ? 'never' : snap.payoffAt <= now ? 'free' : 'count';
    if (mode === 'free' && freeAt === null) freeAt = snap.payoffAt;   // paid off this month
    var ticking = mode === 'count' || mode === 'free';
    els.cd.hidden = !ticking;
    els.msg.hidden = mode === 'count';
    els.caption.hidden = mode !== 'free';
    if (els.board.classList.contains('is-free') !== (mode === 'free')) els.board.classList.toggle('is-free', mode === 'free');
    var title = mode === 'free' ? 'Paid in full' : 'Debt-free in';
    if (els.title.textContent !== title) els.title.textContent = title;
    if (mode === 'free') {
      var tag = 'Since ' + dMonthYear.format(new Date(freeAt));
      if (els.tag.textContent !== tag) els.tag.textContent = tag;
    }
    var canShare = ticking && !state.example;
    if (els.share.hidden === canShare) els.share.hidden = !canShare;
    if (mode === 'free') els.shareText.textContent = 'Share that I’m debt-free';
    else if (mode === 'count') els.shareText.textContent = 'Share my countdown';
    if (ticking) {
      var diff = (mode === 'count' ? E.calendarDiff(now, snap.payoffAt) : E.calendarDiff(freeAt, now)) || ZERO_DIFF;
      els.y.textContent = pad2(diff.years);
      els.m.textContent = pad2(diff.months);
      els.d.textContent = pad2(diff.days);
      els.t.textContent = pad2(diff.hours) + ':' + pad2(diff.minutes) + ':' + pad2(diff.seconds);
      els.yl.textContent = plural(diff.years, 'year', 'years');
      els.ml.textContent = plural(diff.months, 'month', 'months');
      els.dl.textContent = plural(diff.days, 'day', 'days');
    }
    if (mode === 'count') {
      els.msg.dataset.mode = 'count';
      if (force || sec % 60 === 0) {
        els.line.textContent = '';
        els.line.appendChild(document.createTextNode('Your last payment lands '));
        els.line.appendChild(h('strong', null, dLong.format(new Date(snap.payoffAt))));
        els.line.appendChild(document.createTextNode('. You’ll pay ' + fmt0.format(plan.totalInterest) + ' more in interest before then.'));
        var skipped = uncountedNames();
        if (skipped.length) els.line.appendChild(document.createTextNode(' Not counted: ' + skipped.join(', ') + '.'));
        els.cd.setAttribute('aria-label', 'Debt-free in ' + diff.years + ' years, ' + diff.months + ' months, ' + diff.days + ' days');
      }
    } else if (force || els.msg.dataset.mode !== mode || (mode === 'free' && els.msg.dataset.since !== String(freeAt))) {
      var arriving = els.msg.dataset.mode !== mode;
      els.msg.dataset.mode = mode;
      els.msg.className = 'cd-message ' + mode;
      els.msg.removeAttribute('title');
      els.line.textContent = '';
      if (mode === 'never') {
        els.msg.textContent = 'NEVER';
        els.line.textContent = 'At these payments, at least one debt grows every month. Raise its payment, or choose a plan and add extra.';
      } else if (mode === 'free') {
        els.msg.dataset.since = String(freeAt);
        els.msg.textContent = 'DEBT-FREE';
        els.msg.title = 'Celebrate again';
        els.line.appendChild(document.createTextNode('Your last payment landed '));
        els.line.appendChild(h('strong', null, dLong.format(new Date(freeAt))));
        els.line.appendChild(document.createTextNode('. Every debt in your countdown is paid off, and this clock now counts how long you’ve stayed debt-free.'));
        var still = uncountedNames();
        if (still.length) els.line.appendChild(document.createTextNode(' Still on its own schedule: ' + still.join(', ') + '.'));
        els.cd.setAttribute('aria-label', 'Debt-free since ' + dLong.format(new Date(freeAt)));
        if (arriving) maybeCelebrate(freeAt);
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

  // ---------- backup and restore ----------
  // The numbers live only in this browser, so a backup file is how they survive a cleared
  // browser or move to another device. Saving is Pro; restoring works for anyone, and a Pro
  // backup carries the license key so Pro comes along (using one of the key's device slots).
  var B = window.DFCBackup;
  var BACKUP_KEY = 'debt-free-clock:backup';   // when this browser last saved a backup
  var pendingRestore = null, undoRestore = null;
  var RESTORE_ERRORS = {
    'not-json': 'That file isn’t a Debt-Free Clock backup. Backups are .json files named like debt-free-clock-backup-2026-10-12.json.',
    'not-backup': 'That file isn’t a Debt-Free Clock backup. Backups are .json files named like debt-free-clock-backup-2026-10-12.json.',
    'newer': 'That backup is from a newer version of Debt-Free Clock. Refresh this page, then try again.'
  };

  function lastBackupAt() {
    try { var v = +window.localStorage.getItem(BACKUP_KEY); return v > 0 ? v : null; } catch (e) { return null; }
  }
  function backupMsg(kind, text) {
    var el = $('backup-msg');
    el.className = 'safety-msg' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }
  function renderBackup() {
    $('backup-pro-tag').hidden = proActive();
    var at = lastBackupAt();
    $('backup-sub').textContent = at ? 'Last backup ' + dShort.format(new Date(at)) : 'No backup saved yet';
    renderInstall();
  }

  function downloadText(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  $('backup-save').addEventListener('click', function () {
    if (!proActive()) {
      backupMsg('', 'Saving backups is part of Pro. You can unlock it in the Payoff plan.');
      $('plan').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    var now = Date.now(), name = B.fileName(now);
    var text = B.makeBackup(state, pro, now);
    var done = function () {
      try { window.localStorage.setItem(BACKUP_KEY, String(now)); } catch (e) { /* ignore */ }
      renderBackup();
      backupMsg('good', 'Saved ' + name + '. Keep it somewhere safe, like your Files app or cloud storage.');
    };
    // Phones: the share sheet's "Save to Files" works where plain downloads don't (an
    // installed iPhone app, for one). Computers: an ordinary download.
    var file = null, viaShare = false;
    try {
      file = new File([text], name, { type: 'application/json' });
      viaShare = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches &&
        navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) { viaShare = false; }
    if (viaShare) {
      navigator.share({ files: [file], title: 'Debt-Free Clock backup' }).then(done, function (err) {
        if (err && err.name === 'AbortError') return;
        downloadText(text, name); done();
      });
    } else {
      downloadText(text, name); done();
    }
  });

  $('backup-restore').addEventListener('click', function () {
    var input = $('backup-file');
    input.value = '';
    input.click();
  });

  $('backup-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (f.size > 2000000) { backupMsg('error', RESTORE_ERRORS['not-backup']); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var r = B.readBackup(reader.result);
      if (!r.ok) { backupMsg('error', RESTORE_ERRORS[r.reason] || RESTORE_ERRORS['not-backup']); return; }
      backupMsg('', '');
      pendingRestore = r;
      var parts = [r.debts + ' ' + plural(r.debts, 'debt', 'debts'), r.assets + ' ' + plural(r.assets, 'asset', 'assets')];
      if (r.proKey && gating && !pro) parts.push('includes Pro');
      $('restore-what').textContent = (r.savedAt ? 'Saved ' + dLong.format(new Date(r.savedAt)) : 'A Debt-Free Clock backup') + ' · ' + parts.join(' · ');
      openDialog($('restore-dlg'));
    };
    reader.onerror = function () { backupMsg('error', 'Couldn’t read that file. Try saving the backup again.'); };
    reader.readAsText(f);
  });

  function openDialog(dlg) { if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); }
  function closeDialog(dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

  $('restore-cancel').addEventListener('click', function () { pendingRestore = null; closeDialog($('restore-dlg')); });
  $('restore-dlg').addEventListener('click', function (e) { if (e.target === this) { pendingRestore = null; closeDialog(this); } });
  $('restore-go').addEventListener('click', function () {
    var r = pendingRestore;
    pendingRestore = null;
    closeDialog($('restore-dlg'));
    if (!r) return;
    var before = state;
    state = r.state;
    recompute();                       // the roll-forward below needs this state's own schedule
    update(null, { lists: true });     // rolls an older backup forward to today, then saves
    lastRemoved = null;
    undoRestore = before;
    showToast('Restored your backup' + (r.savedAt ? ' from ' + dShort.format(new Date(r.savedAt)) : '') + '.', true);
    if (r.proKey && gating && !pro) restorePro(r.proKey);
  });

  function restorePro(key) {
    if (PREVIEW) { grant(key, 'preview'); return; }
    backupMsg('', 'Bringing your Pro unlock over…');
    L.activate(CFG, key, L.instanceName(navigator.userAgent), window.fetch.bind(window)).then(function (res) {
      if (res.ok) {
        grant(key, res.instanceId);
        backupMsg('good', 'Your numbers and Pro are restored on this device.');
      } else {
        $('license-key').value = key;
        $('have-key').open = true;
        backupMsg('error', 'Your numbers are restored, but Pro couldn’t be confirmed. ' + (KEY_ERRORS[res.reason] || KEY_ERRORS.rejected) + ' Your key is filled in under the Payoff plan so you can try again.');
      }
    });
  }

  // ---------- install as an app ----------
  // A home-screen icon that opens full screen and works offline (the service worker, sw.js,
  // keeps a copy of the page). Chrome, Edge and Android offer a real install prompt; iPhone
  // and Mac Safari get instructions instead.
  var installEvt = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(ua);

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function renderInstall() {
    var row = $('install-row'), help = $('install-help'), btn = $('install-btn');
    var text = null;
    if (PREVIEW || isStandalone()) text = null;
    else if (installEvt) text = 'It opens in its own window, like an app, and works without a connection.';
    else if (isIOS) text = 'Tap the Share button, then “Add to Home Screen.” The home-screen app keeps its own copy of your numbers, so '
      + (proActive() ? 'save a backup here first, then restore it in the app.' : 'you’ll enter them there.');
    else if (isMacSafari) text = 'In Safari, choose File › Add to Dock. It opens like an app and works without a connection.';
    row.hidden = !text;
    btn.hidden = !installEvt;
    if (text) help.textContent = text;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();          // show our own button instead of the browser's mini-bar
    installEvt = e;
    renderInstall();
  });
  window.addEventListener('appinstalled', function () {
    installEvt = null;
    renderInstall();
    showToast('Installed. Look for Debt-Free Clock with your apps.', false);
  });
  $('install-btn').addEventListener('click', function () {
    if (!installEvt) return;
    var e = installEvt;
    e.prompt();
    (e.userChoice || Promise.resolve()).then(function () { installEvt = null; renderInstall(); });
  });

  if ('serviceWorker' in navigator && !PREVIEW &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline copy is a bonus */ });
  }

  // ---------- boot ----------
  recompute();
  var moved = E.rebase(state, plan, Date.now());
  if (moved !== state) { state = moved; recompute(); }
  save();
  renderLists();
  renderDerived();
  requestAnimationFrame(frame);
  recheckPro();
})();
