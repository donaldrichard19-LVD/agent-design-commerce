// Maps the protocol's opaque buyer_token to a real Stripe Customer + saved
// payment method. The purchase protocol is machine-to-machine (an agent
// calls purchase_component, there's no browser for the buyer to enter a
// card at that moment) — so a payment method has to be saved once, out of
// band, via scripts/create-test-buyer.js (test mode) or a real Checkout
// Session in `setup` mode (production). See P1 requirements, workstream 1.
const fs = require('fs');
const path = require('path');

const BUYERS_PATH = path.join(__dirname, '..', 'data', 'buyers.json');

function loadBuyers() {
  if (!fs.existsSync(BUYERS_PATH)) return {};
  return JSON.parse(fs.readFileSync(BUYERS_PATH, 'utf8'));
}

function saveBuyers(buyers) {
  fs.writeFileSync(BUYERS_PATH, JSON.stringify(buyers, null, 2));
}

function getBuyer(buyerToken) {
  const buyers = loadBuyers();
  return buyers[buyerToken] || null;
}

function registerBuyer(buyerToken, { stripeCustomerId, stripePaymentMethodId }) {
  const buyers = loadBuyers();
  buyers[buyerToken] = {
    stripe_customer_id: stripeCustomerId,
    stripe_payment_method_id: stripePaymentMethodId,
    registered_at: new Date().toISOString(),
  };
  saveBuyers(buyers);
}

module.exports = { loadBuyers, saveBuyers, getBuyer, registerBuyer };
