/**
 * OnboardingWelcome — «не пустой» первый экран для нового пользователя.
 * Показывается в области чата, когда у юзера ещё нет реальных диалогов:
 * приветствие, визуальное представление возможностей и призывы к действию
 * (пригласить близких / найти друзей / создать группу) через deep-links.
 */
import { useDeepLinkStore } from '../../store/useDeepLinkStore';
import { type DeepLinkAction } from '../../deeplinks';

const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: '💬', title: 'Личные и групповые чаты', desc: 'Общайтесь один-на-один и всей семьёй' },
  { icon: '🎤', title: 'Голосовые и кружки',      desc: 'Когда хочется голосом или лицом' },
  { icon: '📞', title: 'Звонки',                  desc: 'Аудио и видео прямо в приложении' },
  { icon: '🌙', title: 'Вопрос дня',              desc: 'Тёплый ежедневный ритуал для близких' },
  { icon: '📝', title: 'Заметки и опросы',        desc: 'Списки, планы и решения вместе' },
  { icon: '🎨', title: 'Оформление',              desc: 'Темы, акценты и фоны под себя' },
];

export function OnboardingWelcome() {
  const open = useDeepLinkStore(s => s.open);
  const go = (action: DeepLinkAction) => open(action);

  return (
    <div className="onbWrap">
      <div className="onbHero">
        <div className="onbLogo">B</div>
        <h1 className="onbTitle">Добро пожаловать в Blizkie</h1>
        <p className="onbSub">
          Тёплое место для общения с самыми близкими. Пригласите семью и друзей — и начните.
        </p>
        <div className="onbCtas">
          <button className="onbCta onbCtaPrimary" onClick={() => go({ type: 'invite' })}>Пригласить близких</button>
          <button className="onbCta" onClick={() => go({ type: 'find-friends' })}>Найти друзей</button>
          <button className="onbCta" onClick={() => go({ type: 'create-group' })}>Создать группу</button>
        </div>
      </div>

      <div className="onbGrid">
        {FEATURES.map(f => (
          <div key={f.title} className="onbCard">
            <div className="onbCardIcon" aria-hidden>{f.icon}</div>
            <div className="onbCardText">
              <div className="onbCardTitle">{f.title}</div>
              <div className="onbCardDesc">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="onbLinks">
        <button className="onbLink" onClick={() => go({ type: 'open-saved' })}>
          Как пользоваться приложением →
        </button>
        <button className="onbLink" onClick={() => go({ type: 'assistant' })}>
          Есть вопрос? Спросите помощника →
        </button>
      </div>
    </div>
  );
}
