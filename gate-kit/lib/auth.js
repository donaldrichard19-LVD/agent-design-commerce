// Password hashing via Node's built-in scrypt -- no dependency, avoids the
// native-compile risk bcrypt carries on a plain `npm install` Render build.
const crypto = require('crypto');

const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString('hex');
  return { password_hash: hash, password_salt: salt };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

module.exports = { hashPassword, verifyPassword };
