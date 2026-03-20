/**
 * PrivacyTab
 *
 * "Конфиденциальность" tab inside ProfileSettingsModal.
 * Currently: toggle to block group additions.
 */

import { useState } from 'react';
import { type User } from '../../types';
import { Toggle } from '../ui/Toggle';
import { updateMe } from '../../api/users';

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

export function PrivacyTab({ me, onUpdate }: Props) {
  const [noGroupAdd, setNoGroupAdd] = useState(me.no_group_add ?? false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function onSave() {
    setBusy(true); setOk(false);
    try {
      const next = await updateMe({ no_group_add: noGroupAdd });
      onUpdate(next);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  return (
    <div className="psBody">
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">Группы</div>
        <div className="psPrivacyDesc">Управляйте тем, кто может добавлять вас в групповые чаты.</div>

        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">Запретить добавление в группы</div>
            <div className="psPrivacyRowSub">Никто не сможет добавить вас в групповой чат без вашего согласия</div>
          </div>
          <Toggle value={noGroupAdd} onChange={setNoGroupAdd} />
        </label>
      </div>

      {ok && <div className="psOk">✓ Настройки сохранены</div>}
      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : 'Сохранить'}
      </button>
    </div>
  );
}
