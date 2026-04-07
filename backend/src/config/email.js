const nodemailer = require('nodemailer');

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
    console.log(`[EMAIL DEV] OTP for ${to}: ${otp}`);
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
    console.log(`[EMAIL DEV] Support report from @${username}: ${subject}`);
    return;
  }

  await getTransporter().sendMail({ from, to, subject, html, text: description, attachments });
}

module.exports = { sendOtpEmail, sendSupportEmail };
