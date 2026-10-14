/*
 * Pro unlock settings. Fill these in from Lemon Squeezy once the Pro product exists.
 *
 * Until checkoutUrl and storeId are both set, the Pro lock is OFF and everyone gets the
 * full planner, so uploading this code before the store is ready can't break the live site.
 */
window.DFC_PRO = {
  price: '$9',
  // The product's checkout link (Lemon Squeezy: Products > Pro unlock > Share).
  checkoutUrl: 'https://debt-free-clock.lemonsqueezy.com/checkout/buy/be6d8c30-f671-4d7e-a518-1fb76c81c7b3',
  // Your store's ID number (Lemon Squeezy: Settings > Stores).
  storeId: 496349,
  // The Pro product's ID. List both the test-mode and live-mode IDs while testing.
  productIds: [1440546], // live product (the test-mode product, 1434381, no longer unlocks)
  apiBase: 'https://api.lemonsqueezy.com/v1/licenses',
  // How often a browser re-checks its key (catches refunds). Offline never locks anyone out.
  recheckDays: 14
};
