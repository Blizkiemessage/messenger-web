/**
 * faq.ts — база знаний ассистента-помощника (Этап C).
 *
 * Детерминированный реестр интентов: вопрос → готовый ответ + кнопки-действия
 * (deep-links). Никаких внешних вызовов, нулевая стоимость, предсказуемо.
 *
 * ВАЖНО (защита от устаревания): этот реестр — ЕДИНЫЙ источник «как сделать X».
 * Добавляя/меняя фичу приложения, обнови соответствующий интент здесь И
 * соответствующий ключ `intent.<id>` в `i18n/locales/{ru,en}/assistant.json`.
 * Действия (`actions`) обязаны быть валидными deep-links из `deeplinks.ts` —
 * иначе кнопка никуда не приведёт.
 *
 * Текст (question/keywords/answer/action-labels) переведён — живёт в
 * `assistant.json` (RU/EN), а не здесь. Здесь — только языково-нейтральная
 * структура (id/категория/deep-link/порядок). `getFaq()`/`getCategoryMeta()`
 * читают текущий язык из `i18n.language` при каждом вызове (как `utils/format.ts`),
 * поэтому вызывать их нужно внутри тела компонента/функции, а не на верхнем
 * уровне модуля — иначе смена языка не подхватится.
 *
 * Ответ (`answer`) — markdown, как в сообщениях (поддерживает **жирный**,
 * списки `- `, ссылки `blz:`); рендерится через utils/markdown.
 */
import i18n from '../i18n';
import { type DeepLinkAction } from '../deeplinks';

export type FaqCategory =
  | 'start'      // начало работы
  | 'chat'       // чаты и сообщения
  | 'media'      // медиа, голос, кружки
  | 'groups'     // группы
  | 'calls'      // звонки
  | 'rituals'    // вопрос дня, заметки
  | 'appearance' // оформление
  | 'privacy'    // приватность и безопасность
  | 'legal';     // юридические документы

export interface FaqAction {
  label: string;
  action: DeepLinkAction;
}

export interface FaqIntent {
  id: string;
  category: FaqCategory;
  /** Короткий вопрос — заголовок карточки и текст чипа. */
  question: string;
  /** Слова/синонимы для поиска (нижний регистр). */
  keywords: string[];
  /** Готовый ответ (markdown). */
  answer: string;
  /** Кнопки-действия под ответом. */
  actions?: FaqAction[];
  /** Показать в блоке «частые вопросы» наверху. */
  top?: boolean;
}

const CATEGORY_IDS: FaqCategory[] = [
  'start', 'chat', 'media', 'groups', 'calls', 'rituals', 'appearance', 'privacy', 'legal',
];
const CATEGORY_ICONS: Record<FaqCategory, string> = {
  start: '✨', chat: '💬', media: '🎤', groups: '👥', calls: '📞',
  rituals: '🌙', appearance: '🎨', privacy: '🔒', legal: '📄',
};

/** Метаданные категорий (иконка+переведённый лейбл) для текущего языка. */
export function getCategoryMeta(): Record<FaqCategory, { label: string; icon: string }> {
  const out = {} as Record<FaqCategory, { label: string; icon: string }>;
  for (const cat of CATEGORY_IDS) {
    out[cat] = { label: i18n.t(`assistant:category.${cat}`), icon: CATEGORY_ICONS[cat] };
  }
  return out;
}

/** Языково-нейтральная структура интента: id/категория/deep-links/порядок. */
interface FaqIntentDef {
  id: string;
  category: FaqCategory;
  top?: boolean;
  actions?: DeepLinkAction[];
}

