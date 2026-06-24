import { useChatsStore } from '../../store/useChatsStore';
import { OnboardingWelcome } from './OnboardingWelcome';

export function EmptyState() {
  // Новый пользователь (нет реальных диалогов, кроме «Избранного») → онбординг.
  const hasRealChats = useChatsStore(s => s.chats.some(c => c.type !== 'saved'));

  if (!hasRealChats) return <OnboardingWelcome />;

  return (
    <div className="emptyState">
      <div className="emptyLogo">B</div>
      <div className="emptyTitle">Blizkie</div>
      <div className="emptySub">Выберите чат или найдите пользователя</div>
    </div>
  );
}
