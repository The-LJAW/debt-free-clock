const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/license.js');

const cfg = {
  checkoutUrl: 'https://example.lemonsqueezy.com/buy/abc',
  storeId: 111,
  productIds: [222, 333],
  apiBase: 'https://api.lemonsqueezy.com/v1/licenses',
};
const meta = (over) => Object.assign({ store_id: 111, product_id: 222, variant_id: 5 }, over);
const KEY = '38b1460a-5104-4067-a91d-77b872934d51';

test('normalizes pasted keys and recognises their shape', () => {
  assert.equal(L.normalizeKey('  38B1460A-5104-4067-\nA91D-77B872934D51 '), '38B1460A-5104-4067-A91D-77B872934D51');
  assert.equal(L.normalizeKey('"' + KEY + '"'), KEY);
  assert.equal(L.normalizeKey('“' + KEY + '”'), KEY);
  assert.ok(L.looksLikeKey(KEY));
  assert.ok(!L.looksLikeKey(''));
  assert.ok(!L.looksLikeKey('hello'));
  assert.ok(!L.looksLikeKey('not a key at all!!'));
});

test('the lock stays off until checkout link and store are set', () => {
  assert.equal(L.isConfigured({ checkoutUrl: '', storeId: null }), false);
  assert.equal(L.isConfigured({ checkoutUrl: 'https://x', storeId: null }), false);
  assert.equal(L.isConfigured({ checkoutUrl: '', storeId: 5 }), false);
  assert.equal(L.isConfigured(cfg), true);
});

test('keys must come from our store and a listed product', () => {
  assert.ok(L.productMatches(meta(), cfg));
  assert.ok(L.productMatches(meta({ product_id: 333 }), cfg));
  assert.ok(L.productMatches(meta({ store_id: '111', product_id: '222' }), cfg));
  assert.ok(!L.productMatches(meta({ store_id: 999 }), cfg));
  assert.ok(!L.productMatches(meta({ product_id: 444 }), cfg));
  assert.ok(!L.productMatches(null, cfg));
  assert.ok(L.productMatches(meta({ product_id: 444 }), Object.assign({}, cfg, { productIds: [] })));
});

test('reads a successful activation', () => {
  const r = L.readActivation(200, {
    activated: true, error: null,
    license_key: { status: 'active', key: KEY, activation_limit: 5, activation_usage: 1 },
    instance: { id: 'f90ec370-fd83-46a5-8bbd-44a241e78665', name: 'Test' },
    meta: meta(),
  }, cfg);
  assert.deepEqual(r, { ok: true, instanceId: 'f90ec370-fd83-46a5-8bbd-44a241e78665' });
});

test('explains failed activations', () => {
  const cases = [
    [0, null, 'network'],
    [404, { activated: false, error: 'license_key not found.' }, 'not-found'],
    [400, { activated: false, error: 'This license key has reached the activation limit.' }, 'limit'],
    [400, { activated: false, error: 'This license key is disabled.', license_key: { status: 'disabled' } }, 'disabled'],
    [400, { activated: false, error: 'This license key has expired.' }, 'expired'],
    [429, { error: 'Too many requests' }, 'busy'],
    [503, null, 'server'],
    [422, { error: 'The given data was invalid.' }, 'rejected'],
  ];
  for (const [status, body, reason] of cases) {
    assert.deepEqual(L.readActivation(status, body, cfg), { ok: false, reason }, `${status} ${reason}`);
  }
  const other = L.readActivation(200, { activated: true, instance: { id: 'x' }, meta: meta({ product_id: 999 }) }, cfg);
  assert.deepEqual(other, { ok: false, reason: 'wrong-product' });
});

test('validation only locks on a clear "no"', () => {
  const ok = { valid: true, error: null, license_key: { status: 'active' }, meta: meta() };
  assert.deepEqual(L.readValidation(200, ok, cfg), { state: 'valid' });
  assert.deepEqual(L.readValidation(200, Object.assign({}, ok, { license_key: { status: 'disabled' } }), cfg), { state: 'invalid', reason: 'disabled' });
  assert.deepEqual(L.readValidation(404, { valid: false, error: 'license_key not found.' }, cfg), { state: 'invalid', reason: 'not-found' });
  assert.deepEqual(L.readValidation(200, Object.assign({}, ok, { meta: meta({ store_id: 7 }) }), cfg), { state: 'invalid', reason: 'wrong-product' });
  // Offline, rate-limited, server errors and odd replies keep the current state.
  assert.deepEqual(L.readValidation(0, null, cfg), { state: 'unknown' });
  assert.deepEqual(L.readValidation(429, { valid: false }, cfg), { state: 'unknown' });
  assert.deepEqual(L.readValidation(502, null, cfg), { state: 'unknown' });
  assert.deepEqual(L.readValidation(400, { message: 'odd' }, cfg), { state: 'unknown' });
});

test('re-checks a key every couple of weeks', () => {
  const now = Date.UTC(2026, 8, 22);
  assert.equal(L.isDue({ checkedAt: now - 3 * 86400000 }, now, 14), false);
  assert.equal(L.isDue({ checkedAt: now - 15 * 86400000 }, now, 14), true);
  assert.equal(L.isDue({}, now, 14), true);
});

test('masks keys and names device slots', () => {
  assert.equal(L.maskKey(KEY), '••••4D51');
  assert.equal(L.instanceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'Debt-Free Clock · Chrome on Mac');
  assert.equal(L.instanceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Debt-Free Clock · Safari on iPhone');
});

test('sends the right request to Lemon Squeezy', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return { status: 200, json: async () => ({ activated: true, instance: { id: 'inst-1' }, meta: meta() }) };
  };
  const r = await L.activate(cfg, KEY, 'Debt-Free Clock · Chrome on Mac', fakeFetch);
  assert.deepEqual(r, { ok: true, instanceId: 'inst-1' });
  assert.equal(seen.url, 'https://api.lemonsqueezy.com/v1/licenses/activate');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(seen.init.body);
  assert.equal(params.get('license_key'), KEY);
  assert.equal(params.get('instance_name'), 'Debt-Free Clock · Chrome on Mac');
});

test('a dropped connection reads as offline, not as a bad key', async () => {
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await L.activate(cfg, KEY, 'x', failing), { ok: false, reason: 'network' });
  assert.deepEqual(await L.validate(cfg, KEY, 'inst', failing), { state: 'unknown' });
  assert.deepEqual(await L.deactivate(cfg, KEY, 'inst', failing), { ok: false, reachable: false });
  const html = async () => ({ status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  assert.deepEqual(await L.validate(cfg, KEY, 'inst', html), { state: 'unknown' });
});

test('deactivation frees the slot, and an already-gone instance counts as done', async () => {
  const ok = async () => ({ status: 200, json: async () => ({ deactivated: true }) });
  const gone = async () => ({ status: 404, json: async () => ({ deactivated: false, error: 'license_key instance not found.' }) });
  assert.deepEqual(await L.deactivate(cfg, KEY, 'inst', ok), { ok: true, reachable: true });
  assert.deepEqual(await L.deactivate(cfg, KEY, 'inst', gone), { ok: true, reachable: true });
});
