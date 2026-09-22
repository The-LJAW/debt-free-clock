/*
 * Debt-Free Clock — Pro license checks against the Lemon Squeezy License API.
 *
 * The site has no server, so the browser talks to Lemon Squeezy directly:
 *   activate   -> when someone pastes their key (uses one of the key's device slots)
 *   validate   -> every couple of weeks, to catch refunds or disabled keys
 *   deactivate -> "Remove from this browser" (frees the slot)
 * Only the license key and an instance id are sent; debt numbers never leave the page.
 *
 * Like any unlock that runs entirely in the browser, a determined person can bypass
 * it. The goal is an easy, honest way to pay, not copy protection.
 */
(function (root) {
  'use strict';

  var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{14,62}[A-Za-z0-9]$/;
  var TIMEOUT_MS = 12000;

  /** Strip spaces, line breaks and stray quotes people pick up when copying from email. */
  function normalizeKey(input) {
    return String(input == null ? '' : input).replace(/\s+/g, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  }

  function looksLikeKey(key) { return KEY_RE.test(key); }

  function isConfigured(cfg) {
    return !!(cfg && cfg.checkoutUrl && cfg.storeId != null && cfg.storeId !== '');
  }

  /** The key must come from our store and (when listed) one of our Pro products. */
  function productMatches(meta, cfg) {
    if (!meta || !cfg) return false;
    if (cfg.storeId != null && cfg.storeId !== '' && Number(meta.store_id) !== Number(cfg.storeId)) return false;
    var ids = (cfg.productIds || []).map(Number);
    if (ids.length && ids.indexOf(Number(meta.product_id)) === -1) return false;
    return true;
  }

  function classify(status, error, lk) {
    var err = String(error || '');
    if (/activation limit/i.test(err)) return 'limit';
    if (lk && lk.status === 'disabled') return 'disabled';
    if ((lk && lk.status === 'expired') || /expired/i.test(err)) return 'expired';
    if (status === 404 || /not found/i.test(err)) return 'not-found';
    if (status === 429) return 'busy';
    if (status >= 500) return 'server';
    return 'rejected';
  }

  /**
   * Read an activate response. `status` is the HTTP status (0 = no response).
   * @returns {ok:true, instanceId} | {ok:false, reason}
   */
  function readActivation(status, body, cfg) {
    if (!status) return { ok: false, reason: 'network' };
    body = body || {};
    if (body.activated === true && body.instance && body.instance.id) {
      if (!productMatches(body.meta, cfg)) return { ok: false, reason: 'wrong-product' };
      return { ok: true, instanceId: String(body.instance.id) };
    }
    return { ok: false, reason: classify(status, body.error, body.license_key) };
  }

  /**
   * Read a validate response.
   * @returns {state:'valid'} | {state:'invalid', reason} | {state:'unknown'}
   * 'unknown' (offline, rate limit, server trouble, odd reply) never locks a paying user out.
   */
  function readValidation(status, body, cfg) {
    if (!status || status === 429 || status >= 500 || !body || typeof body.valid !== 'boolean') {
      return { state: 'unknown' };
    }
    if (body.valid) {
      if (!productMatches(body.meta, cfg)) return { state: 'invalid', reason: 'wrong-product' };
      var st = body.license_key && body.license_key.status;
      if (st === 'disabled' || st === 'expired') return { state: 'invalid', reason: st };
      return { state: 'valid' };
    }
    return { state: 'invalid', reason: classify(status, body.error, body.license_key) };
  }

  function isDue(pro, now, days) {
    return !pro || !pro.checkedAt || now - pro.checkedAt > (days || 14) * 86400000;
  }

  function maskKey(key) {
    var k = String(key || '');
    return '••••' + k.slice(-4).toUpperCase();
  }

  /** A readable label for the device slot, e.g. "Debt-Free Clock · Chrome on Mac". */
  function instanceName(ua) {
    ua = String(ua || '');
    var browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
    return 'Debt-Free Clock · ' + browser + ' on ' + os;
  }

  function post(cfg, path, params, fetchImpl) {
    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return Promise.resolve()
      .then(function () {
        return fetchImpl(cfg.apiBase + path, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body,
          signal: ctrl ? ctrl.signal : undefined
        });
      })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; },
          function () { return { status: r.status, body: null }; });
      })
      .catch(function () { return { status: 0, body: null }; })
      .then(function (res) { if (timer) clearTimeout(timer); return res; });
  }

  function activate(cfg, key, name, fetchImpl) {
    return post(cfg, '/activate', { license_key: key, instance_name: name }, fetchImpl)
      .then(function (res) { return readActivation(res.status, res.body, cfg); });
  }

  function validate(cfg, key, instanceId, fetchImpl) {
    return post(cfg, '/validate', { license_key: key, instance_id: instanceId }, fetchImpl)
      .then(function (res) { return readValidation(res.status, res.body, cfg); });
  }

  function deactivate(cfg, key, instanceId, fetchImpl) {
    return post(cfg, '/deactivate', { license_key: key, instance_id: instanceId }, fetchImpl)
      .then(function (res) {
        var b = res.body || {};
        return { ok: b.deactivated === true || res.status === 404, reachable: res.status !== 0 };
      });
  }

  var api = {
    normalizeKey: normalizeKey, looksLikeKey: looksLikeKey, isConfigured: isConfigured,
    productMatches: productMatches, readActivation: readActivation, readValidation: readValidation,
    isDue: isDue, maskKey: maskKey, instanceName: instanceName,
    activate: activate, validate: validate, deactivate: deactivate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFCLicense = api;
})(this);
