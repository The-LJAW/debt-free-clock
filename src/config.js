/*
 * Pro unlock settings. Fill these in from Lemon Squeezy once the Pro product exists.
 *
 * Until checkoutUrl and storeId are both set, the Pro lock is OFF and everyone gets the
 * full planner, so uploading this code before the store is ready can't break the live site.
 */
window.DFC_PRO = {
  price: '$9',
  // The product's checkout link (Lemon Squeezy: Products > Pro unlock > Share).
  checkoutUrl: '',
  // Your store's ID number (Lemon Squeezy: Settings > Stores).
  storeId: null,
  // The Pro product's ID. List both the test-mode and live-mode IDs while testing.
  productIds: [],
  apiBase: 'https://api.lemonsqueezy.com/v1/licenses',
  // How often a browser re-checks its key (catches refunds). Offline never locks anyone out.
  recheckDays: 14
};
