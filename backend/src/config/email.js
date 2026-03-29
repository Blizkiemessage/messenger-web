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

module.exports = { sendOtpEmail };
