/**
 * WelcomeGuideCard — приветственная карточка «Избранного» (aналог DailyPromptCard):
 * рендерится вместо обычного текста, когда attachment_type === 'welcome_guide'.
 * Весь контент собирается через i18n (не хранится литеральным текстом в
 * сообщении) — поэтому переводится на язык UI автоматически, в отличие от
 * старых захардкоженных RU-сообщений, которые эта карточка заменяет.
 */
import { useTranslation } from 'react-i18next';
import { useDeepLinkStore } from '../../store/useDeepLinkStore';
import { type DeepLinkAction } from '../../deeplinks';

export function WelcomeGuideCard() {
  const { t } = useTranslation('chat');
  const open = useDeepLinkStore(s => s.open);
  const go = (action: DeepLinkAction) => open(action);

  return (
    <div className="wgCard">
      <div className="wgCardTitle">{t('welcomeGuide.title')}</div>
      <div className="wgCardIntro">{t('welcomeGuide.intro')}</div>
      <div className="wgCardLabel">{t('welcomeGuide.gettingStarted')}</div>
      <div className="wgCardCtas">
        <button className="wgCardCta" onClick={() => go({ type: 'invite' })}>{t('welcomeGuide.ctaInvite')}</button>
        <button className="wgCardCta" onClick={() => go({ type: 'find-friends' })}>{t('welcomeGuide.ctaFindFriends')}</button>
        <button className="wgCardCta" onClick={() => go({ type: 'create-group' })}>{t('welcomeGuide.ctaCreateGroup')}</button>
        <button className="wgCardCta" onClick={() => go({ type: 'appearance' })}>{t('welcomeGuide.ctaAppearance')}</button>
      </div>
      <div className="wgCardTip">{t('welcomeGuide.tip')}</div>
    </div>
  );
}
