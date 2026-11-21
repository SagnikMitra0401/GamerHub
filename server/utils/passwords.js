const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;
const MIN_PASSWORD = 8;
// bcrypt silently truncates past 72 bytes, so the API refuses oversized input.
const MAX_PASSWORD = 128;
const MAX_PASSWORD_BYTES = 72;

/** Shared by registration, reset and authenticated password change. */
function validatePassword(password) {
  if (typeof password !== 'string' || !password) {
    return { ok: false, message: 'Enter a password.' };
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return {
      ok: false,
      message: `Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters`
    };
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return {
      ok: false,
      message: 'Password is too long; use 72 bytes or fewer (accented and emoji characters can use several bytes each).'
    };
  }
  return { ok: true, value: password };
}

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const verifyPassword = (password, hash) =>
  bcrypt.compare(password, hash).catch(() => false);

module.exports = {
  SALT_ROUNDS,
  MIN_PASSWORD,
  MAX_PASSWORD,
  validatePassword,
  hashPassword,
  verifyPassword
};
