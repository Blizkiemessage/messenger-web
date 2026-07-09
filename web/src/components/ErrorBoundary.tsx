import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

interface Props {
  children: ReactNode;
  /** Custom fallback UI. If omitted, a full-screen "reload" card is shown. */
  fallback?: ReactNode;
  /** Label used in the default fallback's log line (e.g. 'call-overlay'). */
  scope?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Class component is the only way React lets you catch render errors
 * (getDerivedStateFromError/componentDidCatch have no hook equivalent).
 * Without this, any uncaught render exception unmounts the whole app —
 * the user sees a blank white screen with no way back short of a manual reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return <DefaultFallback />;
  }
}

function DefaultFallback() {
  const { t } = useTranslation('common');
  return (
    <div className="modalOverlay" style={{ zIndex: 20000 }}>
      <div className="confirmCard">
        <div className="confirmIcon" style={{ color: 'var(--danger)' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="confirmTitle">{t('errorGeneric')}</div>
        <div className="confirmText">
          {t('errorBoundaryText')}
        </div>
        <div className="confirmBtns">
          <button className="psDeleteCancelBtn" onClick={() => useAppStore.getState().setShowSupport(true)}>
            {t('contactSupport')}
          </button>
          <button className="psDeleteConfirmBtn" onClick={() => window.location.reload()}>
            {t('reload')}
          </button>
        </div>
      </div>
    </div>
  );
}
