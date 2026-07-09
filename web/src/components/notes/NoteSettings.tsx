/**
 * notes/NoteSettings.tsx — per-note permission settings (author only):
 * who can edit and who can see the note.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SharedNote, Chat, User } from '../../types';
import { updateNoteSettings } from '../../api/notes';

interface SettingsProps {
  note: SharedNote;
  chat: Chat;
  meId: string;
  onBack: () => void;
  onSaved: (updated: SharedNote) => void;
}

export function NoteSettings({ note, chat, meId, onBack, onSaved }: SettingsProps) {
  const { t } = useTranslation('notes');
  const [editMode, setEditMode]         = useState<'all' | 'restricted'>(note.edit_mode ?? 'all');
  const [editExc, setEditExc]           = useState<string[]>(note.edit_exceptions ?? []);
  const [visibility, setVisibility]     = useState<'public' | 'private'>(note.visibility ?? 'public');
  const [visExc, setVisExc]             = useState<string[]>(note.visibility_exceptions ?? []);
  const [saving, setSaving]             = useState(false);

  const members = chat.members.filter(m => m.id !== meId);

  function toggleEditExc(id: string) {
    setEditExc(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleVisExc(id: string) {
    setVisExc(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await updateNoteSettings(chat.id, note.id, {
        edit_mode: editMode,
        edit_exceptions: editExc,
        visibility,
        visibility_exceptions: visExc,
      });
      onSaved(updated);
      onBack();
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <div className="notesSettings">
      <div className="notesSettingsHeader">
        <button className="notesBackBtn" onClick={onBack} title={t('common:back')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="notesSettingsTitle">{t('settings.title')}</div>
      </div>

      <div className="notesSettingsBody">

        {/* ── Edit permissions ── */}
        <div className="nsSection">
          <div className="nsSectionLabel">{t('settings.editSectionLabel')}</div>
          <div className="nsSegment">
            <button className={`nsSegBtn${editMode === 'all' ? ' nsActive' : ''}`} onClick={() => setEditMode('all')}>
              {t('settings.editAll')}
            </button>
            <button className={`nsSegBtn${editMode === 'restricted' ? ' nsActive' : ''}`} onClick={() => setEditMode('restricted')}>
              {t('settings.editRestricted')}
            </button>
          </div>
          {editMode === 'restricted' && (
            <>
              <div className="nsSectionDesc">{t('settings.editRestrictedDesc')}</div>
              <div className="nsMembers">
                <div className="nsMember">
                  <MemberAvatar user={null} name={t('settings.youAuthor')} />
                  <span className="nsMemberName">{t('settings.youAuthor')}</span>
                  <span className="nsFixedLabel">{t('settings.always')}</span>
                </div>
                {members.map(m => (
                  <button key={m.id} className="nsMember" onClick={() => toggleEditExc(m.id)}>
                    <MemberAvatar user={m} name={m.display_name || m.username || '?'} />
                    <span className="nsMemberName">{m.display_name || m.username || t('settings.member')}</span>
                    <div className={`nsMemberCheck${editExc.includes(m.id) ? ' nsChecked' : ''}`}>
                      {editExc.includes(m.id) && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Visibility ── */}
        <div className="nsSection">
          <div className="nsSectionLabel">{t('settings.visSectionLabel')}</div>
          <div className="nsSegment">
            <button className={`nsSegBtn${visibility === 'public' ? ' nsActive' : ''}`} onClick={() => setVisibility('public')}>
              {t('settings.visPublic')}
            </button>
            <button className={`nsSegBtn${visibility === 'private' ? ' nsActive' : ''}`} onClick={() => setVisibility('private')}>
              {t('settings.visPrivate')}
            </button>
          </div>
          {visibility === 'private' && (
            <>
              <div className="nsSectionDesc">{t('settings.visPrivateDesc')}</div>
              <div className="nsMembers">
                <div className="nsMember">
                  <MemberAvatar user={null} name={t('settings.youAuthor')} />
                  <span className="nsMemberName">{t('settings.youAuthor')}</span>
                  <span className="nsFixedLabel">{t('settings.always')}</span>
                </div>
                {members.map(m => (
                  <button key={m.id} className="nsMember" onClick={() => toggleVisExc(m.id)}>
                    <MemberAvatar user={m} name={m.display_name || m.username || '?'} />
                    <span className="nsMemberName">{m.display_name || m.username || t('settings.member')}</span>
                    <div className={`nsMemberCheck${visExc.includes(m.id) ? ' nsChecked' : ''}`}>
                      {visExc.includes(m.id) && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button className="notesSettingsSave" onClick={save} disabled={saving}>
          {saving ? t('saving') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}

function MemberAvatar({ user, name }: { user: User | null; name: string }) {
  if (user?.avatar_url) {
    return <img src={user.avatar_url} className="nsMemberAvatar" alt={name} />;
  }
  const initial = (name[0] || '?').toUpperCase();
  return <div className="nsMemberAvatar">{initial}</div>;
}
