// Sets (or resets) a seller's password without ever committing a plaintext
// credential to the repo -- only the hash+salt get written to seed.json.
// Usage:
//   node scripts/set-seller-password.js <email>              (generates a random password, prints it once)
//   node scripts/set-seller-password.js <email> <password>   (sets an explicit password)
const crypto = require('crypto');
const { loadData, saveData } = require('../lib/data');
const { findSellerByEmail } = require('../lib/sellers');
const { hashPassword } = require('../lib/auth');

const email = process.argv[2];
const explicitPassword = process.argv[3];

if (!email) {
  console.error('Usage: node scripts/set-seller-password.js <email> [password]');
  process.exit(1);
}

const data = loadData();
const seller = findSellerByEmail(data, email);
if (!seller) {
  console.error(`No seller found with email "${email}".`);
  process.exit(1);
}

const password = explicitPassword || crypto.randomBytes(9).toString('base64url');
const { password_hash, password_salt } = hashPassword(password);
seller.password_hash = password_hash;
seller.password_salt = password_salt;
saveData(data);

console.log(`Password set for ${seller.name} <${seller.email}>.`);
console.log(`Password: ${password}`);
