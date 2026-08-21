// The "poller" from the build plan. Two modes:
//   npm run crawl        - one-off pass, exits when done (CI, manual runs)
//   npm run crawl:watch  - runs on a schedule (CRAWL_CRON, default every 15m)
//                          for a long-lived production poller process
//
// Validates every discovery file against the real protocol schema
// (protocol/schema/agent-commerce.schema.json) before ingesting it — a
// domain that returns a shape agents can't rely on gets skipped, not
// silently indexed.

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { validateDiscoveryFile } = require('./lib/validate-discovery-file');

const SEEDS_PATH = path.join(__dirname, 'seed-domains.json');
const INDEX_PATH = path.join(__dirname, 'index.json');
const CRAWL_CRON = process.env.CRAWL_CRON || '*/15 * * * *';

async function crawlDomain(domain) {
  const url = `${domain}/.well-known/agent-commerce.json`;
  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) {
      console.log(`[skip] ${domain} — HTTP ${res.status}`);
      return [];
    }
    const doc = await res.json();
    const { valid, errors } = validateDiscoveryFile(doc);
    if (!valid) {
      console.log(`[skip] ${domain} — failed schema validation: ${errors}`);
      return [];
    }
    console.log(`[ok] ${domain} — ${doc.components.length} component(s) from ${doc.seller.name}`);
    return doc.components.map((c) => ({
      ...c,
      seller: doc.seller,
      indexed_at: new Date().toISOString(),
    }));
  } catch (err) {
    console.log(`[error] ${domain} — ${err.message}`);
    return [];
  }
}

async function crawlOnce() {
  const seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
  const all = [];
  for (const domain of seeds) {
    const components = await crawlDomain(domain);
    all.push(...components);
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ components: all, crawled_at: new Date().toISOString() }, null, 2));
  console.log(`indexed ${all.length} component(s) across ${seeds.length} domain(s) -> ${INDEX_PATH}`);
}

async function main() {
  if (process.argv.includes('--watch')) {
    console.log(`crawler running on schedule "${CRAWL_CRON}" (set CRAWL_CRON to override)`);
    await crawlOnce();
    cron.schedule(CRAWL_CRON, () => {
      crawlOnce().catch((err) => console.error('crawl run failed:', err));
    });
  } else {
    await crawlOnce();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
