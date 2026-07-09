/**
 * i18n.js — минимальный RU/EN словарь для backend-контента, у которого ЕСТЬ
 * известный получатель (email/push конкретному пользователю, чей users.language
 * можно прочитать из БД). НЕ путать с фронтовым react-i18next — это отдельный,
 * гораздо более узкий словарь только для писем/push-уведомлений.
 *
 * Сознательно НЕ покрывает: pre-auth письма без существующей учётной записи
 * (регистрация — на этапе OTP юзера ещё нет, языка неоткуда взять), письмо
 * в техподдержку (уходит на фиксированный ящик администратора, не пользователю
 * — переводить его нет смысла), и ~140 текстов ошибок API (`error: '...'` /
 * `throw new Error('...')`) — это отдельная, ещё не запланированная работа
 * (см. журнал CLAUDE.md, известное ограничение «бэкенд не знает язык
 * пользователя на pre-auth запросах»).
 */

const DICTS = {
  ru: {
    otp: {
      subject: 'Ваш код подтверждения',
      text: 'Ваш код подтверждения: {{otp}}\n\nКод действителен 10 минут.\n\nЕсли вы не регистрировались — просто проигнорируйте это письмо.',
      heading: 'Подтверждение email',
      lead: 'Ваш разовый код подтверждения:',
      footer: 'Код действителен 10 минут.<br>Если вы не регистрировались — просто проигнорируйте это письмо.',
    },
    passwordReset: {
      subject: 'Сброс пароля',
      text: 'Для сброса пароля перейдите по ссылке:\n{{resetUrl}}\n\nСсылка действительна 1 час.\nЕсли вы не запрашивали сброс — просто проигнорируйте это письмо.',
      heading: 'Сброс пароля',
      lead: 'Мы получили запрос на сброс пароля для аккаунта, привязанного к этому адресу.<br>Нажмите кнопку ниже, чтобы задать новый пароль.',
      button: 'Сбросить пароль',
      fallbackLead: 'Кнопка не работает? Скопируйте ссылку в браузер:',
      footer: 'Ссылка действительна 1 час. Если вы не запрашивали сброс — просто проигнорируйте это письмо.',
    },
    moderationWarning: {
      subject: 'Предупреждение от администрации',
      text: 'Здравствуйте, @{{username}}.\n\nВаш аккаунт получил предупреждение от администрации:\n\n{{message}}\n\nПожалуйста, соблюдайте правила использования сервиса — повторные нарушения могут привести к блокировке аккаунта.',
      heading: 'Предупреждение от администрации',
      greeting: 'Здравствуйте, @{{username}}.',
      lead: 'Ваш аккаунт получил предупреждение:',
      footer: 'Пожалуйста, соблюдайте правила использования сервиса — повторные нарушения могут привести к блокировке аккаунта.',
    },
    push: {
      newMessageFallback: 'Новое сообщение',
      sticker: '{{emoji}} Стикер',
      stickerFallback: '🎭 Стикер',
      image: '📷 Фото',
      video: '🎥 Видео',
      videoNote: '🎥 Видеосообщение',
      audio: '🎵 Аудио',
      gif: '🎞 GIF',
      attachment: '📎 Вложение',
      customEmojiFallback: '😊',
      dailyPromptDefault: '🌙 Вопрос дня',
      incomingVideoCall: 'Входящий видеозвонок',
      incomingCall: 'Входящий звонок',
      callerIsCalling: '{{callerName}} звонит…',
    },
    call: {
      endingSoon: 'Сервер обновляется, звонок сейчас завершится — просто перезвоните ещё раз через минуту.',
    },
  },
  en: {
    otp: {
      subject: 'Your confirmation code',
      text: 'Your confirmation code: {{otp}}\n\nThe code is valid for 10 minutes.\n\nIf you did not register, just ignore this email.',
      heading: 'Confirm your email',
      lead: 'Your one-time confirmation code:',
      footer: 'The code is valid for 10 minutes.<br>If you did not register, just ignore this email.',
    },
    passwordReset: {
      subject: 'Password reset',
      text: 'To reset your password, follow this link:\n{{resetUrl}}\n\nThe link is valid for 1 hour.\nIf you did not request a reset, just ignore this email.',
      heading: 'Password reset',
      lead: 'We received a request to reset the password for the account linked to this address.<br>Click the button below to set a new password.',
      button: 'Reset password',
      fallbackLead: "Button not working? Copy this link into your browser:",
      footer: 'The link is valid for 1 hour. If you did not request a reset, just ignore this email.',
    },
    moderationWarning: {
      subject: 'Warning from the administration',
      text: 'Hello, @{{username}}.\n\nYour account has received a warning from the administration:\n\n{{message}}\n\nPlease follow the service usage rules — repeated violations may lead to an account ban.',
      heading: 'Warning from the administration',
      greeting: 'Hello, @{{username}}.',
      lead: 'Your account has received a warning:',
      footer: 'Please follow the service usage rules — repeated violations may lead to an account ban.',
    },
    push: {
      newMessageFallback: 'New message',
      sticker: '{{emoji}} Sticker',
      stickerFallback: '🎭 Sticker',
      image: '📷 Photo',
      video: '🎥 Video',
      videoNote: '🎥 Video message',
      audio: '🎵 Audio',
      gif: '🎞 GIF',
      attachment: '📎 Attachment',
      customEmojiFallback: '😊',
      dailyPromptDefault: '🌙 Daily prompt',
      incomingVideoCall: 'Incoming video call',
      incomingCall: 'Incoming call',
      callerIsCalling: '{{callerName}} is calling…',
    },
    call: {
      endingSoon: "The server is restarting and the call is about to end — just call back again in a minute.",
    },
  },
};

/** Normalize any input to a supported language code, defaulting to 'ru'. */
function resolveLang(raw) {
  return raw === 'en' ? 'en' : 'ru';
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

/** Translate a dotted key for the given language, interpolating {{params}}. */
function t(lang, key, params) {
  const dict = DICTS[resolveLang(lang)];
  const template = getPath(dict, key) ?? getPath(DICTS.ru, key) ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? params[k] : ''));
}

module.exports = { t, resolveLang };
