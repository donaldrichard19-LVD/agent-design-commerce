// Gate + checkout kit — this is what a designer would run (or what we'd host
// for them, per the build plan's "Option 1: hosted" recommendation).
//
// P1: real Stripe Connect. Connected-account onboarding uses the v2 Accounts
// API + Account Links (the legacy OAuth `stripe.oauth.token()` flow the P0
// prototype's comment described is deprecated — platforms must use v2 now).
// Purchases create a real destination-charge PaymentIntent against a saved
// buyer payment method (off_session), and completion — the download token,
// the sale record, sold_count — is only ever written by the
// payment_intent.succeeded webhook handler, never by the request/response
// cycle itself. POST /api/purchase waits briefly for that webhook to land
// (webhooks fire in well under a second against Stripe's test-mode CLI
// forwarder) so the existing purchase_component -> get_asset MCP contract
// still works in the common case; GET /api/purchase/:id is the fallback for
// an agent to poll if it doesn't land in time.
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stripe = require('./lib/stripe');
const { getBuyer } = require('./lib/buyers');

const DATA_PATH = path.join(__dirname, 'data', 'seed.json');
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS || 0);
const PURCHASE_WAIT_MS = Number(process.env.PURCHASE_WAIT_MS || 5000);
const PURCHASE_POLL_INTERVAL_MS = 250;

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// In-memory download tokens: token -> { component_id, expires_at }
const downloadTokens = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findSaleByDedupeKey(data, dedupeKey) {
  return data.sales.find((s) => s.dedupe_key === dedupeKey);
}
function findSaleByTransactionId(data, transactionId) {
  return data.sales.find((s) => s.transaction_id === transactionId);
}

function saleResponseShape(sale) {
  const base = {
    transaction_id: sale.transaction_id,
    status: sale.status,
    component_id: sale.component_id,
    amount_charged_usd: sale.amount_usd,
  };
  if (sale.status === 'completed') {
    base.asset_download = { access_token: sale.download_token, expires_at: sale.download_token_expires_at };
  }
  if (sale.status === 'failed') {
    base.error = sale.error || 'payment_failed';
  }
  if (sale.status === 'pending') {
    base.message = 'Payment is awaiting confirmation. Poll GET /api/purchase/:transaction_id, or retry the same purchase request (it is idempotent).';
    base.poll_url = `${BASE_URL}/api/purchase/${sale.transaction_id}`;
  }
  return base;
}

// This is what actually completes a sale — called only from the verified
// payment_intent.succeeded webhook, never from the purchase request itself.
function completeSale(transactionId) {
  const data = loadData();
  const sale = findSaleByTransactionId(data, transactionId);
  if (!sale) return; // webhook for a PaymentIntent we don't know about — ignore
  if (sale.status === 'completed') return; // already handled (webhook retry) — idempotent no-op

  const c = data.components.find((x) => x.component_id === sale.component_id);
  if (!c) return;

  const download_token = 'dl_' + crypto.randomBytes(8).toString('hex');
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
  downloadTokens.set(download_token, { component_id: sale.component_id, expires_at });

  sale.status = 'completed';
  sale.download_token = download_token;
  sale.download_token_expires_at = expires_at;
  sale.completed_at = new Date().toISOString();
  c.sold_count = (c.sold_count || 0) + 1;
  saveData(data);
}

function failSale(transactionId, error) {
  const data = loadData();
  const sale = findSaleByTransactionId(data, transactionId);
  if (!sale || sale.status === 'completed') return; // don't clobber a completed sale
  sale.status = 'failed';
  sale.error = error;
  sale.failed_at = new Date().toISOString();
  saveData(data);
}

const app = express();

