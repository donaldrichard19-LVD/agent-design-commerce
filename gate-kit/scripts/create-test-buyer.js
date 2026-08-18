// Dev/test helper only. Registers a buyer_token against a real Stripe test
// Customer with a saved test card (pm_card_visa), so purchase_component can
// exercise a genuine off-session PaymentIntent end to end. In production this
// is replaced by a one-time Stripe Checkout Session in `setup` mode that the
// buyer completes in a browser before an agent can purchase on their behalf.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const stripe = require('../lib/stripe');
const { registerBuyer } = require('../lib/buyers');

async function main() {
  const buyerToken = process.argv[2] || 'tok_dev_9f1a';

  const customer = await stripe.customers.create({
    email: `${buyerToken}@example.com`,
    name: 'Test Buyer',
    metadata: { buyer_token: buyerToken },
  });
  const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  });

  registerBuyer(buyerToken, {
    stripeCustomerId: customer.id,
    stripePaymentMethodId: paymentMethod.id,
  });

  console.log(`registered buyer_token=${buyerToken} -> customer=${customer.id} payment_method=${paymentMethod.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
