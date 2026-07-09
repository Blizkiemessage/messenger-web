/**
 * OnboardingWelcome — «не пустой» первый экран для нового пользователя.
 * Показывается в области чата, когда у юзера ещё нет реальных диалогов:
 * приветствие, визуальное представление возможностей и призывы к действию
 * (пригласить близких / найти друзей / создать группу) через deep-links.
 */
import { useTranslation } from 'react-i18next';
import { useDeepLinkStore } from '../../store/useDeepLinkStore';
import { type DeepLinkAction } from '../../deeplinks';

export function OnboardingWelcome() {
  const { t } = useTranslation('chat');
  const open = useDeepLinkStore(s => s.open);
  const go = (action: DeepLinkAction) => open(action);

  const FEATURES: { icon: string; title: string; desc: string }[] = [
    { icon: '💬', title: t('onboarding.featureChatsTitle'), desc: t('onboarding.featureChatsDesc') },
    { icon: '🎤', title: t('onboarding.featureVoiceTitle'), desc: t('onboarding.featureVoiceDesc') },
    { icon: '📞', title: t('onboarding.featureCallsTitle'), desc: t('onboarding.featureCallsDesc') },
    { icon: '🌙', title: t('onboarding.featureDailyTitle'), desc: t('onboarding.featureDailyDesc') },
    { icon: '📝', title: t('onboarding.featureNotesTitle'), desc: t('onboarding.featureNotesDesc') },
    { icon: '🎨', title: t('onboarding.featureThemeTitle'), desc: t('onboarding.featureThemeDesc') },
  ];

  return (
    <div className="onbWrap">
      <div className="onbHero">
        <div className="onbLogo">B</div>
        <h1 className="onbTitle">{t('onboarding.title')}</h1>
        <p className="onbSub">
          {t('onboarding.subtitle')}
        </p>
        <div className="onbCtas">
          <button className="onbCta onbCtaPrimary" onClick={() => go({ type: 'invite' })}>{t('onboarding.ctaInvite')}</button>
          <button className="onbCta" onClick={() => go({ type: 'find-friends' })}>{t('onboarding.ctaFindFriends')}</button>
          <button className="onbCta" onClick={() => go({ type: 'create-group' })}>{t('onboarding.ctaCreateGroup')}</button>
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
          {t('onboarding.linkHowTo')}
        </button>
        <button className="onbLink" onClick={() => go({ type: 'assistant' })}>
          {t('onboarding.linkAssistant')}
        </button>
      </div>
    </div>
  );
}
