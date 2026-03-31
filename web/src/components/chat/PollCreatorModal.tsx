import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CreatePollData } from '../../api/polls';

const uuidv4 = () => crypto.randomUUID();

interface Props {
  onClose: () => void;
  onCreatePoll: (data: CreatePollData) => Promise<void>;
}

export function PollCreatorModal({ onClose, onCreatePoll }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([
    { id: uuidv4(), text: '' },
    { id: uuidv4(), text: '' },
  ]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isQuiz, setIsQuiz] = useState(false);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on overlay click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function addOption() {
    if (options.length >= 10) return;
    setOptions(prev => [...prev, { id: uuidv4(), text: '' }]);
  }

  function removeOption(id: string) {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter(o => o.id !== id));
    if (correctOptionId === id) setCorrectOptionId(null);
  }

  function updateOption(id: string, text: string) {
    setOptions(prev => prev.map(o => o.id === id ? { ...o, text } : o));
  }

  async function handleSubmit() {
    const q = question.trim();
    if (!q) { setError('Введите вопрос'); return; }
    const filled = options.filter(o => o.text.trim());
    if (filled.length < 2) { setError('Нужно минимум 2 варианта ответа'); return; }
    if (isQuiz && !correctOptionId) { setError('Выберите правильный ответ для режима викторины'); return; }

    setBusy(true);
    setError(null);
    try {
      await onCreatePoll({
        question: q,
        options: filled,
        allow_multiple: allowMultiple,
        is_anonymous: isAnonymous,
        is_quiz: isQuiz && !allowMultiple,
        correct_option_id: (isQuiz && !allowMultiple) ? correctOptionId : null,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка создания опроса');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modalOverlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modalCard pollCreatorCard">
        <div className="modalHeader">
          <div className="modalTitle">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="8" x2="11" y2="8"/><line x1="8" y1="16" x2="14" y2="16"/>
            </svg>
            Создать опрос
          </div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modalBody">
          {error && <div className="modalError">{error}</div>}

          <div className="modalField">
            <label className="modalLabel">Вопрос *</label>
            <input
              className="modalInput"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Введите вопрос…"
              autoFocus
              maxLength={300}
            />
          </div>

          <div className="modalField">
            <label className="modalLabel">Варианты ответов</label>
            {options.map((opt, idx) => (
              <div key={opt.id} className="pollOptionInput">
                {isQuiz && !allowMultiple && (
                  <button
                    className={`pollQuizMark${correctOptionId === opt.id ? ' active' : ''}`}
                    onClick={() => setCorrectOptionId(opt.id === correctOptionId ? null : opt.id)}
                    title="Отметить как правильный"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={correctOptionId === opt.id ? '#f59e0b' : 'none'} stroke={correctOptionId === opt.id ? '#f59e0b' : 'currentColor'} strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                )}
                <input
                  className="modalInput"
                  value={opt.text}
                  onChange={e => updateOption(opt.id, e.target.value)}
                  placeholder={`Вариант ${idx + 1}`}
                  maxLength={100}
                />
                {options.length > 2 && (
                  <button className="pollRemoveOption" onClick={() => removeOption(opt.id)} title="Удалить">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button className="pollAddOption" onClick={addOption}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Добавить вариант
              </button>
            )}
          </div>

          {/* Settings */}
          <div className="pollToggleRow">
            <span className="modalLabel" style={{ marginBottom: 0 }}>Выбор ответов</span>
            <div className="pollToggle">
              <button className={`pollToggleBtn${!allowMultiple ? ' active' : ''}`} onClick={() => { setAllowMultiple(false); }}>Один</button>
              <button className={`pollToggleBtn${allowMultiple ? ' active' : ''}`} onClick={() => { setAllowMultiple(true); setIsQuiz(false); }}>Несколько</button>
            </div>
          </div>

          <div className="pollToggleRow">
            <span className="modalLabel" style={{ marginBottom: 0 }}>Анонимный опрос</span>
            <button
              className={`pollAnonToggle${isAnonymous ? ' active' : ''}`}
              onClick={() => setIsAnonymous(v => !v)}
            >
              <span className="pollAnonKnob" />
            </button>
          </div>

          {!allowMultiple && (
            <div className="pollToggleRow">
              <span className="modalLabel" style={{ marginBottom: 0 }}>Режим викторины</span>
              <label className="pollCheckbox">
                <input type="checkbox" checked={isQuiz} onChange={e => { setIsQuiz(e.target.checked); if (!e.target.checked) setCorrectOptionId(null); }} />
                <span className="pollCheckboxBox" />
              </label>
            </div>
          )}
        </div>

        <div className="modalFooter">
          <button className="modalBtnSecondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="modalBtnPrimary" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Создание…' : 'Создать опрос'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
