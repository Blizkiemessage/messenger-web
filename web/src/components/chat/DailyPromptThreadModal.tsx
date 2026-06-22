/**
 * DailyPromptThreadModal — тред ответов на «Вопрос дня» + архив.
 *
 * Два режима в одном компоненте:
 *   - instanceId задан → сразу открыт тред конкретного вопроса;
 *   - instanceId = null → архив: список заданных вопросов, выбор открывает тред.
 *
 * Ответы любым форматом: текст / голос / кружок / медиа — через переиспользование
 * Composer (ему передаём только text+attachment-колбэки, чат-фичи скрыты).
 * Медиа в ответах рендерятся теми же плеерами, что и сообщения.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { type Chat } from '../../types';
import type { UploadResult } from '../../api/upload';
import {
  getDailyThread, addDailyAnswer, deleteDailyAnswer, listDailyInstances,
  type DailyPromptAnswer, type DailyPromptInstance,
} from '../../api/dailyPrompts';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { AudioPlayer, VideoNotePlayer } from './messageBubble/MediaPlayers';
import { ImageAttachment, VideoAttachment, FileCard } from './messageBubble/attachments';
import { Composer } from './Composer';
import { renderMarkdown } from '../../utils/markdown';
import { formatDateSeparator } from '../../utils/format';

interface Props {
  chat: Chat;
  meId: string;
  instanceId: string | null; // null → режим архива
  onClose: () => void;
}

export function DailyPromptThreadModal({ chat, meId, instanceId, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(instanceId);
  const fromArchive = instanceId == null;

  return (
    <div className="modalOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard dpThreadCard">
        {selected
          ? <ThreadView chat={chat} meId={meId} instanceId={selected}
              onBack={fromArchive ? () => setSelected(null) : null} onClose={onClose} />
          : <ArchiveView chat={chat} meId={meId} onPick={setSelected} onClose={onClose} />}
      </div>
    </div>
  );
}

// ── Архив ────────────────────────────────────────────────────────────────────

function ArchiveView({ chat, meId: _meId, onPick, onClose }: {
  chat: Chat; meId: string; onPick: (id: string) => void; onClose: () => void;
}) {
  const [items, setItems] = useState<DailyPromptInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDailyInstances(chat.id)
      .then(r => { if (alive) setItems(r.items); })
      .catch(e => { if (alive) setError(e?.message || 'Ошибка'); });
    return () => { alive = false; };
  }, [chat.id]);

  return (
    <>
      <div className="dpThreadHeader">
        <div className="dpThreadTitle">Архив вопросов</div>
        <button className="upCloseBtn" onClick={onClose}>✕</button>
      </div>
      <div className="dpThreadBody">
        {error && <div className="dpError">{error}</div>}
        {!items && !error && <div className="dpLoading">Загрузка…</div>}
        {items && items.length === 0 && <div className="dpQEmpty">Вопросов ещё не было</div>}
        {items && items.map(it => (
          <button key={it.id} className="dpArchiveItem" onClick={() => onPick(it.id)}>
            <div className="dpArchiveQ">{it.text}</div>
            <div className="dpArchiveMeta">
              <span>{formatDateSeparator(it.created_at)}</span>
              <span className="dpArchiveCount">{it.answer_count} {plural(it.answer_count, 'ответ', 'ответа', 'ответов')}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

// ── Тред одного вопроса ──────────────────────────────────────────────────────

function ThreadView({ chat, meId, instanceId, onBack, onClose }: {
  chat: Chat; meId: string; instanceId: string; onBack: (() => void) | null; onClose: () => void;
}) {
  const [question, setQuestion] = useState<string>('');
  const [answers, setAnswers] = useState<DailyPromptAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [activeVN, setActiveVN] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const memberById = useCallback((id: string) => chat.members.find(m => m.id === id), [chat.members]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDailyThread(chat.id, instanceId)
      .then(r => { if (!alive) return; setQuestion(r.instance.text); setAnswers(r.answers); })
      .catch(e => { if (alive) setError(e?.message || 'Ошибка'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [chat.id, instanceId]);

  // Realtime: ответы других участников приходят через window-событие из useSocket
  useEffect(() => {
    function onAnswer(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d?.instance_id !== instanceId) return;
      setAnswers(prev => prev.some(a => a.id === d.answer.id) ? prev : [...prev, d.answer]);
    }
    function onDeleted(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d?.instance_id !== instanceId) return;
      setAnswers(prev => prev.filter(a => a.id !== d.answer_id));
    }
    window.addEventListener('dp-answer', onAnswer);
    window.addEventListener('dp-answer-deleted', onDeleted);
    return () => {
      window.removeEventListener('dp-answer', onAnswer);
      window.removeEventListener('dp-answer-deleted', onDeleted);
    };
  }, [instanceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [answers.length]);

  const sendText = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      const r = await addDailyAnswer(chat.id, instanceId, { text });
      setAnswers(prev => [...prev, r.answer]);
    } catch (e: any) { setError(e?.message || 'Не удалось отправить'); }
  }, [draft, chat.id, instanceId]);

  const sendAttachment = useCallback(async (result: UploadResult, caption: string) => {
    try {
      const r = await addDailyAnswer(chat.id, instanceId, {
        text: caption.trim() || undefined,
        attachment_url: result.url,
        attachment_type: result.type,
        attachment_name: result.name,
        attachment_size: result.size,
        attachment_duration: result.duration,
        voice_waveform: result.waveform ? JSON.stringify(result.waveform) : undefined,
      });
      setAnswers(prev => [...prev, r.answer]);
    } catch (e: any) { setError(e?.message || 'Не удалось отправить'); }
  }, [chat.id, instanceId]);

  const removeAnswer = useCallback(async (id: string) => {
    try {
      await deleteDailyAnswer(chat.id, id);
      setAnswers(prev => prev.filter(a => a.id !== id));
    } catch (e: any) { setError(e?.message || 'Не удалось удалить'); }
  }, [chat.id]);

  return (
    <>
      <div className="dpThreadHeader">
        {onBack && (
          <button className="dpThreadBack" onClick={onBack} title="К списку">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <div className="dpThreadTitle">🌙 Вопрос дня</div>
        <button className="upCloseBtn" onClick={onClose}>✕</button>
      </div>

      <div className="dpThreadQuestion">{question}</div>

      <div className="dpThreadBody">
        {error && <div className="dpError">{error}</div>}
        {loading && <div className="dpLoading">Загрузка…</div>}
        {!loading && answers.length === 0 && (
          <div className="dpQEmpty">Пока никто не ответил. Будьте первым 🌟</div>
        )}
        {answers.map(a => {
          const isOwn = a.user_id === meId;
          const u = memberById(a.user_id);
          const name = isOwn ? 'Вы' : (u?.display_name || u?.username || 'Участник');
          const url = resolveUrl(a.attachment_url) ?? a.attachment_url ?? '';
          return (
            <div key={a.id} className={`dpAnswer${isOwn ? ' own' : ''}`}>
              <Avatar user={u ?? null} size={32} radius={10} />
              <div className="dpAnswerBody">
                <div className="dpAnswerHead">
                  <span className="dpAnswerName">{name}</span>
                  {isOwn && (
                    <button className="dpAnswerDel" title="Удалить" onClick={() => removeAnswer(a.id)}>✕</button>
                  )}
                </div>
                {a.attachment_type === 'audio' && (
                  <AudioPlayer url={url} isOwn={isOwn} isRead={false} sendTime={a.created_at}
                    msgId={a.id} senderName={name} initialDuration={a.attachment_duration ?? undefined}
                    waveformStr={a.voice_waveform ?? null} />
                )}
                {a.attachment_type === 'video_note' && (
                  <VideoNotePlayer url={url} msgId={a.id} isActive={activeVN === a.id}
                    onActivate={setActiveVN} onEnded={() => setActiveVN(null)}
                    isOwn={isOwn} isRead={false} sendTime={a.created_at} isGroup={false}
                    senderName={name} initialDuration={a.attachment_duration ?? undefined} />
                )}
                {a.attachment_type === 'image' && (
                  <ImageAttachment url={url} name={a.attachment_name || 'image'} size={a.attachment_size} isOwn={isOwn} />
                )}
                {a.attachment_type === 'video' && (
                  <VideoAttachment url={url} name={a.attachment_name || undefined} />
                )}
                {a.attachment_type && !['audio','video_note','image','video'].includes(a.attachment_type) && (
                  <FileCard url={url} name={a.attachment_name || 'file'} size={a.attachment_size} isOwn={isOwn} />
                )}
                {a.text && <div className="dpAnswerText">{renderMarkdown(a.text, {})}</div>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="dpThreadComposer">
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={sendText}
          onSendAttachment={sendAttachment}
        />
      </div>
    </>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
