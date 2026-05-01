'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG & STATE
// ═══════════════════════════════════════════════════════════════════════════

const API = '/admin/api';
let _token = localStorage.getItem('admin_token') || '';
let _adminUser = localStorage.getItem('admin_username') || '';

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function timeAgo(ms) {
  if (!ms) return 'Никогда';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return 'только что';
  if (s < 3600) return Math.floor(s / 60) + ' мин назад';
  if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' дн назад';
  return fmtDate(ms);
}

function avatarColor(name) {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#22c55e','#ef4444'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function avatarHtml(name, size = 34) {
  const letter = (name || '?')[0].toUpperCase();
  const color  = avatarColor(name || '');
  return `<div class="user-avatar" style="width:${size}px;height:${size}px;background:${color}">${esc(letter)}</div>`;
}

function deviceIcon(ua) {
  if (!ua) return '<i class="bi bi-question-circle"></i>';
  const u = ua.toLowerCase();
  if (u.includes('mobile') || u.includes('android') || u.includes('iphone')) return '<i class="bi bi-phone"></i>';
  if (u.includes('tablet') || u.includes('ipad'))  return '<i class="bi bi-tablet"></i>';
  return '<i class="bi bi-laptop"></i>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const Toast = (() => {
  const ICONS = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };

  function show(type, title, msg, ttl = 4000) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `
      <i class="bi ${ICONS[type] || ICONS.info} toast-icon"></i>
      <div class="toast-body">
        <div class="toast-title">${esc(title)}</div>
        ${msg ? `<div class="toast-msg">${esc(msg)}</div>` : ''}
      </div>
      <button class="toast-close" onclick="this.closest('.toast').remove()"><i class="bi bi-x"></i></button>
    `;
    container.appendChild(t);
    if (ttl > 0) setTimeout(() => remove(t), ttl);
    return t;
  }

  function remove(t) {
    if (!t || !t.parentNode) return;
    t.classList.add('removing');
    setTimeout(() => t.remove(), 250);
  }

  return {
    success: (title, msg, ttl)  => show('success', title, msg, ttl),
    error:   (title, msg, ttl)  => show('error',   title, msg, ttl ?? 0),
    warning: (title, msg, ttl)  => show('warning', title, msg, ttl),
    info:    (title, msg, ttl)  => show('info',    title, msg, ttl),
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════════════════

const Confirm = (() => {
  let _resolve = null;

  function setup() {
    document.getElementById('confirm-cancel').onclick = () => close(false);
    document.getElementById('confirm-ok').onclick     = () => close(true);
    document.getElementById('confirm-modal').onclick  = e => { if (e.target === e.currentTarget) close(false); };
  }

  function close(result) {
    document.getElementById('confirm-modal').classList.remove('open');
    if (_resolve) { _resolve(result); _resolve = null; }
  }

  function ask({ icon = '🗑️', title = 'Подтвердите действие', msg = '', okLabel = 'Удалить', okClass = 'btn-danger' } = {}) {
    document.getElementById('confirm-icon').textContent = icon;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent   = msg;
    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = okLabel;
    okBtn.className   = `btn ${okClass}`;
    document.getElementById('confirm-modal').classList.add('open');
    return new Promise(r => { _resolve = r; });
  }

  return { setup, ask };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  API CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const Api = (() => {
  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Authorization': `Bearer ${_token}`, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(`${API}${path}`, opts);

    if (res.status === 401 || res.status === 403) { App.logout(); throw new Error('Сессия истекла'); }

    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    get:    (path)        => req('GET',    path),
    post:   (path, body)  => req('POST',   path, body),
    patch:  (path, body)  => req('PATCH',  path, body),
    delete: (path)        => req('DELETE', path),
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  PAGINATION HELPER
// ═══════════════════════════════════════════════════════════════════════════

function renderPagination(containerId, { total, limit, page, onPage }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const pages = Math.ceil(total / limit);
  if (pages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  if (page > 1)     html += `<button class="page-btn" onclick="(${onPage})(${page - 1})">‹</button>`;
  const start = Math.max(1, page - 2);
  const end   = Math.min(pages, page + 2);
  if (start > 1)    html += `<button class="page-btn" onclick="(${onPage})(1)">1</button>${start > 2 ? '<span class="page-info">…</span>' : ''}`;
  for (let i = start; i <= end; i++)
    html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="(${onPage})(${i})">${i}</button>`;
  if (end < pages)  html += `${end < pages - 1 ? '<span class="page-info">…</span>' : ''}<button class="page-btn" onclick="(${onPage})(${pages})">${pages}</button>`;
  if (page < pages) html += `<button class="page-btn" onclick="(${onPage})(${page + 1})">›</button>`;

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SORT HELPER
// ═══════════════════════════════════════════════════════════════════════════

function makeSorter(prefix) {
  let col = null, dir = 'asc';

  function sort(arr, c) {
    if (col === c) { dir = dir === 'asc' ? 'desc' : 'asc'; }
    else           { col = c; dir = 'asc'; }
    updateIcons();
    return [...arr].sort((a, b) => {
      const av = a[col] ?? '';
      const bv = b[col] ?? '';
      const cmp = typeof av === 'number'
        ? av - bv
        : String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), 'ru');
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  function reset() { col = null; dir = 'asc'; updateIcons(); }

  function updateIcons() {
    document.querySelectorAll(`[id^="sort-${prefix}-"]`).forEach(el => {
      const c2 = el.id.replace(`sort-${prefix}-`, '');
      el.className = 'sort-icon ' + (c2 === col ? dir : 'none') + (c2 === col ? ' active' : '');
    });
  }

  return { sort, reset };
}

// ═══════════════════════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════════════════════

const Modals = {
  _open(id)  { document.getElementById(id).classList.add('open'); },
  _close(id) { document.getElementById(id).classList.remove('open'); },

  // ── User detail ──────────────────────────────────────────────────────────
  user: {
    _userId: null,

    async open(userId, username) {
      Modals._open('user-modal');
      document.getElementById('user-modal-title').textContent = `@${username}`;
      document.getElementById('user-modal-body').innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-2)">Загрузка…</div>';

      document.getElementById('user-modal-delete-btn').onclick = async () => {
        const ok = await Confirm.ask({
          icon: '🗑️', title: 'Удалить пользователя?',
          msg: `Пользователь @${username} и все его данные будут удалены навсегда.`,
          okLabel: 'Удалить аккаунт',
        });
        if (!ok) return;
        try {
          await Api.delete(`/users/${userId}`);
          Modals.user.close();
          Toast.success('Пользователь удалён', `@${username}`);
          Pages.users.load();
          Pages.dashboard.load();
        } catch (e) { Toast.error('Ошибка', e.message); }
      };

      try {
        const [user, sessions] = await Promise.all([
          Api.get(`/users/${userId}`),
          Api.get(`/users/${userId}/sessions`),
        ]);
        Modals.user._render(user, sessions);
      } catch (e) {
        document.getElementById('user-modal-body').innerHTML = `<div style="color:var(--danger);text-align:center;padding:24px">${esc(e.message)}</div>`;
      }
    },

    _render(u, sessions) {
      const privacyFlags = [
        u.hide_bio        && 'Скрыто «О себе»',
        u.hide_birth_date && 'Скрыта дата рождения',
        u.hide_email      && 'Скрыт email',
        u.hide_last_seen  && 'Скрыто «Был в сети»',
        u.hide_avatar     && 'Скрыт аватар',
        u.no_group_add    && 'Нельзя добавлять в группы',
      ].filter(Boolean);

      const sessHtml = sessions.length === 0
        ? '<div style="color:var(--text-2);font-size:13px;padding:12px 0">Нет активных сессий</div>'
        : sessions.map(s => `
            <div class="session-row">
              <span style="font-size:20px;color:var(--text-2)">${deviceIcon(s.user_agent)}</span>
              <div class="session-info">
                <div class="session-ua">${esc(s.user_agent || 'Неизвестный браузер')}</div>
                <div class="session-meta">
                  IP: ${esc(s.ip_address || '—')} · Создана: ${fmtDateTime(s.created_at)} · Последняя активность: ${timeAgo(s.last_used_at)}
                  ${s.revoked ? ' · <span style="color:var(--danger)">Отозвана</span>' : ''}
                </div>
              </div>
              ${!s.revoked ? `<button class="btn btn-ghost btn-sm" onclick="Modals.user._revokeSession('${esc(s.id)}', this)" title="Отозвать сессию"><i class="bi bi-shield-x"></i></button>` : ''}
            </div>`).join('');

      document.getElementById('user-modal-body').innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
          ${avatarHtml(u.username, 52)}
          <div>
            <div style="font-size:18px;font-weight:700">${esc(u.display_name || u.username)}</div>
            <div style="color:var(--text-2);font-size:13px">@${esc(u.username)}</div>
            ${u.bio ? `<div style="font-size:12px;color:var(--text-3);margin-top:4px;max-width:400px">${esc(u.bio)}</div>` : ''}
          </div>
        </div>

        <div class="detail-row"><div class="detail-label">ID</div><div class="detail-value" style="font-family:monospace;font-size:12px">${esc(u.id)}</div></div>
        <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${u.email ? esc(u.email) : '<span style="color:var(--text-3)">Не указан</span>'}</div></div>
        <div class="detail-row"><div class="detail-label">Зарегистрирован</div><div class="detail-value">${fmtDateTime(u.created_at)}</div></div>
        <div class="detail-row"><div class="detail-label">Последний вход</div><div class="detail-value">${timeAgo(u.last_seen_at)}</div></div>
        <div class="detail-row"><div class="detail-label">Дата рождения</div><div class="detail-value">${esc(u.birth_date || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Сообщений</div><div class="detail-value">${u.message_count ?? '—'}</div></div>
        <div class="detail-row"><div class="detail-label">2FA</div><div class="detail-value">${u.totp_enabled ? '<span class="badge badge-success"><i class="bi bi-shield-check"></i> Включена</span>' : '<span class="badge badge-muted">Отключена</span>'}</div></div>
        ${privacyFlags.length ? `<div class="detail-row"><div class="detail-label">Приватность</div><div class="detail-value">${privacyFlags.map(f => `<span class="badge badge-muted" style="margin-right:4px;margin-bottom:4px">${esc(f)}</span>`).join('')}</div></div>` : ''}

        <div style="margin-top:24px;font-size:14px;font-weight:700;margin-bottom:12px">
          Сессии (${sessions.length}) <span style="font-weight:400;font-size:12px;color:var(--text-2)">— активных: ${sessions.filter(s=>!s.revoked).length}</span>
        </div>
        <div id="sessions-list">${sessHtml}</div>
      `;
    },

    async _revokeSession(sessionId, btn) {
      btn.disabled = true;
      try {
        await Api.delete(`/sessions/${sessionId}`);
        btn.closest('.session-row').querySelector('.session-meta').innerHTML += ' · <span style="color:var(--danger)">Отозвана</span>';
        btn.remove();
        Toast.success('Сессия отозвана');
      } catch (e) {
        Toast.error('Ошибка', e.message);
        btn.disabled = false;
      }
    },

    close() { Modals._close('user-modal'); },
  },

  // ── Error detail ─────────────────────────────────────────────────────────
  error: {
    _cache: {},

    open(id) {
      const r = this._cache[id];
      if (!r) { Toast.error('Запись не найдена', 'Обновите список'); return; }

      let metaStr = '';
      if (r.meta) { try { metaStr = JSON.stringify(JSON.parse(r.meta), null, 2); } catch { metaStr = r.meta; } }

      const levelBadge = r.level === 'error'
        ? '<span class="badge badge-danger">error</span>'
        : '<span class="badge badge-warning">warn</span>';

      document.getElementById('error-modal-body').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          ${levelBadge}
          ${r.tag ? `<span class="badge badge-muted" style="font-family:monospace">${esc(r.tag)}</span>` : ''}
          <span style="color:var(--text-2);font-size:12px;margin-left:auto">${fmtDateTime(r.ts)}</span>
        </div>
        ${r.message    ? `<div style="margin-bottom:16px"><div class="form-label" style="margin-bottom:6px">Сообщение</div><div style="font-size:13px">${esc(r.message)}</div></div>` : ''}
        ${r.error_text ? `<div style="margin-bottom:16px"><div class="form-label" style="margin-bottom:6px">Текст ошибки</div><pre class="code-block">${esc(r.error_text)}</pre></div>` : ''}
        ${r.user_id    ? `<div style="margin-bottom:16px"><div class="form-label" style="margin-bottom:6px">User ID</div><div style="font-family:monospace;font-size:12px;color:var(--info)">${esc(r.user_id)}</div></div>` : ''}
        ${metaStr      ? `<div style="margin-bottom:16px"><div class="form-label" style="margin-bottom:6px">Контекст</div><pre class="code-block">${esc(metaStr)}</pre></div>` : ''}
        ${r.stack      ? `<div><div class="form-label" style="margin-bottom:6px">Stack trace</div><pre class="code-block warn-text">${esc(r.stack)}</pre></div>` : ''}
      `;

      document.getElementById('error-modal-delete-btn').onclick = async () => {
        try {
          await Api.delete(`/errors/${r.id}`);
          Modals.error.close();
          Toast.success('Запись удалена');
          Pages.errors.load();
        } catch (e) { Toast.error('Ошибка', e.message); }
      };

      Modals._open('error-modal');
    },

    close() { Modals._close('error-modal'); },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  PAGES
// ═══════════════════════════════════════════════════════════════════════════

const Pages = {

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    async load() {
      const from = document.getElementById('filter-from').value;
      const to   = document.getElementById('filter-to').value;
      const p    = new URLSearchParams();
      if (from) p.set('from', new Date(from + 'T00:00:00').getTime());
      if (to)   p.set('to',   new Date(to   + 'T23:59:59').getTime());
      const qs = p.toString() ? '?' + p : '';

      const label = document.getElementById('filter-label');
      label.textContent = from || to
        ? (from && to ? `${from} — ${to}` : from ? `С ${from}` : `По ${to}`)
        : 'За всё время';

      const ids = ['users','chats','messages','bugs','features','reports','errors'];
      ids.forEach(id => { document.getElementById('stat-' + id).textContent = '…'; });

      try {
        const d = await Api.get('/stats' + qs);
        document.getElementById('stat-users').textContent    = d.users     ?? '—';
        document.getElementById('stat-chats').textContent    = d.chats     ?? '—';
        document.getElementById('stat-messages').textContent = d.messages  ?? '—';
        document.getElementById('stat-bugs').textContent     = d.support_bugs     ?? '—';
        document.getElementById('stat-features').textContent = d.support_features ?? '—';
        document.getElementById('stat-reports').textContent  = d.content_reports  ?? '—';
        document.getElementById('stat-errors').textContent   = d.app_errors ?? '—';
        Pages.dashboard._updateBadges(d);
      } catch (e) { Toast.error('Ошибка загрузки статистики', e.message); }
    },

    _updateBadges(d) {
      const cb = document.getElementById('badge-content');
      if (d.content_reports > 0) { cb.textContent = d.content_reports; cb.style.display = ''; }
      else cb.style.display = 'none';

      const eb = document.getElementById('badge-errors');
      if (d.app_errors > 0) { eb.textContent = d.app_errors > 99 ? '99+' : d.app_errors; eb.style.display = ''; }
      else eb.style.display = 'none';
    },

    clearFilter() {
      document.getElementById('filter-from').value = '';
      document.getElementById('filter-to').value   = '';
      this.load();
    },
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  users: {
    _data: [],
    _filtered: [],
    _sorter: makeSorter('users'),

    async load() {
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Загрузка…</td></tr>';
      this._sorter.reset();
      try {
        this._data = await Api.get('/users');
        this._filtered = [...this._data];
        this._render(this._filtered);
        document.getElementById('users-count').textContent = `(${this._data.length})`;
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="5" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },

    search(q) {
      const lq = q.trim().toLowerCase();
      this._filtered = lq
        ? this._data.filter(u =>
            (u.username     || '').toLowerCase().includes(lq) ||
            (u.email        || '').toLowerCase().includes(lq) ||
            (u.display_name || '').toLowerCase().includes(lq))
        : [...this._data];
      this._render(this._filtered);
    },

    sort(col) {
      this._filtered = this._sorter.sort(this._filtered, col);
      this._render(this._filtered);
    },

    _render(list) {
      const tbody = document.getElementById('users-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Нет результатов</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      list.forEach(u => {
        const isMe = u.username?.toLowerCase() === _adminUser;
        const tr   = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => Modals.user.open(u.id, u.username);
        tr.innerHTML = `
          <td>
            <div class="user-cell">
              ${avatarHtml(u.username)}
              <div>
                <div class="user-name">${esc(u.display_name || u.username)} ${isMe ? '<span class="badge badge-primary" style="font-size:10px">Вы</span>' : ''}</div>
                <div class="user-sub">@${esc(u.username)}</div>
              </div>
            </div>
          </td>
          <td style="color:var(--text-2);font-size:12px">${u.email ? esc(u.email) : '<span style="color:var(--text-3)">—</span>'}</td>
          <td style="font-size:12px;color:var(--text-2)">${fmtDate(u.created_at)}</td>
          <td style="font-size:12px;color:var(--text-2)">${timeAgo(u.last_seen_at)}</td>
          <td style="text-align:right">
            <button class="btn btn-ghost-danger btn-sm btn-icon"
              onclick="event.stopPropagation();Pages.users.delete('${esc(u.id)}','${esc(u.username)}')"
              ${isMe ? 'disabled title="Нельзя удалить себя"' : 'title="Удалить"'}>
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    },

    async delete(id, username) {
      const ok = await Confirm.ask({
        icon: '🗑️', title: 'Удалить пользователя?',
        msg: `Аккаунт @${username} и все его данные (сообщения, чаты) будут удалены навсегда.`,
        okLabel: 'Удалить аккаунт',
      });
      if (!ok) return;
      try {
        await Api.delete(`/users/${id}`);
        Toast.success('Пользователь удалён', `@${username}`);
        this.load();
        Pages.dashboard.load();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },
  },

  // ── Chats ─────────────────────────────────────────────────────────────────
  chats: {
    _data: [],
    _sorter: makeSorter('chats'),
    _searchTimer: null,

    async load() {
      const tbody = document.getElementById('chats-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Загрузка…</td></tr>';
      this._sorter.reset();
      const q = document.getElementById('chats-search').value.trim();
      try {
        const qs = q ? `?search=${encodeURIComponent(q)}` : '';
        this._data = await Api.get('/chats' + qs);
        this._render(this._data);
        document.getElementById('chats-count').textContent = `(${this._data.length})`;
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="5" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },

    search() {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.load(), 350);
    },

    sort(col) {
      this._data = this._sorter.sort(this._data, col);
      this._render(this._data);
    },

    _render(list) {
      const tbody = document.getElementById('chats-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Нет результатов</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      list.forEach(c => {
        const isGroup = c.type === 'group';
        const name    = c.name || (isGroup ? 'Группа без названия' : 'Личный чат');
        const tr      = document.createElement('tr');
        tr.innerHTML  = `
          <td>
            <div class="user-cell">
              <div class="user-avatar" style="background:${isGroup ? 'var(--accent)' : 'var(--text-3)'}">
                <i class="bi ${isGroup ? 'bi-people-fill' : 'bi-person-fill'}"></i>
              </div>
              <div>
                <div class="user-name">${esc(name)}</div>
                <div class="user-sub" style="font-family:monospace;font-size:10px">${esc(c.id.split('-')[0])}…</div>
              </div>
            </div>
          </td>
          <td><span class="badge ${isGroup ? 'badge-primary' : 'badge-muted'}">${isGroup ? 'Группа' : 'Личный'}</span></td>
          <td style="font-size:13px"><i class="bi bi-people" style="color:var(--text-3)"></i> ${c.member_count}</td>
          <td style="font-size:12px;color:var(--text-2)">${fmtDate(c.created_at)}</td>
          <td style="text-align:right">
            <button class="btn btn-ghost-danger btn-sm btn-icon" onclick="Pages.chats.delete('${esc(c.id)}','${esc(name)}')" title="Удалить">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    },

    async delete(id, name) {
      const ok = await Confirm.ask({
        icon: '💬', title: 'Удалить чат?',
        msg: `Чат «${name}» и все его сообщения будут удалены навсегда.`,
        okLabel: 'Удалить чат',
      });
      if (!ok) return;
      try {
        await Api.delete(`/chats/${id}`);
        Toast.success('Чат удалён', name);
        this.load();
        Pages.dashboard.load();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },
  },

  // ── Content ───────────────────────────────────────────────────────────────
  content: {
    _packsData: [],
    _activeSubtab: 'reports',

    reload() {
      if (this._activeSubtab === 'reports') this.loadReports();
      else this.loadPacks();
    },

    subTab(name) {
      this._activeSubtab = name;
      ['reports', 'packs'].forEach(t => {
        document.getElementById(`stab-${t}`).classList.toggle('active', t === name);
        document.getElementById(`stab-pane-${t}`).classList.toggle('active', t === name);
      });
      this.reload();
    },

    async loadReports() {
      const tbody    = document.getElementById('reports-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Загрузка…</td></tr>';
      const resolved = document.getElementById('show-resolved-toggle').checked ? 1 : 0;
      try {
        const reports = await Api.get(`/content-reports?resolved=${resolved}`);
        const badge   = document.getElementById('reports-cnt-badge');

        if (!resolved) {
          badge.textContent = reports.length;
          badge.style.display = reports.length ? '' : 'none';
        }

        if (!reports.length) {
          tbody.innerHTML = `<tr class="loading-row"><td colspan="6">${resolved ? 'Нет решённых жалоб' : 'Жалоб нет 🎉'}</td></tr>`;
          return;
        }

        tbody.innerHTML = '';
        reports.forEach(r => {
          const thumbHtml = r.pack_cover
            ? `<div class="pack-thumb"><img src="${esc(r.pack_cover)}" alt=""></div>`
            : `<div class="pack-thumb">📦</div>`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>
              <div class="user-cell">
                ${thumbHtml}
                <div>
                  <div class="user-name">${esc(r.pack_name || 'Удалён')}</div>
                  <div class="user-sub">${r.pack_type === 'emoji' ? 'Эмодзи-пак' : 'Стикерпак'}</div>
                </div>
              </div>
            </td>
            <td style="font-size:12px;color:var(--text-2)">${r.owner_username ? '@' + esc(r.owner_username) : '—'}</td>
            <td style="font-size:12px;color:var(--text-2)">${r.reporter_username ? '@' + esc(r.reporter_username) : '<span style="color:var(--text-3)">Удалён</span>'}</td>
            <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason || '')}">
              ${r.reason ? esc(r.reason.slice(0, 80)) + (r.reason.length > 80 ? '…' : '') : '<span style="color:var(--text-3)">Не указана</span>'}
            </td>
            <td style="font-size:12px;color:var(--text-2)">${fmtDate(r.created_at)}</td>
            <td style="text-align:right">
              ${!resolved ? `
                <div style="display:flex;gap:6px;justify-content:flex-end">
                  <button class="btn btn-ghost-danger btn-sm" onclick="Pages.content.deletePack('${esc(r.content_id)}')">
                    <i class="bi bi-trash3"></i> Удалить пак
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick="Pages.content.dismissReport('${esc(r.id)}')">
                    <i class="bi bi-x-circle"></i> Отклонить
                  </button>
                </div>
              ` : '<span class="badge badge-success"><i class="bi bi-check"></i> Решено</span>'}
            </td>
          `;
          tbody.appendChild(tr);
        });

        Pages.dashboard._updateBadges({ content_reports: resolved ? 0 : reports.length, app_errors: 0 });
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="6" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },

    async dismissReport(id) {
      const ok = await Confirm.ask({ icon: '✅', title: 'Отклонить жалобу?', msg: 'Пак останется доступным для пользователей.', okLabel: 'Отклонить', okClass: 'btn-primary' });
      if (!ok) return;
      try {
        await Api.patch(`/content-reports/${id}/dismiss`);
        Toast.success('Жалоба отклонена');
        this.loadReports();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },

    async deletePack(packId) {
      const ok = await Confirm.ask({ icon: '📦', title: 'Удалить стикерпак?', msg: 'Пак будет скрыт для всех пользователей. Действие необратимо.' });
      if (!ok) return;
      try {
        await Api.delete(`/sticker-packs/${packId}`);
        Toast.success('Пак удалён');
        this.loadReports();
        Pages.dashboard.load();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },

    async loadPacks() {
      const tbody = document.getElementById('packs-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Загрузка…</td></tr>';
      try {
        this._packsData = await Api.get('/sticker-packs');
        this.filterPacks('');
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="7" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },

    filterPacks(q) {
      const lq = q.trim().toLowerCase();
      const list = lq
        ? this._packsData.filter(p =>
            (p.name || '').toLowerCase().includes(lq) ||
            (p.owner_username || '').toLowerCase().includes(lq))
        : this._packsData;
      this._renderPacks(list);
    },

    _renderPacks(list) {
      const tbody = document.getElementById('packs-tbody');
      if (!list.length) { tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Паков нет</td></tr>'; return; }
      tbody.innerHTML = '';
      list.forEach(p => {
        const thumbHtml = p.cover_url
          ? `<div class="pack-thumb"><img src="${esc(p.cover_url)}" alt=""></div>`
          : `<div class="pack-thumb">📦</div>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div class="user-cell">
              ${thumbHtml}
              <div>
                <div class="user-name">${esc(p.name)}</div>
                <div class="user-sub">${p.is_public ? '<i class="bi bi-globe"></i> Публичный' : '<i class="bi bi-lock"></i> Приватный'}</div>
              </div>
            </div>
          </td>
          <td><span class="badge ${p.type === 'emoji' ? 'badge-warning' : 'badge-primary'}">${p.type === 'emoji' ? 'Эмодзи' : 'Стикеры'}</span></td>
          <td style="font-size:12px;color:var(--text-2)">${p.owner_username ? '@' + esc(p.owner_username) : '—'}</td>
          <td style="font-size:13px">${p.item_count}</td>
          <td>${p.report_count > 0 ? `<span class="badge badge-danger">${p.report_count}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
          <td style="font-size:12px;color:var(--text-2)">${fmtDate(p.created_at)}</td>
          <td style="text-align:right">
            <button class="btn btn-ghost-danger btn-sm btn-icon" onclick="Pages.content.deletePack('${esc(p.id)}')" title="Удалить">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    },
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  errors: {
    _page: 1,
    _limit: 50,
    _timer: null,

    debounce() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.load(), 400);
    },

    async load(page = 1) {
      this._page = page;
      const tbody  = document.getElementById('errors-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Загрузка…</td></tr>';

      const level  = document.getElementById('errors-level').value;
      const tag    = document.getElementById('errors-tag').value;
      const search = document.getElementById('errors-search').value.trim();
      const offset = (page - 1) * this._limit;

      const p = new URLSearchParams({ limit: this._limit, offset });
      if (level)  p.set('level',  level);
      if (tag)    p.set('tag',    tag);
      if (search) p.set('search', search);

      try {
        const data = await Api.get('/errors?' + p);

        // Update tag dropdown
        const tagSel = document.getElementById('errors-tag');
        const curTag = tagSel.value;
        tagSel.innerHTML = '<option value="">Все теги</option>';
        (data.tags || []).forEach(t => {
          const o = document.createElement('option');
          o.value = t; o.textContent = t;
          if (t === curTag) o.selected = true;
          tagSel.appendChild(o);
        });

        document.getElementById('errors-total').textContent = `Найдено: ${data.total}`;

        Modals.error._cache = {};
        data.rows.forEach(r => { Modals.error._cache[r.id] = r; });

        if (!data.rows.length) {
          tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Ошибок не найдено</td></tr>';
          document.getElementById('errors-pagination').innerHTML = '';
          return;
        }

        tbody.innerHTML = '';
        data.rows.forEach(r => {
          const levelBadge = r.level === 'error'
            ? '<span class="badge badge-danger"><i class="bi bi-x-circle"></i> error</span>'
            : '<span class="badge badge-warning"><i class="bi bi-exclamation-triangle"></i> warn</span>';
          const tr = document.createElement('tr');
          tr.style.cursor = 'pointer';
          tr.onclick = () => Modals.error.open(r.id);
          tr.innerHTML = `
            <td style="font-size:11px;color:var(--text-2);white-space:nowrap">${fmtDateTime(r.ts)}</td>
            <td>${levelBadge}</td>
            <td>${r.tag ? `<span class="badge badge-muted" style="font-family:monospace">${esc(r.tag)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
            <td>
              ${r.message ? `<div style="font-size:12px;font-weight:600;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.message)}</div>` : ''}
              ${r.error_text ? `<div style="font-size:11px;color:var(--text-3);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace">${esc(r.error_text.slice(0,120))}</div>` : ''}
            </td>
            <td style="font-size:11px;font-family:monospace;color:var(--info)">${r.user_id ? esc(r.user_id.split('-')[0]) + '…' : '<span style="color:var(--text-3)">—</span>'}</td>
            <td style="text-align:right">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();Modals.error.open(${r.id})" title="Подробнее"><i class="bi bi-search"></i></button>
              <button class="btn btn-ghost-danger btn-sm btn-icon" onclick="event.stopPropagation();Pages.errors.deleteOne(${r.id})" title="Удалить"><i class="bi bi-trash3"></i></button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        renderPagination('errors-pagination', {
          total: data.total, limit: this._limit, page,
          onPage: `(p => Pages.errors.load(p))`,
        });
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="6" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },

    async deleteOne(id) {
      try {
        await Api.delete(`/errors/${id}`);
        Toast.success('Запись удалена');
        this.load(this._page);
        Pages.dashboard.load();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },

    async clearAll() {
      const level = document.getElementById('errors-level').value;
      const label = level === 'error' ? 'все ошибки' : level === 'warn' ? 'все предупреждения' : 'весь лог ошибок';
      const ok = await Confirm.ask({ icon: '🧹', title: 'Очистить лог?', msg: `Будет удалено: ${label}. Действие необратимо.`, okLabel: 'Очистить' });
      if (!ok) return;
      try {
        await Api.delete('/errors' + (level ? `?level=${level}` : ''));
        Toast.success('Лог очищен');
        this.load();
        Pages.dashboard.load();
      } catch (e) { Toast.error('Ошибка', e.message); }
    },
  },

  // ── Audit ─────────────────────────────────────────────────────────────────
  audit: {
    _page: 1,
    _limit: 50,

    async load(page = 1) {
      this._page = page;
      const tbody  = document.getElementById('audit-tbody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Загрузка…</td></tr>';

      const action = document.getElementById('audit-action').value;
      const offset = (page - 1) * this._limit;
      const p = new URLSearchParams({ limit: this._limit, offset });
      if (action) p.set('action', action);

      try {
        const data = await Api.get('/audit-log?' + p);
        document.getElementById('audit-total').textContent = `Записей: ${data.total}`;

        if (!data.rows.length) {
          tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Записей нет</td></tr>';
          document.getElementById('audit-pagination').innerHTML = '';
          return;
        }

        const ACTION_LABELS = {
          delete_user:            'Удалил пользователя',
          delete_chat:            'Удалил чат',
          delete_sticker_pack:    'Удалил стикерпак',
          dismiss_content_report: 'Отклонил жалобу',
          clear_app_errors:       'Очистил лог ошибок',
          revoke_session:         'Отозвал сессию',
        };

        tbody.innerHTML = '';
        data.rows.forEach(r => {
          let targetStr = '';
          if (r.target_meta) {
            try {
              const m = JSON.parse(r.target_meta);
              if (m.username) targetStr = `@${m.username}`;
              else if (m.name) targetStr = m.name;
              else if (m.level) targetStr = `level: ${m.level}`;
            } catch {}
          }
          if (!targetStr && r.target_id) targetStr = r.target_id.split('-')[0] + '…';

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-size:12px;color:var(--text-2);white-space:nowrap">${fmtDateTime(r.created_at)}</td>
            <td style="font-size:13px">@${esc(r.admin_username || 'admin')}</td>
            <td><span class="action-chip">${esc(ACTION_LABELS[r.action] || r.action)}</span></td>
            <td style="font-size:12px;color:var(--text-2)">${esc(targetStr)}</td>
            <td style="font-size:11px;font-family:monospace;color:var(--text-3)">${esc(r.ip_address || '—')}</td>
          `;
          tbody.appendChild(tr);
        });

        renderPagination('audit-pagination', {
          total: data.total, limit: this._limit, page,
          onPage: `(p => Pages.audit.load(p))`,
        });
      } catch (e) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="5" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
      }
    },
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  tools: {
    async runRepair() {
      const packId  = document.getElementById('repair-pack-id').value.trim() || null;
      const limit   = parseInt(document.getElementById('repair-limit').value) || 50;
      const dryRun  = document.getElementById('repair-dry-run').checked;
      const btn     = document.getElementById('repair-btn');

      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Запуск…';

      const progress = document.getElementById('repair-progress');
      const barFill  = document.getElementById('repair-bar');
      const stats    = document.getElementById('repair-stats');
      const results  = document.getElementById('repair-results');

      progress.style.display = '';
      barFill.style.width = '30%';
      stats.textContent = 'Выполняется анализ стикеров…';
      results.innerHTML = '';

      try {
        const data = await Api.post('/sticker-repair', { pack_id: packId, dry_run: dryRun, limit });
        barFill.style.width = '100%';

        stats.innerHTML = `
          <span style="color:var(--success)"><i class="bi bi-check-circle"></i> Восстановлено: ${data.repaired}</span> &nbsp;·&nbsp;
          <span style="color:var(--text-2)">Пропущено: ${data.skipped}</span> &nbsp;·&nbsp;
          <span style="color:var(--danger)">Ошибок: ${data.errors}</span>
          ${dryRun ? ' &nbsp;<span class="badge badge-warning">Тестовый запуск</span>' : ''}
        `;

        data.results.forEach(r => {
          const cls = r.status === 'repaired' || r.status === 'would_repair' ? 'repaired'
                    : r.status === 'error' ? 'error' : 'ok';
          const div = document.createElement('div');
          div.className = `repair-result ${cls}`;
          div.textContent = `${r.id.split('-')[0]}… — ${r.status}${r.action ? ': ' + r.action : ''}${r.note ? ' (' + r.note + ')' : ''}${r.message ? ': ' + r.message : ''}`;
          results.appendChild(div);
        });

        Toast.success('Завершено', `Восстановлено: ${data.repaired}, ошибок: ${data.errors}`);
      } catch (e) {
        Toast.error('Ошибка запуска', e.message);
        barFill.style.width = '0%';
        stats.textContent = '';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-wrench-adjustable"></i> Запустить восстановление';
      }
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════

const App = {
  _currentPage: 'dashboard',

  init() {
    Confirm.setup();

    // Close modals on overlay click
    ['user-modal', 'error-modal'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
      });
    });

    // Chat search binding
    document.getElementById('chats-search').addEventListener('input', () => Pages.chats.search());

    if (_token) this._showApp();
    else this._showLogin();
  },

  _showLogin() {
    document.getElementById('login-wrap').style.display = '';
    document.getElementById('app').classList.remove('visible');
  },

  _showApp() {
    document.getElementById('login-wrap').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    const initial = document.getElementById('sidebar-avatar');
    if (_adminUser) {
      initial.textContent = _adminUser[0].toUpperCase();
      document.getElementById('sidebar-username').textContent = _adminUser;
    }
    this.nav('dashboard');
    Pages.dashboard.load();
  },

  nav(page) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.getElementById(`nav-${page}`).classList.add('active');
    this._currentPage = page;

    if (page === 'users')   Pages.users.load();
    if (page === 'chats')   Pages.chats.load();
    if (page === 'content') Pages.content.reload();
    if (page === 'errors')  Pages.errors.load();
    if (page === 'audit')   Pages.audit.load();
  },

  async logout() {
    const ok = await Confirm.ask({ icon: '👋', title: 'Выйти из панели?', msg: '', okLabel: 'Выйти', okClass: 'btn-primary' });
    if (!ok) return;
    try { await Api.post('/logout'); } catch {}
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_username');
    _token = '';
    _adminUser = '';
    this._showLogin();
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH FORM
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn      = document.getElementById('login-btn');
  const errorEl  = document.getElementById('login-error');
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;

  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Вход…';
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка входа');

    _token     = data.token;
    _adminUser = username.toLowerCase();
    localStorage.setItem('admin_token',    _token);
    localStorage.setItem('admin_username', _adminUser);
    App._showApp();
  } catch (err) {
    errorEl.textContent    = err.message;
    errorEl.style.display  = '';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Войти';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════

App.init();