const FAQ_DEFS: FaqIntentDef[] = [
  // ── Начало ──────────────────────────────────────────────────────────────
  { id: 'invite', category: 'start', top: true, actions: [{ type: 'invite' }] },
  { id: 'find-friends', category: 'start', top: true, actions: [{ type: 'find-friends' }, { type: 'invite' }] },
  { id: 'create-group', category: 'groups', top: true, actions: [{ type: 'create-group' }] },
  { id: 'saved', category: 'start', actions: [{ type: 'open-saved' }] },

  // ── Медиа и голос ─────────────────────────────────────────────────────────
  { id: 'voice', category: 'media', top: true },
  { id: 'media-send', category: 'media' },
  { id: 'stickers', category: 'media' },

  // ── Чаты и сообщения ──────────────────────────────────────────────────────
  { id: 'scheduled', category: 'chat', actions: [{ type: 'scheduled' }] },
  { id: 'poll', category: 'chat' },
  { id: 'reactions', category: 'chat' },
  { id: 'search', category: 'chat' },

  // ── Звонки ─────────────────────────────────────────────────────────────────
  { id: 'calls', category: 'calls', top: true },

  // ── Ритуалы: вопрос дня, заметки ────────────────────────────────────────────
  { id: 'daily-prompt', category: 'rituals', top: true, actions: [{ type: 'chat-settings', section: 'daily' }, { type: 'daily-archive' }] },
  { id: 'notes', category: 'rituals', actions: [{ type: 'notes' }] },

  // ── Оформление ──────────────────────────────────────────────────────────────
  { id: 'appearance', category: 'appearance', top: true, actions: [{ type: 'appearance' }] },
  { id: 'chat-bg', category: 'appearance', actions: [{ type: 'chat-settings', section: 'appearance' }] },

  // ── Приватность и безопасность ──────────────────────────────────────────────
  { id: 'security', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'privacy', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'change-name', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'change-email', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'delete-account', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'phone', category: 'privacy', actions: [{ type: 'profile-settings' }] },

  // ── Данные и безопасность ────────────────────────────────────────────────
  { id: 'export-data', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'sessions', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'permissions', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'notifications', category: 'privacy', actions: [{ type: 'profile-settings' }] },
  { id: 'block-user', category: 'privacy' },

  // ── Юридические документы ────────────────────────────────────────────────
  { id: 'legal-find-docs', category: 'legal', top: true, actions: [{ type: 'documents' }] },
  { id: 'legal-data-collected', category: 'legal', actions: [{ type: 'documents' }] },
  { id: 'legal-moderation-privacy', category: 'legal', actions: [{ type: 'documents' }] },
  { id: 'legal-age-terms', category: 'legal', actions: [{ type: 'documents' }] },

  // ── Инструменты чата ──────────────────────────────────────────────────────
  { id: 'ai-summary', category: 'chat', actions: [{ type: 'ai-summary' }] },
  { id: 'media-gallery', category: 'media', actions: [{ type: 'media' }] },
  { id: 'formatting', category: 'chat' },
  { id: 'sticker-studio', category: 'media' },

  // ── Организация и удобство ────────────────────────────────────────────────
  { id: 'folders', category: 'chat' },
  { id: 'pin-mute-chat', category: 'chat' },
  { id: 'status', category: 'start' },

  // ── Группы (детали) ───────────────────────────────────────────────────────
  { id: 'group-roles', category: 'groups' },
];

/** Собрать полный переведённый каталог интентов для текущего языка. */
export function getFaq(): FaqIntent[] {
  return FAQ_DEFS.map(def => {
    const base = `assistant:intent.${def.id}`;
    const actionLabels = i18n.t(`${base}.actions`, { returnObjects: true, defaultValue: [] as string[] }) as string[];
    return {
      id: def.id,
      category: def.category,
      top: def.top,
      question: i18n.t(`${base}.question`),
      answer: i18n.t(`${base}.answer`),
      keywords: i18n.t(`${base}.keywords`, { returnObjects: true, defaultValue: [] as string[] }) as string[],
      actions: def.actions?.map((action, idx) => ({ label: actionLabels[idx] ?? '', action })),
    };
  });
}

/** Нормализация для поиска (нижний регистр, ё→е, убрать пунктуацию). */
function normRu(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s@]/gi, ' ');
}
function normEn(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s@]/gi, ' ');
}

// Стоп-слова — не несут смысла, не должны влиять на матчинг.
const STOPWORDS_RU = new Set([
  'как', 'что', 'чем', 'где', 'когда', 'почему', 'зачем', 'чтобы', 'который',
  'мне', 'меня', 'мой', 'моя', 'мои', 'мою', 'моего', 'я', 'ты', 'вы', 'он', 'она',
  'в', 'во', 'на', 'с', 'со', 'по', 'из', 'за', 'к', 'ко', 'до', 'от', 'для', 'про',
  'это', 'эту', 'этот', 'эта', 'эти', 'можно', 'ли', 'же', 'бы', 'не', 'нет', 'да',
  'и', 'или', 'а', 'но', 'у', 'о', 'об', 'при', 'так', 'тут', 'там', 'если', 'есть',
  'быть', 'хочу', 'надо', 'нужно', 'свой', 'свою', 'свои', 'тебя', 'нам', 'вас',
]);
const STOPWORDS_EN = new Set([
  'how', 'what', 'why', 'where', 'when', 'which', 'who', 'whom',
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'my', 'me', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those',
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'and',
  'or', 'but', 'not', 'no', 'yes', 'can', 'could', 'should', 'would', 'will',
  'so', 'if', 'there', 'here', 'have', 'has', 'had', 'want', 'need', 'get',
]);

// Окончания для лёгкого стемминга (длинные — первыми).
const ENDINGS_RU = [
  'иться', 'аться', 'яться', 'ться', 'ение', 'ения', 'ниях', 'ами', 'ями',
  'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ить', 'еть', 'ать', 'ять', 'уть',
  'ыть', 'тся', 'ишь', 'ах', 'ях', 'ов', 'ев', 'ей', 'ам', 'ям', 'ую', 'юю',
  'ие', 'ые', 'ть', 'ла', 'ло', 'ли', 'на', 'ны', 'ет', 'ит',
  'а', 'я', 'о', 'е', 'у', 'ю', 'ы', 'и', 'й', 'ь',
].sort((a, b) => b.length - a.length);

