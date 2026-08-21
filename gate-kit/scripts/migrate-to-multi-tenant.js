// One-off: converts seed.json from the single-tenant shape
// ({ seller, stripe_connect, components, sales }) to the multi-tenant shape
// ({ sellers: [...], components: [...with seller_id], sales: [...with seller_id] }).
// Refuses to run twice -- idempotency guard against double-migration.
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'seed.json');

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

if (data.sellers) {
  console.error('seed.json already has a `sellers` array -- migration already ran. Aborting.');
  process.exit(1);
}
if (!data.seller || !data.stripe_connect) {
  console.error('seed.json is missing `seller`/`stripe_connect` -- not the expected pre-migration shape. Aborting.');
  process.exit(1);
}

const seller = {
  ...data.seller,
  // Pre-migration seller records have `contact`, not `email` -- login needs
  // a real `email` field, and `contact` already holds an email address.
  email: data.seller.email || data.seller.contact,
  stripe_connect: data.stripe_connect,
  password_hash: null,
  password_salt: null,
  legacy_root: true,
  created_at: new Date().toISOString(),
};

const components = data.components.map((c) => ({ ...c, seller_id: seller.seller_id }));

const sales = data.sales.map((s) => {
  const component = components.find((c) => c.component_id === s.component_id);
  return { ...s, seller_id: component ? component.seller_id : seller.seller_id };
});

const migrated = { sellers: [seller], components, sales };

fs.writeFileSync(DATA_PATH, JSON.stringify(migrated, null, 2));

console.log(`Migrated seed.json: 1 seller ("${seller.name}", legacy_root=true), ${components.length} component(s), ${sales.length} sale(s).`);
console.log(`Her account has no password yet -- run: node scripts/set-seller-password.js ${seller.email}`);
