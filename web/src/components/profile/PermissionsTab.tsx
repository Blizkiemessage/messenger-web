import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { registerPush, hasActivePushSubscription } from '../../utils/push';

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported';

function usePermission(name: PermissionName | null): PermState {
  const [state, setState] = useState<PermState>('prompt');

  useEffect(() => {
    if (!name) { setState('unsupported'); return; }
    if (!navigator.permissions) { setState('prompt'); return; }
    let perm: PermissionStatus | null = null;

    navigator.permissions.query({ name } as PermissionDescriptor)
      .then(p => {
        perm = p;
        setState(p.state as PermState);
        p.onchange = () => setState(p.state as PermState);
      })
      .catch(() => setState('prompt'));

    return () => { if (perm) perm.onchange = null; };
  }, [name]);

  return state;
}

function StateBadge({ state }: { state: PermState }) {
  const { t } = useTranslation('settings');
  if (state === 'granted')     return <span className="permBadge permBadgeGranted">{t('permissions.granted')}</span>;
  if (state === 'denied')      return <span className="permBadge permBadgeDenied">{t('permissions.denied')}</span>;
  if (state === 'unsupported') return <span className="permBadge permBadgeUnknown">{t('permissions.unsupported')}</span>;
  return <span className="permBadge permBadgePrompt">{t('permissions.notRequested')}</span>;
}

export function PermissionsTab() {
  const { t } = useTranslation('settings');
  const cameraState  = usePermission('camera' as PermissionName);
  const micState     = usePermission('microphone' as PermissionName);
  const notifState   = usePermission(
    typeof Notification !== 'undefined' ? 'notifications' as PermissionName : null
  );

  const [cameraErr,  setCameraErr]  = useState<string | null>(null);
  const [micErr,     setMicErr]     = useState<string | null>(null);
  const [notifErr,   setNotifErr]   = useState<string | null>(null);

  // Browser permission can be "granted" while the actual push subscription
  // died in the background (common on iOS Safari) — check separately so we
  // can offer a one-click reconnect instead of failing silently forever.
  const [pushSubscribed, setPushSubscribed] = useState<boolean | null>(null);
  const [reconnecting,   setReconnecting]   = useState(false);

  useEffect(() => {
    if (notifState !== 'granted') { setPushSubscribed(null); return; }
    let cancelled = false;
    hasActivePushSubscription().then(v => { if (!cancelled) setPushSubscribed(v); });
    return () => { cancelled = true; };
  }, [notifState]);

  const reconnectPush = useCallback(async () => {
    setReconnecting(true);
    setNotifErr(null);
    const result = await registerPush();
    setPushSubscribed(result.ok);
    if (!result.ok) setNotifErr(t('permissions.pushConnectError'));
    setReconnecting(false);
  }, [t]);

  const requestCamera = useCallback(async () => {
    setCameraErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      setCameraErr(t('permissions.blockedByBrowser'));
    }
  }, [t]);

  const requestMic = useCallback(async () => {
    setMicErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      setMicErr(t('permissions.blockedByBrowser'));
    }
  }, [t]);

  const requestNotif = useCallback(async () => {
    setNotifErr(null);
    try {
      const result = await Notification.requestPermission();
      if (result === 'denied') {
        setNotifErr(t('permissions.notificationsBlocked'));
      }
    } catch {
      setNotifErr(t('permissions.requestFailed'));
    }
  }, [t]);

  const items: Array<{
    id: 'camera' | 'microphone' | 'notifications';
    label: string;
    description: string;
    state: PermState;
    err: string | null;
    onRequest: (() => void) | null;
    icon: ReactNode;
  }> = [
    {
      id: 'camera',
      label: t('permissions.camera'),
      description: t('permissions.cameraDesc'),
      state: cameraState,
      err: cameraErr,
      onRequest: cameraState === 'denied' ? null : requestCamera,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      ),
    },
    {
      id: 'microphone',
      label: t('permissions.microphone'),
      description: t('permissions.microphoneDesc'),
      state: micState,
      err: micErr,
      onRequest: micState === 'denied' ? null : requestMic,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      ),
    },
    {
      id: 'notifications',
      label: t('permissions.notifications'),
      description: t('permissions.notificationsDesc'),
      state: notifState,
      err: notifErr,
      onRequest: notifState === 'denied' ? null
               : typeof Notification === 'undefined' ? null
               : requestNotif,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="permTab">
      <p className="permTabHint">
        {t('permissions.hint')}
      </p>

      <div className="permList">
        {items.map(item => (
          <div className="permItem" key={item.label}>
            <div className="permIcon">{item.icon}</div>
            <div className="permInfo">
              <div className="permLabel">
                {item.label}
                <StateBadge state={item.state} />
              </div>
              <div className="permDesc">{item.description}</div>
              {item.err && <div className="permErr">{item.err}</div>}
              {item.state === 'denied' && !item.err && (
                <div className="permErr">
                  {t('permissions.blockedByBrowserShort')}
                </div>
              )}
              {/* Permission can be "granted" while the push subscription itself died in the
                  background (common on iOS Safari) — surface that separately from the OS-level state. */}
              {item.id === 'notifications' && notifState === 'granted' && pushSubscribed === false && !notifErr && (
                <div className="permErr">{t('permissions.pushNotConnected')}</div>
              )}
            </div>
            {item.onRequest && item.state !== 'granted' && item.state !== 'unsupported' && (
              <button className="permRequestBtn" onClick={item.onRequest}>
                {t('permissions.allowBtn')}
              </button>
            )}
            {item.id === 'notifications' && notifState === 'granted' && pushSubscribed === false && (
              <button className="permRequestBtn" onClick={reconnectPush} disabled={reconnecting}>
                {reconnecting ? '…' : t('permissions.reconnectBtn')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
