const API_BASE = '/admin/api';
const AUTH_API = '/admin/api/login';

let token = localStorage.getItem('admin_token');
let adminUsername = localStorage.getItem('admin_username') || '';

// ─── Cached data for sorting/filtering ────────────────────────────────────
let usersData = [];
let chatsData = [];
let packsData = [];

let usersSort = { col: null, dir: 'asc' };
let chatsSort = { col: null, dir: 'asc' };

// Setup UI based on auth state
if (token) {
  document.getElementById('login-screen').classList.add('d-none');
  document.getElementById('app').classList.remove('d-none');
  loadStats();
  loadReportsBadge();
  loadErrorsBadge();
}

// ─── Authentication ────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginBtn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Вход...';
  errorEl.style.display = 'none';

  try {
    const res = await fetch(AUTH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка входа');

    token = data.token;
    adminUsername = username.toLowerCase();
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_username', adminUsername);
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app').classList.remove('d-none');
    loadStats();
    loadReportsBadge();
    loadErrorsBadge();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Войти';
  }
});

function logout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_username');
  location.reload();
}

// ─── API Helpers ───────────────────────────────────────────────────────────
async function fetchApi(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (res.status === 401 || res.status === 403) { logout(); throw new Error('Session expired'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return res.json();
}

// ─── Navigation ────────────────────────────────────────────────────────────
function showTab(tabName) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('d-none'));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.remove('d-none');
  document.getElementById(`nav-${tabName}`).classList.add('active');

  if (tabName === 'dashboard') loadStats();
  if (tabName === 'users') loadUsers();
  if (tabName === 'chats') loadChats();
  if (tabName === 'content') loadContent();
  if (tabName === 'errors') loadErrors();
}

// ─── Date filter helpers ───────────────────────────────────────────────────
function getDateParams() {
  const fromVal = document.getElementById('filter-from').value;
  const toVal   = document.getElementById('filter-to').value;
  const params  = new URLSearchParams();

  if (fromVal) params.set('from', new Date(fromVal + 'T00:00:00').getTime());
  if (toVal)   params.set('to',   new Date(toVal   + 'T23:59:59').getTime());

  const label = document.getElementById('filter-label');
  if (fromVal || toVal) {
    label.textContent = fromVal && toVal
      ? `Период: ${fromVal} — ${toVal}`
      : fromVal ? `С ${fromVal}` : `По ${toVal}`;
  } else {
    label.textContent = 'Все время';
  }

  return params.toString() ? `?${params}` : '';
}

function clearDateFilter() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  loadStats();
}

// ─── Stats ─────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const qs = getDateParams();
    const data = await fetchApi(`/stats${qs}`);
    document.getElementById('stat-users').textContent    = data.users;
    document.getElementById('stat-chats').textContent    = data.chats;
    document.getElementById('stat-messages').textContent = data.messages;
    document.getElementById('stat-bugs').textContent     = data.support_bugs;
    document.getElementById('stat-features').textContent = data.support_features;
    document.getElementById('stat-content-reports').textContent = data.content_reports ?? '-';
  } catch (err) {
    console.error('Failed to load stats', err);
  }
}

// ─── Users ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  try {
    usersData = await fetchApi('/users');
    usersSort = { col: null, dir: 'asc' };
    updateSortIcons('users', null, null);
    renderUsers(usersData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

function filterUsers(query) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? usersData.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q)
      )
    : usersData;
  renderUsers(applySortUsers(filtered));
}

function sortUsers(col) {
  if (usersSort.col === col) {
    usersSort.dir = usersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    usersSort = { col, dir: 'asc' };
  }
  updateSortIcons('users', col, usersSort.dir);
  const q = document.getElementById('users-search').value;
  filterUsers(q);
}

function applySortUsers(arr) {
  if (!usersSort.col) return arr;
  const { col, dir } = usersSort;
  return [...arr].sort((a, b) => {
    const av = a[col] ?? '';
    const bv = b[col] ?? '';
    const cmp = typeof av === 'number'
      ? av - bv
      : String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), 'ru');
    return dir === 'asc' ? cmp : -cmp;
  });
}

