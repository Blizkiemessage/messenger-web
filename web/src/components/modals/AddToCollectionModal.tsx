/**
 * AddToCollectionModal — выбрать/создать коллекцию и положить туда вложение
 * существующего сообщения. Открывается из контекстного меню сообщения (с файлом).
 * Самодостаточный: грузит список коллекций, добавляет через addItemFromMessage.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  listCollections, createCollection, addItemFromMessage, type Collection,
} from '../../api/collections';

interface Props {
  chatId: string;
  messageId: string;
  onClose: () => void;
  onDone?: () => void;
}

export function AddToCollectionModal({ chatId, messageId, onClose, onDone }: Props) {
  const { t } = useTranslation('modals');
  const [cols, setCols] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let alive = true;
    listCollections(chatId)
      .then(cs => { if (alive) setCols(cs); })
      .catch(() => { if (alive) setError(t('addToCollection.loadError')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [chatId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function addTo(col: Collection) {
    setBusyId(col.id); setError(null);
    try {
      await addItemFromMessage(chatId, col.id, messageId);
      onDone?.();
      onClose();
    } catch {
      setError(t('addToCollection.addError'));
      setBusyId(null);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusyId('__new__'); setError(null);
    try {
      const col = await createCollection(chatId, name);
      await addItemFromMessage(chatId, col.id, messageId);
      onDone?.();
      onClose();
    } catch {
      setError(t('addToCollection.createError'));
      setBusyId(null);
    }
  }

  return createPortal(
    <div className="atcOverlay" onClick={onClose}>
      <div className="atcModal" onClick={e => e.stopPropagation()}>
        <div className="atcHead">
          <span className="atcTitle">{t('addToCollection.title')}</span>
          <button className="atcClose" onClick={onClose} aria-label={t('common:close')}>✕</button>
        </div>

        {error && <div className="colError">{error}</div>}

        <div className="atcList">
          {loading ? (
            <div className="colEmpty">{t('common:loading')}</div>
          ) : cols.length === 0 ? (
            <div className="colEmpty">{t('addToCollection.empty')}</div>
          ) : (
            cols.map(col => (
              <button key={col.id} className="atcItem" disabled={busyId !== null} onClick={() => addTo(col)}>
                <span className="atcItemIcon">🗂️</span>
                <span className="atcItemName">{col.name}</span>
                <span className="atcItemCount">{busyId === col.id ? '…' : `${col.item_count}`}</span>
              </button>
            ))
          )}
        </div>

        {creating ? (
          <form className="colCreateRow" onSubmit={e => { e.preventDefault(); handleCreate(); }}>
            <input autoFocus className="colCreateInput" placeholder={t('addToCollection.newNamePlaceholder')}
              value={newName} maxLength={80} onChange={e => setNewName(e.target.value)} />
            <button type="submit" className="colAddBtn" disabled={busyId !== null}>{t('addToCollection.createAndAdd')}</button>
          </form>
        ) : (
          <button className="colAddBtn atcCreateBtn" onClick={() => setCreating(true)} disabled={busyId !== null}>
            + {t('addToCollection.newCollection')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
