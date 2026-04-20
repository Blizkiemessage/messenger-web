const rateLimit = require('express-rate-limit');

// General login / password-change (30 req / 15 min per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoints that send an email (register, forgot-password, request-email-change)
// Tight: 5 emails / hour per IP
const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много запросов. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoints that verify an OTP or reset token (verify-email, reset-password, verify-email-change)
// Moderate: 10 req / 15 min per IP
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, emailSendLimiter, otpVerifyLimiter };