function renderUsers(list) {
  const tbody = document.getElementById('users-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Нет результатов</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  list.forEach(u => {
    const isMe = adminUsername && u.username.toLowerCase() === adminUsername;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="fw-bold">${u.display_name || 'Без имени'}</div>
        <div class="small text-secondary font-monospace" title="${u.id}">${u.id.split('-')[0]}...</div>
      </td>
      <td class="text-primary">@${u.username}</td>
      <td class="text-secondary small">${u.email || '—'}</td>
      <td>${new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
      <td>${u.last_seen_at ? new Date(u.last_seen_at).toLocaleString('ru-RU') : 'Никогда'}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${u.id}', '${u.username}')" ${isMe ? 'disabled' : ''}>
          <i class="bi bi-trash3"></i> Удалить
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Chats ─────────────────────────────────────────────────────────────────
async function loadChats() {
  const tbody = document.getElementById('chats-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  try {
    chatsData = await fetchApi('/chats');
    chatsSort = { col: null, dir: 'asc' };
    updateSortIcons('chats', null, null);
    renderChats(chatsData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

function sortChats(col) {
  if (chatsSort.col === col) {
    chatsSort.dir = chatsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    chatsSort = { col, dir: 'asc' };
  }
  updateSortIcons('chats', col, chatsSort.dir);
  const sorted = [...chatsData].sort((a, b) => {
    const av = a[col] ?? '';
    const bv = b[col] ?? '';
    const cmp = typeof av === 'number'
      ? av - bv
      : String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), 'ru');
    return chatsSort.dir === 'asc' ? cmp : -cmp;
  });
  renderChats(sorted);
}

function renderChats(list) {
  const tbody = document.getElementById('chats-tbody');
  tbody.innerHTML = '';
  list.forEach(c => {
    const isGroup = c.type === 'group';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="fw-bold">${c.name || (isGroup ? 'Группа' : 'Личный чат')}</div>
        <div class="small text-secondary font-monospace" title="${c.id}">${c.id.split('-')[0]}...</div>
      </td>
      <td><span class="badge ${isGroup ? 'bg-primary' : 'bg-secondary'}">${isGroup ? 'Группа' : 'Личный'}</span></td>
      <td>${c.member_count}</td>
      <td class="small text-secondary">${new Date(c.created_at).toLocaleDateString('ru-RU')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" onclick="deleteChat('${c.id}')">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Sort icons ────────────────────────────────────────────────────────────
function updateSortIcons(table, activeCol, dir) {
  const cols = table === 'users'
    ? ['display_name', 'username', 'email', 'created_at', 'last_seen_at']
    : ['name', 'type', 'member_count', 'created_at'];

  cols.forEach(col => {
    const el = document.getElementById(`sort-${table}-${col}`);
    if (!el) return;
    if (col === activeCol) {
      el.textContent = dir === 'asc' ? '↑' : '↓';
      el.classList.add('active');
    } else {
      el.textContent = '↕';
      el.classList.remove('active');
    }
  });
}

// ─── Actions ───────────────────────────────────────────────────────────────
async function deleteUser(id, username) {
  if (!confirm(`Точно удалить пользователя @${username} и все его сообщения и чаты? Это действие необратимо.`)) return;
  try {
    await fetchApi(`/users/${id}`, { method: 'DELETE' });
    loadUsers();
    loadStats();
  } catch (err) {
    alert('Ошибка при удалении: ' + err.message);
  }
}

async function deleteChat(id) {
  if (!confirm('Точно удалить этот чат и все его сообщения? Это действие необратимо.')) return;
  try {
    await fetchApi(`/chats/${id}`, { method: 'DELETE' });
    loadChats();
    loadStats();
  } catch (err) {
    alert('Ошибка при удалении: ' + err.message);
  }
}

// ─── Content Moderation ────────────────────────────────────────────────────
let currentContentSubtab = 'reports';

function loadContent() {
  if (currentContentSubtab === 'reports') loadReports();
  else loadPacks();
}

function showContentSubtab(name) {
  currentContentSubtab = name;
  document.getElementById('subtab-reports').classList.toggle('d-none', name !== 'reports');
  document.getElementById('subtab-packs').classList.toggle('d-none', name !== 'packs');
  document.getElementById('subtab-reports-btn').classList.toggle('active', name === 'reports');
  document.getElementById('subtab-packs-btn').classList.toggle('active', name === 'packs');

  if (name === 'reports') loadReports();
  else loadPacks();
}

// ─── Reports badge (sidebar) ───────────────────────────────────────────────
async function loadReportsBadge() {
  try {
    const reports = await fetchApi('/content-reports?resolved=0');
    const badge = document.getElementById('nav-content-badge');
    const countBadge = document.getElementById('reports-count-badge');
    if (reports.length > 0) {
      badge.textContent = reports.length;
      badge.style.display = 'inline';
      if (countBadge) { countBadge.textContent = reports.length; countBadge.style.display = 'inline'; }
    } else {
      badge.style.display = 'none';
      if (countBadge) countBadge.style.display = 'none';
    }
  } catch {}
}

// ─── Reports ───────────────────────────────────────────────────────────────
async function loadReports() {
  const tbody = document.getElementById('reports-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  const resolved = document.getElementById('show-resolved-toggle').checked ? 1 : 0;
  try {
    const reports = await fetchApi(`/content-reports?resolved=${resolved}`);
    if (!reports.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-secondary">${resolved ? 'Нет решённых жалоб' : 'Жалоб нет'}</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    reports.forEach(r => {
      const tr = document.createElement('tr');
      const thumbHtml = r.pack_cover
        ? `<span class="pack-thumb me-2"><img src="${escHtml(r.pack_cover)}" alt=""></span>`
        : `<span class="pack-thumb me-2" style="font-size:18px">📦</span>`;
      tr.innerHTML = `
        <td>
          <div class="d-flex align-items-center">
            ${thumbHtml}
            <div>
              <div class="fw-bold">${escHtml(r.pack_name || 'Удалён')}</div>
              <div class="small text-secondary">${r.pack_type === 'emoji' ? 'Эмодзи-пак' : 'Стикерпак'}</div>
            </div>
          </div>
        </td>
        <td class="text-secondary small">${r.owner_username ? '@' + escHtml(r.owner_username) : '—'}</td>
        <td class="text-secondary small">${r.reporter_username ? '@' + escHtml(r.reporter_username) : 'Удалён'}</td>
        <td>
          <span class="text-secondary small" style="white-space:pre-wrap;max-width:280px;display:block;overflow:hidden;text-overflow:ellipsis"
            title="${escHtml(r.reason || '')}">
            ${r.reason ? escHtml(r.reason.slice(0, 120)) + (r.reason.length > 120 ? '…' : '') : '<span class="text-muted fst-italic">Не указана</span>'}
          </span>
        </td>
        <td class="small text-secondary">${new Date(r.created_at).toLocaleString('ru-RU')}</td>
        <td class="text-end">
          <div class="d-flex gap-2 justify-content-end">
            ${!resolved ? `
              <button class="btn btn-sm btn-outline-danger" onclick="adminDeletePack('${escHtml(r.content_id)}', '${escHtml(r.id)}')">
                <i class="bi bi-trash3"></i> Удалить пак
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="dismissReport('${escHtml(r.id)}')">
                <i class="bi bi-x-circle"></i> Отклонить
              </button>
            ` : `<span class="badge bg-success">Решено</span>`}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    loadReportsBadge();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

async function dismissReport(id) {
  if (!confirm('Отклонить жалобу? Пак останется доступным.')) return;
  try {
    await fetchApi(`/content-reports/${id}/dismiss`, { method: 'PATCH' });
    loadReports();
    loadStats();
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

async function adminDeletePack(packId, reportId) {
  if (!confirm('Удалить этот пак? Это действие необратимо, пак будет скрыт для всех пользователей.')) return;
  try {
    await fetchApi(`/sticker-packs/${packId}`, { method: 'DELETE' });
    loadReports();
    loadStats();
  } catch (err) {
    alert('Ошибка при удалении: ' + err.message);
  }
}

// ─── Packs ─────────────────────────────────────────────────────────────────
async function loadPacks() {
  const tbody = document.getElementById('packs-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  try {
    packsData = await fetchApi('/sticker-packs');
    renderPacks(packsData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

function filterPacks(query) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? packsData.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.owner_username || '').toLowerCase().includes(q) ||
        (p.owner_name || '').toLowerCase().includes(q)
      )
    : packsData;
  renderPacks(filtered);
}

function renderPacks(list) {
  const tbody = document.getElementById('packs-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-secondary">Нет паков</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  list.forEach(p => {
    const tr = document.createElement('tr');
    const thumbHtml = p.cover_url
      ? `<span class="pack-thumb me-2"><img src="${escHtml(p.cover_url)}" alt=""></span>`
      : `<span class="pack-thumb me-2" style="font-size:18px">📦</span>`;
    tr.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
          ${thumbHtml}
          <div>
            <div class="fw-bold">${escHtml(p.name)}</div>
            <div class="small text-secondary">${p.is_public ? 'Публичный' : 'Приватный'}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${p.type === 'emoji' ? 'bg-warning text-dark' : 'bg-primary'}">${p.type === 'emoji' ? 'Эмодзи' : 'Стикеры'}</span></td>
      <td class="text-secondary small">${p.owner_username ? '@' + escHtml(p.owner_username) : '—'}</td>
      <td>${p.item_count}</td>
      <td>
        ${p.report_count > 0
          ? `<span class="report-badge">${p.report_count}</span>`
          : '<span class="text-muted">—</span>'}
      </td>
      <td class="small text-secondary">${new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" onclick="adminDeletePackFromList('${escHtml(p.id)}', '${escHtml(p.name)}')">
          <i class="bi bi-trash3"></i> Удалить
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function adminDeletePackFromList(packId, packName) {
  if (!confirm(`Удалить пак «${packName}»? Пак будет скрыт для всех пользователей.`)) return;
  try {
    await fetchApi(`/sticker-packs/${packId}`, { method: 'DELETE' });
    loadPacks();
    loadStats();
  } catch (err) {
    alert('Ошибка при удалении: ' + err.message);
  }
}

// ─── Error Log ─────────────────────────────────────────────────────────────
let errorsOffset = 0;
const ERRORS_PAGE = 100;
let _errorSearchTimer = null;
let _errorsRowCache = {};

function debounceErrorSearch() {
  clearTimeout(_errorSearchTimer);
  _errorSearchTimer = setTimeout(() => loadErrors(), 400);
}

function _errorsQueryParams(offset = 0) {
  const level  = document.getElementById('errors-level').value;
  const tag    = document.getElementById('errors-tag').value;
  const search = document.getElementById('errors-search').value.trim();
  const p = new URLSearchParams();
  if (level)  p.set('level',  level);
  if (tag)    p.set('tag',    tag);
  if (search) p.set('search', search);
  p.set('limit',  ERRORS_PAGE);
  p.set('offset', offset);
  return p.toString();
}

async function loadErrors(reset = true) {
  if (reset) { errorsOffset = 0; _errorsRowCache = {}; }
  const tbody = document.getElementById('errors-tbody');
  if (reset) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Загрузка...</td></tr>';

  try {
    const data = await fetchApi(`/errors?${_errorsQueryParams(errorsOffset)}`);

    if (reset) {
      const tagSel = document.getElementById('errors-tag');
      const curTag = tagSel.value;
      tagSel.innerHTML = '<option value="">Все теги</option>';
      (data.tags || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        if (t === curTag) opt.selected = true;
        tagSel.appendChild(opt);
      });
    }

    document.getElementById('errors-total-label').textContent = `Найдено записей: ${data.total}`;

    if (reset) tbody.innerHTML = '';

    if (!data.rows.length && reset) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Ошибок не найдено</td></tr>';
      document.getElementById('errors-load-more').classList.add('d-none');
      return;
    }

    data.rows.forEach(r => { _errorsRowCache[r.id] = r; });
    renderErrorRows(data.rows, tbody);
    errorsOffset += data.rows.length;

    document.getElementById('errors-load-more').classList.toggle('d-none', errorsOffset >= data.total);

    const level = document.getElementById('errors-level').value;
    document.getElementById('errors-clear-warn-btn').classList.toggle('d-none', level !== 'warn');
    document.getElementById('errors-clear-error-btn').classList.toggle('d-none', level !== 'error');

    loadErrorsBadge();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${escHtml(err.message)}</td></tr>`;
  }
}

async function loadMoreErrors() {
  await loadErrors(false);
}

function renderErrorRows(rows, tbody) {
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const timeStr = new Date(r.ts).toLocaleString('ru-RU', {
      day:'2-digit', month:'2-digit', year:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });

    const levelBadge = r.level === 'error'
      ? `<span class="level-badge-error"><i class="bi bi-x-circle me-1"></i>error</span>`
      : `<span class="level-badge-warn"><i class="bi bi-exclamation-triangle me-1"></i>warn</span>`;

    const tagHtml = r.tag
      ? `<span class="tag-chip">${escHtml(r.tag)}</span>`
      : '<span class="text-muted">—</span>';

    const msgHtml = r.message
      ? `<div class="fw-semibold small">${escHtml(r.message.slice(0, 120))}${r.message.length > 120 ? '…' : ''}</div>`
      : '';
    const errHtml = r.error_text
      ? `<div class="small text-secondary font-monospace mt-1" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${escHtml(r.error_text)}">${escHtml(r.error_text.slice(0, 140))}</div>`
      : '';

    const userHtml = r.user_id
      ? `<span class="small font-monospace text-info" title="${escHtml(r.user_id)}">${escHtml(r.user_id.split('-')[0])}…</span>`
      : '<span class="text-muted small">—</span>';

    tr.innerHTML = `
      <td class="small text-secondary" style="white-space:nowrap">${timeStr}</td>
      <td>${levelBadge}</td>
      <td>${tagHtml}</td>
      <td>${msgHtml}${errHtml}</td>
      <td>${userHtml}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary"
          onclick="event.stopPropagation();showErrorDetail(${r.id})" title="Подробнее">
          <i class="bi bi-search"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger ms-1"
          onclick="event.stopPropagation();deleteError(${r.id})" title="Удалить">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    `;
    tr.onclick = () => showErrorDetail(r.id);
    tbody.appendChild(tr);
  });
}

function showErrorDetail(id) {
  const r = _errorsRowCache[id];
  if (!r) { alert('Запись не найдена в кэше. Обновите список.'); return; }

  const dt = new Date(r.ts).toLocaleString('ru-RU');
  const levelBadge = r.level === 'error'
    ? `<span class="level-badge-error">error</span>`
    : `<span class="level-badge-warn">warn</span>`;

  let metaParsed = null;
  if (r.meta) { try { metaParsed = JSON.parse(r.meta); } catch {} }

  document.getElementById('errorDetailBody').innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      ${levelBadge}
      ${r.tag ? `<span class="tag-chip">${escHtml(r.tag)}</span>` : ''}
      <span class="text-secondary small ms-auto">${dt}</span>
    </div>
    ${r.message ? `<div class="mb-3"><div class="text-secondary small mb-1">Сообщение</div><div class="fw-semibold">${escHtml(r.message)}</div></div>` : ''}
    ${r.error_text ? `<div class="mb-3"><div class="text-secondary small mb-1">Текст ошибки</div><pre class="err-detail-pre">${escHtml(r.error_text)}</pre></div>` : ''}
    ${r.user_id ? `<div class="mb-3"><div class="text-secondary small mb-1">User ID</div><div class="font-monospace small text-info">${escHtml(r.user_id)}</div></div>` : ''}
    ${metaParsed ? `<div class="mb-3"><div class="text-secondary small mb-1">Контекст (meta)</div><pre class="err-detail-pre">${escHtml(JSON.stringify(metaParsed, null, 2))}</pre></div>` : ''}
    ${r.stack ? `<div class="mb-3"><div class="text-secondary small mb-1">Stack trace</div><pre class="err-detail-pre text-warning">${escHtml(r.stack)}</pre></div>` : ''}
  `;

  document.getElementById('errorDetailDeleteBtn').onclick = async () => {
    await deleteError(r.id);
    bootstrap.Modal.getInstance(document.getElementById('errorDetailModal')).hide();
  };

  new bootstrap.Modal(document.getElementById('errorDetailModal')).show();
}

async function deleteError(id) {
  try {
    await fetchApi(`/errors/${id}`, { method: 'DELETE' });
    loadErrors();
  } catch (err) {
    alert('Ошибка при удалении: ' + err.message);
  }
}

async function clearErrors(level) {
  const label = level === 'error' ? 'все ошибки' : level === 'warn' ? 'все предупреждения' : 'весь лог ошибок';
  if (!confirm(`Удалить ${label}? Действие необратимо.`)) return;
  try {
    const qs = level ? `?level=${level}` : '';
    await fetchApi(`/errors${qs}`, { method: 'DELETE' });
    loadErrors();
    loadErrorsBadge();
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

async function loadErrorsBadge() {
  try {
    const data = await fetchApi('/errors?level=error&limit=1');
    const badge = document.getElementById('nav-errors-badge');
    if (data.total > 0) {
      badge.textContent = data.total > 99 ? '99+' : data.total;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
