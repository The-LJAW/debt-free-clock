/*
 * Debt-Free Clock — backup files.
 *
 * A backup is a small JSON file the person saves themselves (the site has no server, so
 * this is the only way to keep numbers safe or move them to another device). It holds the
 * clock's state and, for Pro users, the license key so Pro can come along too.
 *
 * readBackup() never trusts the file: it rebuilds a clean state from known fields only,
 * clamps every number to what the editors allow, and rejects anything that isn't ours.
 * Pure functions, no DOM: runs in Node for tests.
 */
(function (root) {
  'use strict';

  var APP = 'debt-free-clock';
  var VERSION = 1;
  var MAX_ITEMS = 200;
  var METHODS = { minimums: true, avalanche: true, snowball: true };
  var YM = /^\d{4}-(0[1-9]|1[0-2])$/;      // 'YYYY-MM'

  function num(v, lo, hi, fallback) {
    var n = Number(v);
    if (v === null || v === '' || typeof v === 'boolean' || !isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }
  function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function time(v) { var n = Number(v); return v != null && isFinite(n) && n > 0 ? n : null; }

  function makeId(prefix, seen) {
    var id;
    do { id = prefix + Math.random().toString(36).slice(2, 9); } while (seen[id]);
    return id;
  }
  function cleanId(v, prefix, seen) {
    var id = typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) && !seen[v] ? v : makeId(prefix, seen);
    seen[id] = true;
    return id;
  }

  /** The file's text. `pro` is { key } for Pro users, or null. */
  function makeBackup(state, pro, now) {
    var out = { app: APP, kind: 'backup', version: VERSION, savedAt: now, state: state };
    if (pro && pro.key) out.pro = { key: String(pro.key) };
    return JSON.stringify(out, null, 2);
  }

  /** debt-free-clock-backup-2026-10-12.json (local date) */
  function fileName(now) {
    var d = new Date(now);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'debt-free-clock-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
  }

  /**
   * Read a backup file's text.
   * @returns {ok:true, state, savedAt, proKey, debts, assets} | {ok:false, reason}
   *   reasons: 'not-json' | 'not-backup' | 'newer'
   */
  function readBackup(raw) {
    var data;
    try { data = JSON.parse(String(raw == null ? '' : raw).replace(/^﻿/, '')); } catch (e) { return { ok: false, reason: 'not-json' }; }
    if (!data || typeof data !== 'object' || data.app !== APP || data.kind !== 'backup') return { ok: false, reason: 'not-backup' };
    if (num(data.version, 0, 1e9, 0) > VERSION) return { ok: false, reason: 'newer' };
    var s = data.state;
    if (!s || typeof s !== 'object' || !Array.isArray(s.debts) || !Array.isArray(s.assets) || !time(s.asOf)) {
      return { ok: false, reason: 'not-backup' };
    }

    var seen = {};
    var debts = s.debts.slice(0, MAX_ITEMS).filter(function (d) { return d && typeof d === 'object'; }).map(function (d) {
      var out = {
        id: cleanId(d.id, 'd', seen),
        name: text(d.name, 40),
        balance: num(d.balance, 0, 1e12, 0),
        apr: num(d.apr, 0, 100, 0),
        payment: num(d.payment, 0, 1e12, 0)
      };
      if (d.inCountdown === false) out.inCountdown = false;
      if (d.cheered === true) out.cheered = true;
      var paid = time(d.paidOffAt);
      if (paid && out.balance <= 0.005) out.paidOffAt = paid;
      return out;
    });
    var assets = s.assets.slice(0, MAX_ITEMS).filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
      return {
        id: cleanId(a.id, 'a', seen),
        name: text(a.name, 40),
        value: num(a.value, 0, 1e12, 0),
        rate: num(a.rate, -50, 50, 0),
        contribution: num(a.contribution, 0, 1e12, 0)
      };
    });
    var plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
    var cleanPlan = { method: METHODS[plan.method] ? plan.method : 'minimums', extra: num(plan.extra, 0, 1e6, 0) };
    if (Array.isArray(plan.lumps)) {
      cleanPlan.lumps = plan.lumps.slice(0, 50).filter(function (l) { return l && typeof l === 'object' && YM.test(l.ym); }).map(function (l) {
        var out = { id: cleanId(l.id, 'l', seen), ym: l.ym, amount: num(l.amount, 0, 1e9, 0), note: text(l.note, 40) };
        if (l.done === true) { out.done = true; var at = time(l.doneAt); if (at) out.doneAt = at; }
        return out;
      });
    }
    if (YM.test(plan.goal)) cleanPlan.goal = plan.goal;
    var state = {
      v: 1,
      example: s.example === true,
      asOf: time(s.asOf),
      debts: debts,
      assets: assets,
      plan: cleanPlan
    };
    var pr = s.progress;
    if (pr && typeof pr === 'object' && time(pr.since)) {
      state.progress = {
        since: time(pr.since), paid: num(pr.paid, 0, 1e12, 0), avoided: num(pr.avoided, 0, 1e12, 0),
        cheers: Array.isArray(pr.cheers) ? [25, 50, 75].filter(function (c) { return pr.cheers.indexOf(c) >= 0; }) : []
      };
    }
    var celebrated = time(s.celebratedFor);
    if (celebrated) state.celebratedFor = celebrated;

    var proKey = data.pro && typeof data.pro.key === 'string' ? data.pro.key.trim().slice(0, 64) : null;
    return { ok: true, state: state, savedAt: time(data.savedAt), proKey: proKey || null, debts: debts.length, assets: assets.length };
  }

  var api = { VERSION: VERSION, makeBackup: makeBackup, readBackup: readBackup, fileName: fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFCBackup = api;
})(this);