// ---- Webhook route MUST be mounted with a raw body parser, and BEFORE the
// global express.json() below, or Stripe's signature verification breaks. ----
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
    completeSale(event.data.object.id);
  } else if (event.type === 'payment_intent.payment_failed') {
    failSale(event.data.object.id, event.data.object.last_payment_error && event.data.object.last_payment_error.message);
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Protocol surface: what agents/the registry actually read ----

app.get('/.well-known/agent-commerce.json', (req, res) => {
  const data = loadData();
  const gated = data.components.filter((c) => c.gated);
  res.json({
    protocol_version: '0.1',
    seller: { ...data.seller, site_url: BASE_URL },
    payment: {
      processor: 'stripe',
      connected_account_id: data.stripe_connect.connected_account_id,
    },
    components: gated.map((c) => ({
      component_id: c.component_id,
      name: c.name,
      category: c.category,
      framework: c.framework,
      style_tags: c.style_tags,
      price_usd: c.price_usd,
      license_type: c.license_type,
      license_url: `${BASE_URL}/license`,
      preview_url: `${BASE_URL}/components/${c.component_id}/preview.png`,
      detail_url: `${BASE_URL}/api/components/${c.component_id}`,
      purchase_endpoint: `${BASE_URL}/api/purchase`,
    })),
    updated_at: new Date().toISOString(),
  });
});

app.get('/api/components/:id', (req, res) => {
  const data = loadData();
  const c = data.components.find((x) => x.component_id === req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json({
    component_id: c.component_id,
    full_description: c.full_description,
    dependencies: c.dependencies,
    design_tokens_used: c.design_tokens_used,
    accessibility: c.accessibility,
    code_preview_snippet: c.code_preview_snippet,
    compatibility_score: c.compatibility_score,
  });
});

app.post('/api/purchase', async (req, res) => {
  const { component_id, buyer_token, confirmed_by_human } = req.body || {};
  if (!confirmed_by_human) {
    return res.status(400).json({ error: 'human_confirmation_required' });
  }
  if (!buyer_token) {
    return res.status(400).json({ error: 'missing_buyer_token' });
  }

  let data = loadData();
  const c = data.components.find((x) => x.component_id === component_id);
  if (!c) return res.status(404).json({ error: 'not_found' });

  if (!data.stripe_connect.connected || !data.stripe_connect.connected_account_id) {
    return res.status(409).json({ error: 'seller_not_onboarded' });
  }

  const buyer = getBuyer(buyer_token);
  if (!buyer) {
    return res.status(402).json({
      error: 'buyer_payment_method_required',
      message: 'This buyer_token has no saved payment method. Run scripts/create-test-buyer.js (test mode) or complete a Checkout Session in setup mode (production) first.',
    });
  }

  // Idempotency: a retried purchase_component call with the same
  // buyer_token + component_id must not double-charge. Re-check on every
  // request, not just at PaymentIntent-creation time, since a prior attempt
  // may already be pending or completed.
  const dedupe_key = crypto.createHash('sha256').update(`${buyer_token}:${component_id}`).digest('hex');
  let sale = findSaleByDedupeKey(data, dedupe_key);

  if (!sale) {
    const amount = Math.round(c.price_usd * 100);
    const application_fee_amount = Math.round((amount * PLATFORM_FEE_BPS) / 10000);
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount,
          currency: 'usd',
          customer: buyer.stripe_customer_id,
          payment_method: buyer.stripe_payment_method_id,
          off_session: true,
          confirm: true,
          transfer_data: { destination: data.stripe_connect.connected_account_id },
          ...(application_fee_amount > 0 ? { application_fee_amount } : {}),
          metadata: { component_id, buyer_token, dedupe_key },
        },
        { idempotencyKey: dedupe_key }
      );

      sale = {
        transaction_id: pi.id,
        dedupe_key,
        component_id,
        buyer_token,
        amount_usd: c.price_usd,
        status: 'pending',
        at: new Date().toISOString(),
      };
      data.sales.push(sale);
      saveData(data);
    } catch (err) {
      // Failed/declined payments return a clean error — no partial success,
      // no sold_count bump, no download token.
      if (err.type === 'StripeCardError') {
        return res.status(402).json({
          error: 'payment_declined',
          decline_code: err.decline_code,
          message: err.message,
        });
      }
      console.error('stripe purchase error:', err.type, err.message);
      return res.status(502).json({ error: 'payment_processing_error', message: err.message });
    }
  }

  // Bounded wait for the webhook to land — completion itself only ever
  // happens inside completeSale(), called from the webhook handler above.
  const deadline = Date.now() + PURCHASE_WAIT_MS;
  while (Date.now() < deadline) {
    data = loadData();
    sale = findSaleByTransactionId(data, sale.transaction_id);
    if (sale.status !== 'pending') break;
    await sleep(PURCHASE_POLL_INTERVAL_MS);
  }

  const statusCode = sale.status === 'failed' ? 402 : sale.status === 'pending' ? 202 : 200;
  res.status(statusCode).json(saleResponseShape(sale));
});

app.get('/api/purchase/:transaction_id', (req, res) => {
  const data = loadData();
  const sale = findSaleByTransactionId(data, req.params.transaction_id);
  if (!sale) return res.status(404).json({ error: 'not_found' });
  res.json(saleResponseShape(sale));
});

