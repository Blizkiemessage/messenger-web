const crypto = require('crypto');

/**
 * Generates a cryptographically random 6-digit OTP string.
 */
function generateOtp() {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(6, '0');
}

module.exports = { generateOtp };
