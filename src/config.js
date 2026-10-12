/*
 * Pro unlock settings. Fill these in from Lemon Squeezy once the Pro product exists.
 *
 * Until checkoutUrl and storeId are both set, the Pro lock is OFF and everyone gets the
 * full planner, so uploading this code before the store is ready can't break the live site.
 */
window.DFC_PRO = {
  price: '$9',
  // The product's checkout link (Lemon Squeezy: Products > Pro unlock > Share).
  checkoutUrl: 'https://debt-free-clock.lemonsqueezy.com/checkout/buy/1fab363d-8c42-4af7-aa34-8b954b9079c1',
  // Your store's ID number (Lemon Squeezy: Settings > Stores).
  storeId: 496349,
  // The Pro product's ID. List both the test-mode and live-mode IDs while testing.
  productIds: [1434381], // test-mode product; swap for the live product ID at launch
  apiBase: 'https://api.lemonsqueezy.com/v1/licenses',
  // How often a browser re-checks its key (catches refunds). Offline never locks anyone out.
  recheckDays: 14
};