/** Лёгкий стеммер: отрезает одно длиннейшее окончание, оставляя корень (≥3 симв.). */
function stemRu(w: string): string {
  for (const e of ENDINGS_RU) {
    if (w.length - e.length >= 3 && w.endsWith(e)) return w.slice(0, -e.length);
  }
  return w;
}

/** Лёгкий английский стеммер: суффиксы множественного числа/глагольных форм. */
function stemEn(w: string): string {
  if (w.length > 6 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Разбить строку на значимые стеммированные токены (без стоп-слов), под текущий язык. */
function tokensOf(s: string): string[] {
  const isEn = i18n.language === 'en';
  const norm = isEn ? normEn : normRu;
  const stopwords = isEn ? STOPWORDS_EN : STOPWORDS_RU;
  const stem = isEn ? stemEn : stemRu;
  return norm(s)
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopwords.has(w))
    .map(stem);
}

/** Совпадение токенов: равны или один — префикс другого (короткий ≥4 симв.). */
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/**
 * Порог релевантности локального поиска (без ИИ):
 * - score (по КЛЮЧЕВЫМ словам) >= STRONG → уверенный ответ сразу.
 * - иначе, если есть хоть какой-то сигнал → «возможно, вы имели в виду…».
 * - сигнала нет → честный фолбэк на поддержку.
 *
 * Ключевой принцип: уверенный ответ даётся ТОЛЬКО при совпадении по ключевым
 * словам интента, а не по общим словам вопроса («аккаунт», «сменить») — иначе
 * «удалить аккаунт» ошибочно матчилось на «защитить аккаунт».
 */
export const FAQ_SCORE_STRONG = 4;

export interface ScoredIntent { intent: FaqIntent; score: number; total: number }

/** Поиск с оценками — ранжирование по совпадению ключевых слов (с приоритетом). */
export function searchFaqScored(query: string): ScoredIntent[] {
  const qTokens = tokensOf(query);
  if (!qTokens.length) return [];

  return getFaq()
    .map(intent => {
      const kwTokens = new Set<string>();
      for (const k of intent.keywords) for (const t of tokensOf(k)) kwTokens.add(t);
      const qIntentTokens = new Set(tokensOf(intent.question));

      let keywordScore = 0;  // совпадения по ключевым словам (даёт уверенный ответ)
      let weakScore = 0;     // совпадения только по словам вопроса (только подсказки)
      for (const w of qTokens) {
        if (kwTokens.has(w)) { keywordScore += 4; continue; }
        let partial = false;
        for (const kt of kwTokens) { if (tokenMatch(w, kt)) { partial = true; break; } }
        if (partial) { keywordScore += 3; continue; }
        if (qIntentTokens.has(w)) weakScore += 1;
      }
      return { intent, score: keywordScore, total: keywordScore + weakScore };
    })
    .filter(s => s.total > 0)
    .sort((a, b) => b.score - a.score || b.total - a.total);
}

/** Поиск без оценок (совместимость): интенты по убыванию релевантности. */
export function searchFaq(query: string): FaqIntent[] {
  return searchFaqScored(query).map(s => s.intent);
}

/** Найти интент по id (для применения результата LLM-маршрутизатора). */
export function getIntentById(id: string): FaqIntent | undefined {
  return getFaq().find(i => i.id === id);
}

/** Компактный каталог (id + вопрос) — для лёгкой классификации/совместимости. */
export function getIntentCatalog(): { id: string; question: string }[] {
  return getFaq().map(i => ({ id: i.id, question: i.question }));
}

/**
 * Полная база знаний для LLM-генератора ответа: вопрос + ответ + доступные
 * кнопки (только labels — сами deep-links резолвит фронт по id, поэтому LLM не
 * может выдумать действие). ЕДИНЫЙ источник — этот же FAQ, для ТЕКУЩЕГО языка
 * интерфейса (LLM получит базу и вопрос на одном языке и ответит на нём же).
 */
export interface AssistantKbItem {
  id: string;
  question: string;
  answer: string;
  actions: { label: string }[];
}
export function getAssistantKb(): AssistantKbItem[] {
  return getFaq().map(i => ({
    id: i.id,
    question: i.question,
    answer: i.answer,
    actions: (i.actions ?? []).map(a => ({ label: a.label })),
  }));
}

/** Интенты, показываемые в блоке «частые вопросы» наверху, для текущего языка. */
export function getTopIntents(): FaqIntent[] {
  return getFaq().filter(i => i.top);
}
