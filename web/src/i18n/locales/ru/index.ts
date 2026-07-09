/**
 * Реестр русских неймспейсов. Новый неймспейс = новый JSON + импорт здесь
 * (и зеркально в locales/en/index.ts) — см. web/src/i18n/index.ts.
 */
import common from './common.json';
import settings from './settings.json';
import auth from './auth.json';
import nav from './nav.json';
import chat from './chat.json';
import modals from './modals.json';
import calls from './calls.json';
import notes from './notes.json';
import assistant from './assistant.json';
import legal from './legal.json';

export default { common, settings, auth, nav, chat, modals, calls, notes, assistant, legal };
