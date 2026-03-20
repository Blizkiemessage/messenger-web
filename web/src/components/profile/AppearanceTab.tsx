/**
 * AppearanceTab — «Внешний вид» tab in ProfileSettingsModal.
 * Lets the user pick a custom accent colour for the whole UI.
 */
import { useState, useCallback } from 'react';
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccent, getStoredAccent, resetAccent } from '../../utils/accent';

export function AppearanceTab() {
  const [current, setCurrent] = useState<string>(getStoredAccent);

  const handleSelect = useCallback((hex: string) => {
    setCurrent(hex);
    applyAccent(hex);
  }, []);

  const handleCustom = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setCurrent(hex);
    applyAccent(hex);
  }, []);

  const handleReset = useCallback(() => {
    resetAccent();
    applyAccent(DEFAULT_ACCENT);
    setCurrent(DEFAULT_ACCENT);
  }, []);

  const isDefault = current.toLowerCase() === DEFAULT_ACCENT.toLowerCase();

  return (
    <div className="psBody">
      <div className="apSection">
        <div className="apSectionTitle">Цветовая схема</div>
        <div className="apSectionSub">
          Выберите акцентный цвет интерфейса. Он применится ко всем кнопкам, ссылкам и выделениям.
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

      {/* Custom colour picker */}
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
          <input
            type="color"
            className="apColorInput"
            value={current}
            onChange={handleCustom}
          />
        </label>
      </div>

      {/* Reset */}
      {!isDefault && (
        <button className="apResetBtn" onClick={handleReset}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          Сбросить к синему (по умолчанию)
        </button>
      )}
    </div>
  );
}
