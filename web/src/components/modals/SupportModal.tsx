import { useEffect, useRef, useState } from 'react';
import { type User } from '../../types';
import { sendSupportReport } from '../../api/support';

interface Props {
  me: User;
  onClose: () => void;
}

type SupportType = 'bug' | 'feature';
type Step = 0 | 1 | 2;

const LABELS: Record<SupportType, string> = {
  bug:     'Отчёт об ошибке',
  feature: 'Предложение по развитию',
};

function draftKey(type: SupportType) {
  return `support_draft_${type}`;
}

function buildSubject(type: SupportType): string {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU'); // dd.mm.yyyy
  const time = now.toTimeString().slice(0, 8);   // hh:mm:ss
  return `${LABELS[type]} ${date} ${time}`;
}

export function SupportModal({ me, onClose }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [type, setType] = useState<SupportType | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load draft when entering the form step
  useEffect(() => {
    if (step === 1 && type) {
      const draft = localStorage.getItem(draftKey(type));
      if (draft) setDescription(draft);
    }
  }, [step, type]);

  // Persist draft as user types
  useEffect(() => {
    if (step === 1 && type && description) {
      localStorage.setItem(draftKey(type), description);
    }
  }, [description, step, type]);

  function selectType(t: SupportType) {
    setType(t);
    setSubject(buildSubject(t));
    setDescription('');
    setImage(null);
    setStep(1);
  }

  function goBack() {
    setStep(0);
    setType(null);
  }

  async function handleSubmit() {
    if (!description.trim() || !type) return;
    setSending(true);
    try {
      await sendSupportReport(subject, description.trim(), image ?? undefined);
      localStorage.removeItem(draftKey(type));
      setSuccess(true);
    } catch {
      setSuccess(false);
    } finally {
      setSending(false);
      setStep(2);
    }
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImage(file);
  }

  function removeImage() {
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="supportCard">

        {/* ── Step 0: Type selection ── */}
        {step === 0 && (
          <>
            <div className="supportTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
              Техническая поддержка
            </div>
            <p className="supportSubtitle">Выберите тип обращения</p>
            <div className="supportTypeGrid">
              <button className="supportTypeBtn" onClick={() => selectType('bug')}>
                <span className="supportTypeBtnIcon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2l1.88 1.88"/>
                    <path d="M14.12 3.88 16 2"/>
                    <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
                    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
                    <path d="M12 20v-9"/>
                    <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
                    <path d="M6 13H2"/>
                    <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
                    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
                    <path d="M22 13h-4"/>
                    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
                  </svg>
                </span>
                <span className="supportTypeBtnLabel">Отчёт об ошибке</span>
                <span className="supportTypeBtnDesc">Сообщите о баге или сбое</span>
              </button>

              <button className="supportTypeBtn" onClick={() => selectType('feature')}>
                <span className="supportTypeBtnIcon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4"/>
                    <path d="M12 16h.01"/>
                  </svg>
                </span>
                <span className="supportTypeBtnLabel">Предложение</span>
                <span className="supportTypeBtnDesc">Идея по развитию</span>
              </button>
            </div>

            <button className="supportCancelBtn" onClick={onClose}>Отмена</button>
          </>
        )}

        {/* ── Step 1: Form ── */}
        {step === 1 && type && (
          <>
            <div className="supportTitle">
              {type === 'bug' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2l1.88 1.88"/><path d="M14.12 3.88 16 2"/>
                  <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
                  <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
                  <path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
                  <path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
                  <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/>
                  <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4"/><path d="M12 16h.01"/>
                </svg>
              )}
              {LABELS[type]}
            </div>

            {/* Readonly meta row */}
            <div className="supportMetaRow">
              <span className="supportMetaChip">@{me.username}</span>
              <span className="supportMetaChip supportMetaSubject">{subject}</span>
            </div>

            {/* Description */}
            <div className="supportField">
              <label className="supportFieldLabel">
                {type === 'bug' ? 'Опишите проблему' : 'Напишите ваше предложение'}
                <span className="supportFieldRequired"> *</span>
              </label>
              <textarea
                className="supportTextarea"
                placeholder={type === 'bug' ? 'Что произошло? Как воспроизвести?' : 'Какую функцию вы хотели бы видеть?'}
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
              />
            </div>

            {/* Image attachment */}
            <div className="supportField">
              <label className="supportFieldLabel">
                Прикрепить фото
                <span className="supportFieldOptional"> (необязательно)</span>
              </label>
              {image ? (
                <div className="supportImagePreview">
                  <img src={URL.createObjectURL(image)} alt="preview" className="supportImageThumb" />
                  <span className="supportImageName">{image.name}</span>
                  <button className="supportImageRemove" onClick={removeImage} title="Удалить">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <label className="supportImageDropzone">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleImageChange}
                  />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>Выбрать изображение</span>
                </label>
              )}
            </div>

            {/* Actions */}
            <div className="supportActions">
              <button className="supportCancelBtn" onClick={goBack} disabled={sending}>Назад</button>
              <button
                className="supportSubmitBtn"
                onClick={handleSubmit}
                disabled={sending || !description.trim()}
              >
                {sending ? (
                  <span className="supportSpinner" />
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Отправить
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Result ── */}
        {step === 2 && (
          <>
            <div className="supportResult">
              <div className={`supportResultIcon ${success ? 'supportResultSuccess' : 'supportResultError'}`}>
                {success ? (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                )}
              </div>

              <div className="supportResultTitle">
                {success ? 'Письмо успешно отправлено!' : 'Не удалось отправить письмо'}
              </div>
              <div className="supportResultDesc">
                {success
                  ? 'Благодарим за обращение в техническую поддержку. Наши специалисты рассмотрят ваше обращение в ближайшее время.'
                  : 'Ваш текст сохранён в черновике — он появится при следующем открытии формы. Попробуйте отправить снова позже.'}
              </div>
            </div>

            <div className="supportActions" style={{ justifyContent: 'center' }}>
              {!success && (
                <button className="supportCancelBtn" onClick={() => { setStep(1); setSending(false); }}>
                  Попробовать снова
                </button>
              )}
              <button className="supportSubmitBtn" onClick={onClose}>Закрыть</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
