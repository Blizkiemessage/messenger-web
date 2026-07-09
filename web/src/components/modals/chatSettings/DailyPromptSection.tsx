/**
 * DailyPromptSection — настройка фичи «Вопрос дня» в хабе «Настройки чата».
 *
 * Конфиг редактируется черновиком и сохраняется одной кнопкой (PUT).
 * Свои вопросы добавляются/удаляются сразу (отдельные эндпоинты).
 * Без права управления (canManage=false) контролы только для чтения.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Chat } from '../../../types';
import { Toggle } from '../../ui/Toggle';
import {
  getDailyPrompt, updateDailyPrompt, addDailyQuestion, deleteDailyQuestion, askDailyNow,
  type DailyPromptConfig, type DailyPromptBank, type CustomQuestion, type ScheduleType, type OrderMode,
} from '../../../api/dailyPrompts';
import { minutesToHHMM, hhmmToMinutes, getWeekdays, timezoneOptions } from './helpers';

interface Props { chat: Chat; meId: string; onOpenArchive?: () => void; }

type Draft = Omit<DailyPromptConfig, 'source'> & {
  source: { banks: string[]; use_builtin: boolean; use_custom: boolean };
};

function toDraft(c: DailyPromptConfig): Draft {
  return {
    ...c,
    enabled: !!c.enabled,
    push_enabled: !!c.push_enabled,
    source: {
      banks: Array.isArray(c.source?.banks) ? c.source.banks : [],
      use_builtin: !!c.source?.use_builtin,
      use_custom: !!c.source?.use_custom,
    },
  };
}

export function DailyPromptSection({ chat, meId: _meId, onOpenArchive }: Props) {
  const { t, i18n } = useTranslation('modals');
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const weekdays = useMemo(() => getWeekdays(locale), [locale]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [banks, setBanks] = useState<DailyPromptBank[]>([]);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [streak, setStreak] = useState(0);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const [newQuestion, setNewQuestion] = useState('');
  const [qBusy, setQBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getDailyPrompt(chat.id);
        if (!alive) return;
        const d = toDraft(data.config);
        setDraft(d);
        setInitial(JSON.stringify(d));
        setBanks(data.banks);
        setQuestions(data.questions);
        setStreak(data.streak);
        setCanManage(data.canManage);
      } catch (e: any) {
        if (alive) setError(e?.message || t('dailyPromptSection.loadError'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [chat.id]);

  const dirty = useMemo(
    () => draft != null && JSON.stringify(draft) !== initial,
    [draft, initial],
  );

  function patch(p: Partial<Draft>) {
    setDraft(d => (d ? { ...d, ...p } : d));
    setSavedFlash(false);
  }
  function patchSchedule(type: ScheduleType) {
    setDraft(d => d ? { ...d, schedule: { type, days: type === 'weekly' ? (d.schedule.days ?? [1]) : undefined } } : d);
    setSavedFlash(false);
  }
  function toggleWeekday(v: number) {
    setDraft(d => {
      if (!d) return d;
      const cur = new Set(d.schedule.days ?? []);
      cur.has(v) ? cur.delete(v) : cur.add(v);
      const days = [...cur].sort((a, b) => a - b);
      return { ...d, schedule: { type: 'weekly', days: days.length ? days : [1] } };
    });
    setSavedFlash(false);
  }
  function toggleBank(id: string) {
    setDraft(d => {
      if (!d) return d;
      const cur = new Set(d.source.banks);
      cur.has(id) ? cur.delete(id) : cur.add(id);
      return { ...d, source: { ...d.source, banks: [...cur] } };
    });
    setSavedFlash(false);
  }

  async function save() {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const fresh = await updateDailyPrompt(chat.id, {
        enabled: draft.enabled,
        send_time: draft.send_time,
        timezone: draft.timezone,
        schedule: draft.schedule,
        source: draft.source,
        order_mode: draft.order_mode,
        push_enabled: draft.push_enabled,
        push_text: draft.push_text,
      });
      const d = toDraft(fresh);
      setDraft(d);
      setInitial(JSON.stringify(d));
      setSavedFlash(true);
    } catch (e: any) {
      setError(e?.message || t('dailyPromptSection.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function addQuestion() {
    const text = newQuestion.trim();
    if (!text) return;
    setQBusy(true); setError(null);
    try {
      const q = await addDailyQuestion(chat.id, text);
      setQuestions(list => [...list, q]);
      setNewQuestion('');
    } catch (e: any) {
      setError(e?.message || t('dailyPromptSection.addQuestionError'));
    } finally {
      setQBusy(false);
    }
  }

  async function removeQuestion(id: string) {
    try {
      await deleteDailyQuestion(chat.id, id);
      setQuestions(list => list.filter(q => q.id !== id));
    } catch (e: any) {
      setError(e?.message || t('dailyPromptSection.removeQuestionError'));
    }
  }

  async function askNow() {
    setAsking(true); setError(null);
    try {
      await askDailyNow(chat.id);
    } catch (e: any) {
      setError(e?.message || t('dailyPromptSection.askError'));
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <div className="dpLoading">{t('dailyPromptSection.loading')}</div>;
  if (!draft) return <div className="dpError">{error || t('common:error')}</div>;

  const ro = !canManage; // read-only
  const hasSource =
    (draft.source.use_builtin && draft.source.banks.length > 0) ||
    (draft.source.use_custom && questions.length > 0);

  return (
    <div className="dpSection">
      <div className="dpIntro">
        <div className="dpIntroIcon">🌙</div>
        <div className="dpIntroText">
          <div className="dpIntroTitle">{t('dailyPromptSection.title')}</div>
          <div className="dpIntroHint">
            {t('dailyPromptSection.intro')}
          </div>
        </div>
        {streak > 0 && <div className="dpStreak" title={t('dailyPromptSection.streakTitle')}>🔥 {streak}</div>}
      </div>

      {ro && (
        <div className="dpReadonlyBanner">{t('dailyPromptSection.readonlyBanner')}</div>
      )}

      <div className="dpMasterRow">
        <div className="dpMasterText">
          <div className="dpMasterLabel">{t('dailyPromptSection.enableLabel')}</div>
          <div className="dpMasterSub">{draft.enabled ? t('dailyPromptSection.enabledSub') : t('dailyPromptSection.disabledSub')}</div>
        </div>
        <Toggle value={draft.enabled} onChange={v => patch({ enabled: v })} disabled={ro} />
      </div>

      {draft.enabled && (
        <>
          {/* Время и пояс */}
          <div className="dpGroup">
            <div className="dpGroupTitle">{t('dailyPromptSection.whenGroupTitle')}</div>
            <div className="dpRow">
              <label className="dpFieldLabel">{t('dailyPromptSection.timeLabel')}</label>
              <input type="time" className="dpTimeInput" value={minutesToHHMM(draft.send_time)}
                disabled={ro} onChange={e => patch({ send_time: hhmmToMinutes(e.target.value) })} />
            </div>
            <div className="dpRow">
              <label className="dpFieldLabel">{t('dailyPromptSection.timezoneLabel')}</label>
              <select className="dpSelect" value={draft.timezone} disabled={ro}
                onChange={e => patch({ timezone: e.target.value })}>
                {timezoneOptions(draft.timezone, locale).map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            <div className="dpSeg">
              {([
                ['daily', t('dailyPromptSection.scheduleDaily')],
                ['weekdays', t('dailyPromptSection.scheduleWeekdays')],
                ['weekly', t('dailyPromptSection.scheduleWeekly')],
              ] as [ScheduleType, string][]).map(([type, label]) => (
                <button key={type} type="button" disabled={ro}
                  className={`dpSegBtn${draft.schedule.type === type ? ' active' : ''}`}
                  onClick={() => patchSchedule(type)}>{label}</button>
              ))}
            </div>
            {draft.schedule.type === 'weekly' && (
              <div className="dpWeekdays">
                {weekdays.map(w => (
                  <button key={w.value} type="button" disabled={ro}
                    className={`dpDayChip${(draft.schedule.days ?? []).includes(w.value) ? ' active' : ''}`}
                    onClick={() => toggleWeekday(w.value)}>{w.short}</button>
                ))}
              </div>
            )}
          </div>

          {/* Источник вопросов */}
          <div className="dpGroup">
            <div className="dpGroupTitle">{t('dailyPromptSection.sourceGroupTitle')}</div>

            <div className="dpMasterRow dpSub">
              <div className="dpMasterText">
                <div className="dpMasterLabel">{t('dailyPromptSection.builtinLabel')}</div>
                <div className="dpMasterSub">{t('dailyPromptSection.builtinSub')}</div>
              </div>
              <Toggle value={draft.source.use_builtin} disabled={ro}
                onChange={v => patch({ source: { ...draft.source, use_builtin: v } })} />
            </div>
            {draft.source.use_builtin && (
              <div className="dpBanks">
                {banks.map(b => (
                  <button key={b.id} type="button" disabled={ro}
                    className={`dpBankChip${draft.source.banks.includes(b.id) ? ' active' : ''}`}
                    onClick={() => toggleBank(b.id)}>
                    {b.label}<span className="dpBankCount">{b.count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="dpMasterRow dpSub">
              <div className="dpMasterText">
                <div className="dpMasterLabel">{t('dailyPromptSection.customLabel')}</div>
                <div className="dpMasterSub">{t('dailyPromptSection.customSub')}</div>
              </div>
              <Toggle value={draft.source.use_custom} disabled={ro}
                onChange={v => patch({ source: { ...draft.source, use_custom: v } })} />
            </div>
            {draft.source.use_custom && (
              <div className="dpQuestions">
                {questions.length === 0 && <div className="dpQEmpty">{t('dailyPromptSection.noCustomQuestions')}</div>}
                {questions.map(q => (
                  <div key={q.id} className="dpQItem">
                    <span className="dpQText">{q.text}</span>
                    {!ro && (
                      <button className="dpQDel" title={t('dailyPromptSection.deleteQuestion')} onClick={() => removeQuestion(q.id)}>✕</button>
                    )}
                  </div>
                ))}
                {!ro && (
                  <div className="dpQAdd">
                    <input className="dpQInput" placeholder={t('dailyPromptSection.newQuestionPlaceholder')} value={newQuestion}
                      maxLength={300}
                      onChange={e => setNewQuestion(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addQuestion(); }} />
                    <button className="dpQAddBtn" disabled={qBusy || !newQuestion.trim()} onClick={addQuestion}>
                      {qBusy ? '…' : t('dailyPromptSection.add')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="dpSeg dpOrderSeg">
              {([
                ['shuffle', t('dailyPromptSection.orderShuffle')],
                ['sequential', t('dailyPromptSection.orderSequential')],
              ] as [OrderMode, string][]).map(([mode, label]) => (
                <button key={mode} type="button" disabled={ro}
                  className={`dpSegBtn${draft.order_mode === mode ? ' active' : ''}`}
                  onClick={() => patch({ order_mode: mode })}>{label}</button>
              ))}
            </div>

            {!hasSource && (
              <div className="dpWarn">{t('dailyPromptSection.noSourceWarning')}</div>
            )}
          </div>

          {/* Уведомление */}
          <div className="dpGroup">
            <div className="dpMasterRow">
              <div className="dpMasterText">
                <div className="dpMasterLabel">{t('dailyPromptSection.pushLabel')}</div>
                <div className="dpMasterSub">{t('dailyPromptSection.pushSub')}</div>
              </div>
              <Toggle value={draft.push_enabled} disabled={ro}
                onChange={v => patch({ push_enabled: v })} />
            </div>
            {draft.push_enabled && (
              <input className="dpQInput dpPushInput" placeholder={t('dailyPromptSection.pushPlaceholder')} maxLength={120}
                disabled={ro} value={draft.push_text ?? ''}
                onChange={e => patch({ push_text: e.target.value })} />
            )}
          </div>

          {/* Действия */}
          {!ro && (
            <div className="dpActions">
              <button className="dpAskNow" onClick={askNow} disabled={asking || !hasSource} title={t('dailyPromptSection.askNowTitle')}>
                {asking ? '…' : t('dailyPromptSection.askNow')}
              </button>
              {onOpenArchive && (
                <button className="dpArchiveBtn" onClick={onOpenArchive}>{t('dailyPromptSection.archive')}</button>
              )}
            </div>
          )}
        </>
      )}

      {ro && onOpenArchive && (
        <div className="dpActions">
          <button className="dpArchiveBtn" onClick={onOpenArchive}>{t('dailyPromptSection.archive')}</button>
        </div>
      )}

      {error && <div className="dpError">{error}</div>}

      {!ro && (
        <div className="dpFooter">
          {savedFlash && !dirty && <span className="dpSaved">{t('dailyPromptSection.saved')}</span>}
          {dirty && <span className="dpDirty">{t('dailyPromptSection.unsaved')}</span>}
          <button className="dpSaveBtn" onClick={save} disabled={!dirty || saving}>
            {saving ? '…' : t('dailyPromptSection.save')}
          </button>
        </div>
      )}
    </div>
  );
}
