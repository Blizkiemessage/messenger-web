/**
 * DailyPromptSection — настройка фичи «Вопрос дня» в хабе «Настройки чата».
 *
 * Конфиг редактируется черновиком и сохраняется одной кнопкой (PUT).
 * Свои вопросы добавляются/удаляются сразу (отдельные эндпоинты).
 * Без права управления (canManage=false) контролы только для чтения.
 */
import { useEffect, useMemo, useState } from 'react';
import { type Chat } from '../../../types';
import { Toggle } from '../../ui/Toggle';
import {
  getDailyPrompt, updateDailyPrompt, addDailyQuestion, deleteDailyQuestion, askDailyNow,
  type DailyPromptConfig, type DailyPromptBank, type CustomQuestion, type ScheduleType, type OrderMode,
} from '../../../api/dailyPrompts';
import { minutesToHHMM, hhmmToMinutes, WEEKDAYS, timezoneOptions } from './helpers';

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
        if (alive) setError(e?.message || 'Не удалось загрузить настройки');
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
      setError(e?.message || 'Не удалось сохранить');
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
      setError(e?.message || 'Не удалось добавить вопрос');
    } finally {
      setQBusy(false);
    }
  }

  async function removeQuestion(id: string) {
    try {
      await deleteDailyQuestion(chat.id, id);
      setQuestions(list => list.filter(q => q.id !== id));
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить вопрос');
    }
  }

  async function askNow() {
    setAsking(true); setError(null);
    try {
      await askDailyNow(chat.id);
    } catch (e: any) {
      setError(e?.message || 'Не удалось задать вопрос');
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <div className="dpLoading">Загрузка…</div>;
  if (!draft) return <div className="dpError">{error || 'Ошибка'}</div>;

  const ro = !canManage; // read-only
  const hasSource =
    (draft.source.use_builtin && draft.source.banks.length > 0) ||
    (draft.source.use_custom && questions.length > 0);

  return (
    <div className="dpSection">
      <div className="dpIntro">
        <div className="dpIntroIcon">🌙</div>
        <div className="dpIntroText">
          <div className="dpIntroTitle">Вопрос дня</div>
          <div className="dpIntroHint">
            Каждый день в чат приходит тёплый вопрос — общий ритуал, на который каждый отвечает текстом, голосом, кружком или фото.
          </div>
        </div>
        {streak > 0 && <div className="dpStreak" title="Дней подряд с ответами">🔥 {streak}</div>}
      </div>

      {ro && (
        <div className="dpReadonlyBanner">Настройки управляются администратором чата. Вы можете отвечать на вопросы.</div>
      )}

      <div className="dpMasterRow">
        <div className="dpMasterText">
          <div className="dpMasterLabel">Включить «Вопрос дня»</div>
          <div className="dpMasterSub">{draft.enabled ? 'Вопросы приходят по расписанию' : 'Сейчас выключено'}</div>
        </div>
        <Toggle value={draft.enabled} onChange={v => patch({ enabled: v })} disabled={ro} />
      </div>

      {draft.enabled && (
        <>
          {/* Время и пояс */}
          <div className="dpGroup">
            <div className="dpGroupTitle">Когда присылать</div>
            <div className="dpRow">
              <label className="dpFieldLabel">Время</label>
              <input type="time" className="dpTimeInput" value={minutesToHHMM(draft.send_time)}
                disabled={ro} onChange={e => patch({ send_time: hhmmToMinutes(e.target.value) })} />
            </div>
            <div className="dpRow">
              <label className="dpFieldLabel">Часовой пояс</label>
              <select className="dpSelect" value={draft.timezone} disabled={ro}
                onChange={e => patch({ timezone: e.target.value })}>
                {timezoneOptions(draft.timezone).map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            <div className="dpSeg">
              {([['daily', 'Каждый день'], ['weekdays', 'По будням'], ['weekly', 'По дням']] as [ScheduleType, string][]).map(([t, label]) => (
                <button key={t} type="button" disabled={ro}
                  className={`dpSegBtn${draft.schedule.type === t ? ' active' : ''}`}
                  onClick={() => patchSchedule(t)}>{label}</button>
              ))}
            </div>
            {draft.schedule.type === 'weekly' && (
              <div className="dpWeekdays">
                {WEEKDAYS.map(w => (
                  <button key={w.value} type="button" disabled={ro}
                    className={`dpDayChip${(draft.schedule.days ?? []).includes(w.value) ? ' active' : ''}`}
                    onClick={() => toggleWeekday(w.value)}>{w.short}</button>
                ))}
              </div>
            )}
          </div>

          {/* Источник вопросов */}
          <div className="dpGroup">
            <div className="dpGroupTitle">Откуда брать вопросы</div>

            <div className="dpMasterRow dpSub">
              <div className="dpMasterText">
                <div className="dpMasterLabel">Готовые подборки</div>
                <div className="dpMasterSub">Тематические вопросы из встроенных банков</div>
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
                <div className="dpMasterLabel">Свои вопросы</div>
                <div className="dpMasterSub">Добавьте вопросы специально для вашего чата</div>
              </div>
              <Toggle value={draft.source.use_custom} disabled={ro}
                onChange={v => patch({ source: { ...draft.source, use_custom: v } })} />
            </div>
            {draft.source.use_custom && (
              <div className="dpQuestions">
                {questions.length === 0 && <div className="dpQEmpty">Пока нет своих вопросов</div>}
                {questions.map(q => (
                  <div key={q.id} className="dpQItem">
                    <span className="dpQText">{q.text}</span>
                    {!ro && (
                      <button className="dpQDel" title="Удалить" onClick={() => removeQuestion(q.id)}>✕</button>
                    )}
                  </div>
                ))}
                {!ro && (
                  <div className="dpQAdd">
                    <input className="dpQInput" placeholder="Новый вопрос…" value={newQuestion}
                      maxLength={300}
                      onChange={e => setNewQuestion(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addQuestion(); }} />
                    <button className="dpQAddBtn" disabled={qBusy || !newQuestion.trim()} onClick={addQuestion}>
                      {qBusy ? '…' : 'Добавить'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="dpSeg dpOrderSeg">
              {([['shuffle', 'Вперемешку'], ['sequential', 'По порядку']] as [OrderMode, string][]).map(([t, label]) => (
                <button key={t} type="button" disabled={ro}
                  className={`dpSegBtn${draft.order_mode === t ? ' active' : ''}`}
                  onClick={() => patch({ order_mode: t })}>{label}</button>
              ))}
            </div>

            {!hasSource && (
              <div className="dpWarn">Выберите хотя бы одну подборку или добавьте свой вопрос — иначе присылать будет нечего.</div>
            )}
          </div>

          {/* Уведомление */}
          <div className="dpGroup">
            <div className="dpMasterRow">
              <div className="dpMasterText">
                <div className="dpMasterLabel">Push-уведомление</div>
                <div className="dpMasterSub">Напоминать о новом вопросе</div>
              </div>
              <Toggle value={draft.push_enabled} disabled={ro}
                onChange={v => patch({ push_enabled: v })} />
            </div>
            {draft.push_enabled && (
              <input className="dpQInput dpPushInput" placeholder="🌙 Вопрос дня" maxLength={120}
                disabled={ro} value={draft.push_text ?? ''}
                onChange={e => patch({ push_text: e.target.value })} />
            )}
          </div>

          {/* Действия */}
          {!ro && (
            <div className="dpActions">
              <button className="dpAskNow" onClick={askNow} disabled={asking || !hasSource} title="Задать вопрос прямо сейчас">
                {asking ? '…' : 'Задать сейчас'}
              </button>
              {onOpenArchive && (
                <button className="dpArchiveBtn" onClick={onOpenArchive}>Архив вопросов</button>
              )}
            </div>
          )}
        </>
      )}

      {ro && onOpenArchive && (
        <div className="dpActions">
          <button className="dpArchiveBtn" onClick={onOpenArchive}>Архив вопросов</button>
        </div>
      )}

      {error && <div className="dpError">{error}</div>}

      {!ro && (
        <div className="dpFooter">
          {savedFlash && !dirty && <span className="dpSaved">Сохранено ✓</span>}
          {dirty && <span className="dpDirty">● не сохранено</span>}
          <button className="dpSaveBtn" onClick={save} disabled={!dirty || saving}>
            {saving ? '…' : 'Сохранить'}
          </button>
        </div>
      )}
    </div>
  );
}
