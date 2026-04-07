import { useState, useEffect, useCallback } from 'react';

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported';

interface PermItem {
  key: string;
  label: string;
  description: string;
  icon: JSX.Element;
  state: PermState;
  request: (() => Promise<void>) | null;
}

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
  if (state === 'granted')     return <span className="permBadge permBadgeGranted">Разрешено</span>;
  if (state === 'denied')      return <span className="permBadge permBadgeDenied">Запрещено</span>;
  if (state === 'unsupported') return <span className="permBadge permBadgeUnknown">Недоступно</span>;
  return <span className="permBadge permBadgePrompt">Не запрошено</span>;
}

export function PermissionsTab() {
  const cameraState  = usePermission('camera' as PermissionName);
  const micState     = usePermission('microphone' as PermissionName);
  const notifState   = usePermission(
    typeof Notification !== 'undefined' ? 'notifications' as PermissionName : null
  );

  const [cameraErr,  setCameraErr]  = useState<string | null>(null);
  const [micErr,     setMicErr]     = useState<string | null>(null);
  const [notifErr,   setNotifErr]   = useState<string | null>(null);

  const requestCamera = useCallback(async () => {
    setCameraErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      setCameraErr('Браузер заблокировал доступ. Разрешите вручную в настройках браузера.');
    }
  }, []);

  const requestMic = useCallback(async () => {
    setMicErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      setMicErr('Браузер заблокировал доступ. Разрешите вручную в настройках браузера.');
    }
  }, []);

  const requestNotif = useCallback(async () => {
    setNotifErr(null);
    try {
      const result = await Notification.requestPermission();
      if (result === 'denied') {
        setNotifErr('Браузер заблокировал уведомления. Разрешите вручную в настройках браузера.');
      }
    } catch {
      setNotifErr('Не удалось запросить разрешение.');
    }
  }, []);

  const items: Array<{
    label: string;
    description: string;
    state: PermState;
    err: string | null;
    onRequest: (() => void) | null;
    icon: JSX.Element;
  }> = [
    {
      label: 'Камера',
      description: 'Требуется для съёмки фото и видео через встроенную камеру.',
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
      label: 'Микрофон',
      description: 'Требуется для записи голосовых сообщений и видео со звуком.',
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
      label: 'Уведомления',
      description: 'Позволяет получать push-уведомления о новых сообщениях.',
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
        Управляйте разрешениями, которые сайт использует для работы функций.
        Если разрешение заблокировано браузером, измените его вручную в настройках браузера (иконка замка в адресной строке).
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
                  Заблокировано браузером. Нажмите на иконку замка в адресной строке, чтобы изменить.
                </div>
              )}
            </div>
            {item.onRequest && item.state !== 'granted' && item.state !== 'unsupported' && (
              <button className="permRequestBtn" onClick={item.onRequest}>
                Разрешить
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
