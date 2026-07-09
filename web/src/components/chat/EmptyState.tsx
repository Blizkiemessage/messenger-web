import { useTranslation } from 'react-i18next';
import { useChatsStore } from '../../store/useChatsStore';
import { OnboardingWelcome } from './OnboardingWelcome';

export function EmptyState() {
  const { t } = useTranslation('chat');
  // Новый пользователь (нет реальных диалогов, кроме «Избранного») → онбординг.
  const hasRealChats = useChatsStore(s => s.chats.some(c => c.type !== 'saved'));

  if (!hasRealChats) return <OnboardingWelcome />;

  return (
    <div className="emptyState">
      <div className="emptyLogo">B</div>
      <div className="emptyTitle">{t('emptyState.title')}</div>
      <div className="emptySub">{t('emptyState.subtitle')}</div>
    </div>
  );
}
