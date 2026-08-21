// Self-serve domain submission — the "Domain submission path (simple form
// or endpoint) replaces manual edits to registry/seed-domains.json" item
// from P1 workstream 3 / the designer-onboarding acceptance criteria in
// workstream 2. A designer pastes their domain in; if it serves a
// schema-valid discovery file, it's added to seed-domains.json and picked
// up by the next scheduled crawl (crawler.js --watch) automatically.

const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { validateDiscoveryFile } = require('./lib/validate-discovery-file');
const { assertPublicHttpUrl } = require('./lib/ssrf-guard');

const SEEDS_PATH = path.join(__dirname, 'seed-domains.json');
const SCHEMA_PATH = path.join(__dirname, '..', 'protocol', 'schema', 'agent-commerce.schema.json');
const PORT = process.env.PORT || 3002;
// Dev-only escape hatch so submission can be tested against a local
// gate-kit instance without weakening the default SSRF guard.
const ALLOW_PRIVATE_SUBMIT_TARGETS = process.env.ALLOW_PRIVATE_SUBMIT_TARGETS === 'true';

function normalizeDomain(input) {
  return String(input || '').trim().replace(/\/+$/, '');
}

function loadSeeds() {
  return JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
}
function saveSeeds(seeds) {
  fs.writeFileSync(SEEDS_PATH, JSON.stringify(seeds, null, 2) + '\n');
}

async function submitDomain(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return { ok: false, status: 400, error: 'missing_domain' };
  }

  if (!ALLOW_PRIVATE_SUBMIT_TARGETS) {
    try {
      await assertPublicHttpUrl(domain);
    } catch (err) {
      return { ok: false, status: 400, error: 'invalid_domain', message: err.message };
    }
  }

  const seeds = loadSeeds();
  if (seeds.includes(domain)) {
    return { ok: false, status: 409, error: 'already_submitted' };
  }

  const discoveryUrl = `${domain}/.well-known/agent-commerce.json`;
  let doc;
  try {
    const res = await fetch(discoveryUrl, { timeout: 5000 });
    if (!res.ok) {
      return { ok: false, status: 422, error: 'discovery_file_unreachable', message: `HTTP ${res.status} from ${discoveryUrl}` };
    }
    doc = await res.json();
  } catch (err) {
    return { ok: false, status: 422, error: 'discovery_file_unreachable', message: err.message };
  }

  const { valid, errors } = validateDiscoveryFile(doc);
  if (!valid) {
    return { ok: false, status: 422, error: 'schema_validation_failed', message: errors };
  }

  seeds.push(domain);
  saveSeeds(seeds);
  return { ok: true, status: 201, domain, component_count: doc.components.length, seller: doc.seller.name };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/submit-domain', async (req, res) => {
  const result = await submitDomain(req.body && req.body.domain);
  res.status(result.status).json(result);
});

app.get('/protocol-schema.json', (req, res) => {
  res.sendFile(SCHEMA_PATH);
});

app.listen(PORT, () => {
  console.log(`registry submission service running at http://localhost:${PORT}`);
});
