const rateLimit = require('express-rate-limit');

// General login / password-change (30 req / 15 min per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoints that send an email (forgot-password, request-email-change)
// Tight: 5 emails / hour per IP
const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много запросов. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// B2: Registration-specific limiter — separate counter from emailSendLimiter so
// forgot-password and register don't interfere with each other.
// 3 account-creation attempts / hour per IP is enough for legitimate use.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много попыток регистрации. Попробуйте через час.' },
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

// Admin login — tight: 5 attempts / 30 min per IP
const adminLoginLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Try again in 30 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Global search — 30 req / min per IP (search hits the DB / FTS index on every call)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Слишком много поисковых запросов. Подождите немного.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Friend requests — 20 actions / hour per IP (sending requests is the main abuse vector)
const friendRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Слишком много запросов в друзья. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Link preview fetches — 60 req / min per IP (background fetch per message)
const linkPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Слишком много запросов предпросмотра ссылок.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// TOTP verification during login — tight: 5 attempts / 15 min per IP
const totpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  emailSendLimiter,
  registrationLimiter,
  otpVerifyLimiter,
  adminLoginLimiter,
  searchLimiter,
  friendRequestLimiter,
  linkPreviewLimiter,
  totpVerifyLimiter,
};
