const nodemailer = require('nodemailer');

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

/**
 * Send a 6-digit OTP email to the given address.
 * If SMTP_HOST is not configured, logs the OTP to console (dev mode).
 */
async function sendOtpEmail(to, otp) {
  if (!process.env.SMTP_HOST) {
    devFallback('OTP')(`for ${to}: ${otp}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to,
    subject: 'Ваш код подтверждения',
    text: `Ваш код подтверждения: ${otp}\n\nКод действителен 10 минут.\n\nЕсли вы не регистрировались — просто проигнорируйте это письмо.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px">Подтверждение email</h2>
        <p style="margin:0 0 8px;color:#555">Ваш разовый код подтверждения:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px 0;color:#111">${otp}</div>
        <p style="margin:16px 0 0;color:#888;font-size:13px">Код действителен 10 минут.<br>Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `,
  });
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

/**
 * Send a password reset link email.
 */
async function sendPasswordResetEmail(to, resetUrl) {
  if (!process.env.SMTP_HOST) {
    devFallback('Password reset')(`for ${to}: ${resetUrl}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to,
    subject: 'Сброс пароля',
    text: `Для сброса пароля перейдите по ссылке:\n${resetUrl}\n\nСсылка действительна 1 час.\nЕсли вы не запрашивали сброс — просто проигнорируйте это письмо.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px;color:#111">Сброс пароля</h2>
        <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
          Мы получили запрос на сброс пароля для аккаунта, привязанного к этому адресу.<br>
          Нажмите кнопку ниже, чтобы задать новый пароль.
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#2f81f7;color:#fff;text-decoration:none;
                  padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;
                  letter-spacing:0.02em">
          Сбросить пароль
        </a>
        <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.6">
          Кнопка не работает? Скопируйте ссылку в браузер:<br>
          <a href="${resetUrl}" style="color:#2f81f7;word-break:break-all">${resetUrl}</a>
        </p>
        <p style="margin:16px 0 0;color:#aaa;font-size:12px">
          Ссылка действительна 1 час. Если вы не запрашивали сброс — просто проигнорируйте это письмо.
        </p>
      </div>
    `,
  });
}

/**
 * Send a moderation warning email — the out-of-band channel for a warning
 * that's also stored in user_warnings and shown in-app until acknowledged
 * (routes/users.js GET/POST .../me/warnings). Reaches the user even if they
 * don't open the app right away.
 */
async function sendModerationWarningEmail({ to, username, message }) {
  const escapedMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (!process.env.SMTP_HOST) {
    devFallback('Moderation warning')(`to @${username}: ${message}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to,
    subject: 'Предупреждение от администрации',
    text: `Здравствуйте, @${username}.\n\nВаш аккаунт получил предупреждение от администрации:\n\n${message}\n\nПожалуйста, соблюдайте правила использования сервиса — повторные нарушения могут привести к блокировке аккаунта.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px;color:#111">Предупреждение от администрации</h2>
        <p style="margin:0 0 8px;color:#555">Здравствуйте, @${username}.</p>
        <p style="margin:0 0 16px;color:#555">Ваш аккаунт получил предупреждение:</p>
        <div style="padding:16px;border-radius:8px;background:#fff4e5;border:1px solid #ffd9a0;color:#7a4a00;white-space:pre-wrap">${escapedMsg}</div>
        <p style="margin:16px 0 0;color:#888;font-size:13px">Пожалуйста, соблюдайте правила использования сервиса — повторные нарушения могут привести к блокировке аккаунта.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail, sendSupportEmail, sendPasswordResetEmail, sendModerationWarningEmail };
