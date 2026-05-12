import { useState } from 'react';
import { downloadMyData } from '../../api/export';

type Status = 'idle' | 'loading' | 'done' | 'rate-limited' | 'error';

const CONTENTS = [
  { label: 'Профиль',          desc: 'Имя, email, дата регистрации' },
  { label: 'Сообщения',        desc: 'Все ваши чаты с расшифрованным текстом' },
  { label: 'Список друзей',    desc: 'Ваши контакты и дата добавления' },
  { label: 'История сессий',   desc: 'Устройства и IP-адреса входов' },
];

export function ExportDataTab() {
  const [status, setStatus] = useState<Status>('idle');

  async function handleExport() {
    setStatus('loading');
    try {
      await downloadMyData();
      setStatus('done');
    } catch (err: unknown) {
      const code = (err as { response?: { status?: number } })?.response?.status;
      setStatus(code === 429 ? 'rate-limited' : 'error');
    }
  }

  return (
    <div className="permTab">
      <p className="permTabHint">
        В соответствии с GDPR вы вправе получить копию всех ваших данных.
        Архив создаётся в реальном времени и сразу скачивается на устройство.
      </p>

      {/* What's included */}
      <div className="exportContents">
        {CONTENTS.map(item => (
          <div key={item.label} className="exportContentItem">
            <span className="exportCheckIcon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="3"
                   strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <span>
              <span className="exportContentLabel">{item.label}</span>
              <span className="exportContentDesc"> — {item.desc}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Status notices */}
      {status === 'done' && (
        <div className="exportNotice exportNoticeOk">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Архив скачан. Следующий экспорт доступен через час.
        </div>
      )}
      {status === 'rate-limited' && (
        <div className="exportNotice exportNoticeWarn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Лимит исчерпан. Экспорт доступен раз в час — попробуйте позже.
        </div>
      )}
      {status === 'error' && (
        <div className="exportNotice exportNoticeErr">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          Ошибка при создании архива. Попробуйте ещё раз.
        </div>
      )}

      {/* Download button */}
      <button
        className="exportBtn"
        onClick={handleExport}
        disabled={status === 'loading' || status === 'done' || status === 'rate-limited'}
      >
        {status === 'loading' ? (
          <>
            <span className="exportBtnSpinner" aria-hidden="true" />
            Создаём архив…
          </>
        ) : (
          <>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Скачать мои данные
          </>
        )}
      </button>

      <p className="exportNote">
        Формат: ZIP-архив с JSON-файлами. Лимит: 1 экспорт в час.
      </p>
    </div>
  );
}
