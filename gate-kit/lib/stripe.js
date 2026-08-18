const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set (see .env.example)');
}

// Always instantiate a client and call methods on it — never the deprecated
// global `stripe.apiKey = ...` pattern.
module.exports = new Stripe(process.env.STRIPE_SECRET_KEY);
