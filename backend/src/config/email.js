const nodemailer = require('nodemailer');
const { t } = require('../i18n');

const isProd = process.env.NODE_ENV === 'production';

/** Throw in production if SMTP is not configured; log in development. */
function devFallback(label) {
  if (isProd) {
    throw new Error('SMTP not configured in production. Cannot send email.');
  }
  return (details) => console.log(`[EMAIL DEV] ${label}:`, details);
}

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

/** Pure builder — subject/text/html for the OTP email. Exported for testing. */
function buildOtpEmail(otp, lang = 'ru') {
  return {
    subject: t(lang, 'otp.subject'),
    text: t(lang, 'otp.text', { otp }),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px">${t(lang, 'otp.heading')}</h2>
        <p style="margin:0 0 8px;color:#555">${t(lang, 'otp.lead')}</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px 0;color:#111">${otp}</div>
        <p style="margin:16px 0 0;color:#888;font-size:13px">${t(lang, 'otp.footer')}</p>
      </div>
    `,
  };
}

/**
 * Send a 6-digit OTP email to the given address.
 * If SMTP_HOST is not configured, logs the OTP to console (dev mode).
 * @param {string} lang — recipient's language ('ru'|'en'); defaults to 'ru'
 *   since the registration flow has no user row yet to read users.language from.
 */
async function sendOtpEmail(to, otp, lang = 'ru') {
  if (!process.env.SMTP_HOST) {
    devFallback('OTP')(`for ${to}: ${otp}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, ...buildOtpEmail(otp, lang) });
}

/**
 * Send a support report email to the admin address.
 */
async function sendSupportEmail({ subject, username, userEmail, sentAt, description, imageBuffer, imageFilename, imageMimeType }) {
  const to = 'blizkie.noreply@mail.ru';
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const escapedDesc = description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Embed image inline via cid so it renders directly in the email body
  // (mail.ru and other clients sometimes hide/strip regular attachments)
  const imageHtml = imageBuffer
    ? `<div style="margin-top:20px"><img src="cid:support-image" style="max-width:100%;border-radius:8px;border:1px solid #e0e0e0" alt="Скриншот" /></div>`
    : '';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 20px;color:#111">${subject}</h2>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        <tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap">👤 Пользователь</td><td style="padding:6px 0;font-weight:600">@${username}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap">📧 Email</td><td style="padding:6px 0">${userEmail}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap">🕐 Дата и время</td><td style="padding:6px 0">${sentAt}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px"/>
      <p style="white-space:pre-wrap;margin:0;line-height:1.6;color:#222">${escapedDesc}</p>
      ${imageHtml}
    </div>`;

  const attachments = imageBuffer
    ? [{
        filename:    imageFilename || 'screenshot',
        content:     imageBuffer,
        contentType: imageMimeType || 'image/jpeg',
        cid:         'support-image',   // referenced by src="cid:support-image" in HTML
      }]
    : [];

  if (!process.env.SMTP_HOST) {
    devFallback('Support report')(`from @${username}: ${subject}`);
    return;
  }

  await getTransporter().sendMail({ from, to, subject, html, text: description, attachments });
}

/** Pure builder — subject/text/html for the password-reset email. Exported for testing. */
function buildPasswordResetEmail(resetUrl, lang = 'ru') {
  return {
    subject: t(lang, 'passwordReset.subject'),
    text: t(lang, 'passwordReset.text', { resetUrl }),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px;color:#111">${t(lang, 'passwordReset.heading')}</h2>
        <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
          ${t(lang, 'passwordReset.lead')}
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#2f81f7;color:#fff;text-decoration:none;
                  padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;
                  letter-spacing:0.02em">
          ${t(lang, 'passwordReset.button')}
        </a>
        <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.6">
          ${t(lang, 'passwordReset.fallbackLead')}<br>
          <a href="${resetUrl}" style="color:#2f81f7;word-break:break-all">${resetUrl}</a>
        </p>
        <p style="margin:16px 0 0;color:#aaa;font-size:12px">
          ${t(lang, 'passwordReset.footer')}
        </p>
      </div>
    `,
  };
}

/**
 * Send a password reset link email.
 * @param {string} lang — recipient's language ('ru'|'en'); defaults to 'ru'.
 */
async function sendPasswordResetEmail(to, resetUrl, lang = 'ru') {
  if (!process.env.SMTP_HOST) {
    devFallback('Password reset')(`for ${to}: ${resetUrl}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, ...buildPasswordResetEmail(resetUrl, lang) });
}

/** Pure builder — subject/text/html for the moderation warning email. Exported for testing. */
function buildModerationWarningEmail(username, message, lang = 'ru') {
  const escapedMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return {
    subject: t(lang, 'moderationWarning.subject'),
    text: t(lang, 'moderationWarning.text', { username, message }),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px;color:#111">${t(lang, 'moderationWarning.heading')}</h2>
        <p style="margin:0 0 8px;color:#555">${t(lang, 'moderationWarning.greeting', { username })}</p>
        <p style="margin:0 0 16px;color:#555">${t(lang, 'moderationWarning.lead')}</p>
        <div style="padding:16px;border-radius:8px;background:#fff4e5;border:1px solid #ffd9a0;color:#7a4a00;white-space:pre-wrap">${escapedMsg}</div>
        <p style="margin:16px 0 0;color:#888;font-size:13px">${t(lang, 'moderationWarning.footer')}</p>
      </div>
    `,
  };
}

/**
 * Send a moderation warning email — the out-of-band channel for a warning
 * that's also stored in user_warnings and shown in-app until acknowledged
 * (routes/users.js GET/POST .../me/warnings). Reaches the user even if they
 * don't open the app right away.
 */
async function sendModerationWarningEmail({ to, username, message, lang = 'ru' }) {
  if (!process.env.SMTP_HOST) {
    devFallback('Moderation warning')(`to @${username}: ${message}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, ...buildModerationWarningEmail(username, message, lang) });
}

module.exports = {
  sendOtpEmail, sendSupportEmail, sendPasswordResetEmail, sendModerationWarningEmail,
  buildOtpEmail, buildPasswordResetEmail, buildModerationWarningEmail,
};
