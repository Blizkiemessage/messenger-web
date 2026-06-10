/**
 * AppearanceTab — «Внешний вид».
 * Accent colour is saved per-user (keyed by userId in localStorage).
 * Changes are previewed live but only persisted on "Сохранить".
 */
import { useState, useCallback } from 'react';
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccentCss, applyAccent, loadUserAccent } from '../../utils/accent';
import {
  APP_BG_PRESETS, DEFAULT_APP_BG, type AppBg,
  applyAppBgCss, applyAppBg, loadUserAppBg, cssForAppBg, isSameAppBg, parseAppBg,
} from '../../utils/appBackground';
import { useSessionStore } from '../../store/useSessionStore';
import { updateMe } from '../../api/users';

export function AppearanceTab() {
  const me = useSessionStore(s => s.me)!;
  const sessionUpdateMe = useSessionStore(s => s.updateMe);
  const [current, setCurrent] = useState<string>(() => me.accent_color || loadUserAccent(me.id));
  const [saved, setSaved] = useState<string>(() => me.accent_color || loadUserAccent(me.id));
  const [justSaved, setJustSaved] = useState(false);
  // Фон приложения: серверное значение приоритетнее локального кэша
  const initialBg = () => parseAppBg(me.app_bg) || loadUserAppBg(me.id);
  const [bgCurrent, setBgCurrent] = useState<AppBg>(initialBg);
  const [bgSaved, setBgSaved] = useState<AppBg>(initialBg);

  const handleSelect = useCallback((hex: string) => {
    setCurrent(hex);
    applyAccentCss(hex);   // live preview only
  }, []);

  const handleCustom = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setCurrent(hex);
    applyAccentCss(hex);   // live preview only
  }, []);

  const handleBgSelect = useCallback((bg: AppBg) => {
    setBgCurrent(bg);
    applyAppBgCss(bg);   // live preview only
  }, []);

  const handleBgCustom = useCallback((patch: Partial<AppBg>) => {
    setBgCurrent(prev => {
      // переход из «аврора» в кастом: подставляем стартовые цвета
      const base: AppBg = prev.type === 'aurora'
        ? { type: 'solid', c1: '#1a1426', c2: '#3d2b52', angle: 160 }
        : prev;
      const next: AppBg = { ...base, ...patch };
      applyAppBgCss(next);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    applyAccent(me.id, current);     // save to localStorage + apply CSS
    applyAppBg(me.id, bgCurrent);    // save app background
    setSaved(current);
    setBgSaved(bgCurrent);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    // Persist to backend so it syncs across devices
    updateMe({
      accent_color: current,
      app_bg: bgCurrent.type === 'aurora' ? null : JSON.stringify(bgCurrent),
    })
      .then(updated => sessionUpdateMe(updated))
      .catch(() => {});
  }, [me.id, current, bgCurrent, sessionUpdateMe]);

  const handleReset = useCallback(() => {
    setCurrent(DEFAULT_ACCENT);
    applyAccentCss(DEFAULT_ACCENT);
    setBgCurrent(DEFAULT_APP_BG);
    applyAppBgCss(DEFAULT_APP_BG);
  }, []);

  const isDefault  = current.toLowerCase() === DEFAULT_ACCENT.toLowerCase()
    && isSameAppBg(bgCurrent, DEFAULT_APP_BG);
  const isUnsaved  = current.toLowerCase() !== saved.toLowerCase()
    || !isSameAppBg(bgCurrent, bgSaved);

  return (
    <div className="psBody">
      <div className="apSection">
        <div className="apSectionTitle">Цветовая схема</div>
        <div className="apSectionSub">
          Выберите акцентный цвет. Нажмите «Сохранить» — цвет привяжется к вашему аккаунту
          и будет применяться при каждом входе.
        </div>
      </div>

      {/* Live preview */}
      <div className="apPreview">
        <div className="apPreviewLabel">Предпросмотр</div>
        <div className="apPreviewRow">
          <button className="apPreviewBtn" style={{ background: current }}>Кнопка</button>
          <div className="apPreviewBadge" style={{ background: `${current}26`, color: current, border: `1px solid ${current}59` }}>
            Метка
          </div>
          <div className="apPreviewInput" style={{ borderColor: current, boxShadow: `0 0 0 3px ${current}20` }}>
            Поле ввода
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="apSection">
        <div className="apSectionTitle">Готовые цвета</div>
        <div className="apPresets">
          {ACCENT_PRESETS.map(p => (
            <button
              key={p.value}
              className={`apPreset${current.toLowerCase() === p.value.toLowerCase() ? ' apPresetActive' : ''}`}
              onClick={() => handleSelect(p.value)}
              title={p.label}
            >
              <span className="apPresetDot" style={{ background: p.value }} />
              <span className="apPresetCheck">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom picker */}
      <div className="apSection">
        <div className="apSectionTitle">Свой цвет</div>
        <label className="apColorPickerLabel">
          <span className="apColorSwatch" style={{ background: current }} />
          <span className="apColorHex">{current.toUpperCase()}</span>
          <span className="apColorArrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
          <input type="color" className="apColorInput" value={current} onChange={handleCustom} />
        </label>
      </div>

      {/* App background */}
      <div className="apSection">
        <div className="apSectionTitle">Фон приложения</div>
        <div className="apSectionSub">
          Сплошной цвет или градиент вместо стандартной «авроры». Скоро можно будет
          задавать свой фон для каждого чата отдельно.
        </div>
        <div className="apBgPresets">
          {APP_BG_PRESETS.map(p => {
            const css = cssForAppBg(p.bg);
            const active = isSameAppBg(bgCurrent, p.bg);
            return (
              <button
                key={p.label}
                className={`apBgPreset${active ? ' apBgPresetActive' : ''}`}
                onClick={() => handleBgSelect(p.bg)}
                title={p.label}
              >
                <span
                  className={`apBgPresetFill${p.bg.type === 'aurora' ? ' apBgPresetAurora' : ''}`}
                  style={css ? { background: css } : undefined}
                />
                <span className="apBgPresetName">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Custom background */}
        <div className="apBgCustomRow">
          <div className="apBgModeTabs">
            <button
              className={`apBgModeTab${bgCurrent.type === 'solid' ? ' active' : ''}`}
              onClick={() => handleBgCustom({ type: 'solid' })}
            >Цвет</button>
            <button
              className={`apBgModeTab${bgCurrent.type === 'gradient' ? ' active' : ''}`}
              onClick={() => handleBgCustom({ type: 'gradient' })}
            >Градиент</button>
          </div>
          {bgCurrent.type !== 'aurora' && (
            <div className="apBgPickers">
              <label className="apColorPickerLabel apBgPickerLabel">
                <span className="apColorSwatch" style={{ background: bgCurrent.c1 }} />
                <span className="apColorHex">{(bgCurrent.c1 || '').toUpperCase()}</span>
                <input
                  type="color" className="apColorInput"
                  value={bgCurrent.c1 || '#1a1426'}
                  onChange={e => handleBgCustom({ c1: e.target.value })}
                />
              </label>
              {bgCurrent.type === 'gradient' && (
                <>
                  <label className="apColorPickerLabel apBgPickerLabel">
                    <span className="apColorSwatch" style={{ background: bgCurrent.c2 }} />
                    <span className="apColorHex">{(bgCurrent.c2 || '').toUpperCase()}</span>
                    <input
                      type="color" className="apColorInput"
                      value={bgCurrent.c2 || '#3d2b52'}
                      onChange={e => handleBgCustom({ c2: e.target.value })}
                    />
                  </label>
                  <label className="apBgAngleRow" title="Угол градиента">
                    <input
                      type="range" min={0} max={360} step={5}
                      value={bgCurrent.angle ?? 160}
                      onChange={e => handleBgCustom({ angle: Number(e.target.value) })}
                      className="apBgAngleSlider"
                    />
                    <span className="apBgAngleValue">{bgCurrent.angle ?? 160}°</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions row */}
      <div className="apActionsRow">
        {!isDefault && (
          <button className="apResetBtn" onClick={handleReset}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Сбросить
          </button>
        )}
        <button
          className={`apSaveBtn${justSaved ? ' apSaveBtnOk' : ''}`}
          onClick={handleSave}
          disabled={!isUnsaved && !justSaved}
        >
          {justSaved
            ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> Сохранено</>
            : 'Сохранить'
          }
        </button>
      </div>
    </div>
  );
}
