/**
 * AssistantOrb — светящаяся плавающая кнопка-«орб» входа в ассистента.
 *
 * Основной, заметный вход в помощника (Этап C/D). Рендерится в сайдбаре
 * (всегда на виду на desktop и в списке чатов) и компактно в шапке чата на
 * мобильном (где сайдбар скрыт). Клик открывает AssistantModal.
 *
 * Вариант задаётся классом-модификатором: `asstOrbSidebar` | `asstOrbHeader`.
 */
interface Props {
  onClick: () => void;
  /** Модификатор размещения: 'asstOrbSidebar' (плавающий) | 'asstOrbHeader' (в шапке). */
  variant?: 'asstOrbSidebar' | 'asstOrbHeader';
  title?: string;
}

export function AssistantOrb({ onClick, variant = 'asstOrbSidebar', title = 'Помощник' }: Props) {
  return (
    <button
      type="button"
      className={`asstOrb ${variant}`}
      onClick={onClick}
      title={title}
      aria-label="Открыть помощника"
    >
      <span className="asstOrbAura" aria-hidden />
      <svg
        className="asstOrbIcon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* крупная искра + две маленькие — «магия/помощник» */}
        <path d="M12 3.2l1.7 5.1 5.1 1.7-5.1 1.7L12 16.8l-1.7-5.1L5.2 10l5.1-1.7z" />
        <path d="M18.5 14.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" />
        <path d="M5 5l.4 1.2L6.6 6.6 5.4 7 5 8.2 4.6 7 3.4 6.6 4.6 6.2z" />
      </svg>
    </button>
  );
}
