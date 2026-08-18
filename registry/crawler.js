// P1 build note: this is the "poller" from the build plan — a cron/scheduled
// job in production, run manually here. Real version also validates against
// protocol/schema/agent-commerce.schema.json before ingesting; this MVP does
// a lighter shape check inline to keep the demo dependency-free.

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const SEEDS_PATH = path.join(__dirname, 'seed-domains.json');
const INDEX_PATH = path.join(__dirname, 'index.json');

function isValidDiscoveryFile(doc) {
  return (
    doc &&
    doc.protocol_version &&
    doc.seller && doc.seller.seller_id &&
    Array.isArray(doc.components)
  );
}

async function crawlDomain(domain) {
  const url = `${domain}/.well-known/agent-commerce.json`;
  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) {
      console.log(`[skip] ${domain} — HTTP ${res.status}`);
      return [];
    }
    const doc = await res.json();
    if (!isValidDiscoveryFile(doc)) {
      console.log(`[skip] ${domain} — failed schema check`);
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

async function main() {
  const seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
  const all = [];
  for (const domain of seeds) {
    const components = await crawlDomain(domain);
    all.push(...components);
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ components: all, crawled_at: new Date().toISOString() }, null, 2));
  console.log(`\nindexed ${all.length} component(s) across ${seeds.length} domain(s) -> ${INDEX_PATH}`);
}

main();
