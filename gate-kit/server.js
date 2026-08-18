// Gate + checkout kit — this is what a designer would run (or what we'd host
// for them, per the build plan's "Option 1: hosted" recommendation).
//
// STRIPE CONNECT NOTE: payment is mocked below. In production, "connect stripe"
// triggers a real OAuth flow (`stripe.oauth.token(...)`), purchase creates a
// PaymentIntent with `transfer_data.destination` set to the seller's connected
// account, and a webhook (`payment_intent.succeeded`) is what actually flips
// the transaction to "completed" and issues the download token — not the
// synchronous request/response used here. Everything else (schema shape,
// route structure, signed-download pattern) is production-shaped.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'seed.json');
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// In-memory download tokens: token -> { component_id, expires_at }
const downloadTokens = new Map();

const app = express();
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

app.post('/api/purchase', (req, res) => {
  const { component_id, buyer_token, confirmed_by_human } = req.body || {};
  if (!confirmed_by_human) {
    return res.status(400).json({ error: 'human_confirmation_required' });
  }
  if (!buyer_token) {
    return res.status(400).json({ error: 'missing_buyer_token' });
  }
  const data = loadData();
  const c = data.components.find((x) => x.component_id === component_id);
  if (!c) return res.status(404).json({ error: 'not_found' });

  // Mocked payment. Real version: create a Stripe PaymentIntent against
  // data.stripe_connect.connected_account_id, wait for webhook confirmation.
  const transaction_id = 'txn_' + crypto.randomBytes(4).toString('hex');
  const download_token = 'dl_' + crypto.randomBytes(8).toString('hex');
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

  downloadTokens.set(download_token, { component_id, expires_at });

  c.sold_count = (c.sold_count || 0) + 1;
  data.sales.push({
    transaction_id,
    component_id,
    amount_usd: c.price_usd,
    buyer_token,
    at: new Date().toISOString(),
  });
  saveData(data);

  res.json({
    transaction_id,
    status: 'completed',
    component_id,
    amount_charged_usd: c.price_usd,
    asset_download: { access_token: download_token, expires_at },
  });
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