app.get('/api/download/:token', (req, res) => {
  const entry = downloadTokens.get(req.params.token);
  if (!entry) return res.status(404).json({ error: 'invalid_or_used_token' });
  if (new Date(entry.expires_at) < new Date()) {
    downloadTokens.delete(req.params.token);
    return res.status(410).json({ error: 'token_expired' });
  }
  const data = loadData();
  const c = data.components.find((x) => x.component_id === entry.component_id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json({ files: c.files, install_instructions: c.install_instructions });
});

// ---- Stripe Connect onboarding (v2 Accounts + Account Links) ----

app.post('/api/stripe/connect', async (req, res) => {
  const data = loadData();
  try {
    let accountId = data.stripe_connect.connected_account_id;
    if (!accountId || accountId.startsWith('acct_mock_')) {
      const account = await stripe.v2.core.accounts.create({
        contact_email: data.seller.contact,
        display_name: data.seller.name,
        dashboard: 'express',
        defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
        identity: { country: 'us' },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      });
      accountId = account.id;
      data.stripe_connect.connected_account_id = accountId;
      data.stripe_connect.connected = false; // not active until onboarding completes
      saveData(data);
    }

    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          return_url: `${BASE_URL}/api/stripe/onboarding/return`,
          refresh_url: `${BASE_URL}/api/stripe/onboarding/refresh`,
        },
      },
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('stripe connect error:', err.type, err.message);
    res.status(502).json({ error: 'stripe_connect_error', message: err.message });
  }
});

async function refreshConnectStatus() {
  const data = loadData();
  const accountId = data.stripe_connect.connected_account_id;
  if (!accountId) return data;
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.recipient'],
  });
  const active =
    account.configuration &&
    account.configuration.recipient &&
    account.configuration.recipient.capabilities &&
    account.configuration.recipient.capabilities.stripe_balance &&
    account.configuration.recipient.capabilities.stripe_balance.stripe_transfers &&
    account.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active';
  data.stripe_connect.connected = !!active;
  saveData(data);
  return data;
}

app.get('/api/stripe/onboarding/return', async (req, res) => {
  try {
    await refreshConnectStatus();
  } catch (err) {
    console.error('refreshConnectStatus error:', err.message);
  }
  res.redirect('/');
});

app.get('/api/stripe/onboarding/refresh', async (req, res) => {
  // Account Link expired or was already used — send them through connect again.
  res.redirect('/');
});

// ---- Dashboard surface: what the designer actually uses ----

app.get('/api/dashboard', (req, res) => {
  const data = loadData();
  res.json({
    seller: data.seller,
    stripe_connect: data.stripe_connect,
    components: data.components.map((c) => ({
      component_id: c.component_id,
      name: c.name,
      category: c.category,
      framework: c.framework,
      price_usd: c.price_usd,
      gated: c.gated,
      sold_count: c.sold_count || 0,
    })),
    recent_sales: data.sales.slice(-10).reverse(),
    discovery_file_url: `${BASE_URL}/.well-known/agent-commerce.json`,
  });
});

app.post('/api/components', (req, res) => {
  const { name, category, framework, price_usd, code, install_instructions } = req.body || {};
  if (!name || !category || !framework) {
    return res.status(400).json({ error: 'missing_required_fields' });
  }
  const data = loadData();
  const component_id = 'cmp_' + crypto.randomBytes(3).toString('hex');
  data.components.push({
    component_id,
    name,
    category,
    framework,
    style_tags: [],
    price_usd: typeof price_usd === 'number' ? price_usd : 10,
    gated: true,
    sold_count: 0,
    license_type: 'non-exclusive',
    full_description: name,
    dependencies: [],
    design_tokens_used: [],
    accessibility: { wcag_level: 'unrated', keyboard_nav: false },
    code_preview_snippet: (code || '').slice(0, 200),
    compatibility_score: 0.75,
    files: [{ path: `${name.replace(/\s+/g, '')}.tsx`, content: code || '// paste component code here' }],
    install_instructions: install_instructions || '',
  });
  saveData(data);
  res.status(201).json({ component_id });
});

app.post('/api/components/:id/toggle-gate', (req, res) => {
  const data = loadData();
  const c = data.components.find((x) => x.component_id === req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  c.gated = !c.gated;
  saveData(data);
  res.json({ component_id: c.component_id, gated: c.gated });
});

app.listen(PORT, () => {
  console.log(`gate-kit running at ${BASE_URL}`);
  console.log(`discovery file: ${BASE_URL}/.well-known/agent-commerce.json`);
  console.log(`dashboard: ${BASE_URL}/`);
});
