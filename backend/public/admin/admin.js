const API_BASE = '/admin/api';
const AUTH_API = '/admin/api/login';

let token = localStorage.getItem('admin_token');

// Setup UI based on auth state
if (token) {
  document.getElementById('login-screen').classList.add('d-none');
  document.getElementById('app').classList.remove('d-none');
  loadStats();
}

// ─── Authentication ────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginBtn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');
  
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  
  if (username.toLowerCase() !== 'pashaaa') {
    errorEl.textContent = 'Доступ разрешен только для pashaaa';
    errorEl.style.display = 'block';
    return;
  }

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
    localStorage.setItem('admin_token', token);
    
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app').classList.remove('d-none');
    loadStats();
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
  
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error('Session expired or unauthorized');
  }
  
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
  
  if (tabName === 'stats') loadStats();
  if (tabName === 'users') loadUsers();
  if (tabName === 'chats') loadChats();
}

// ─── Loaders ───────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await fetchApi('/stats');
    document.getElementById('stat-users').textContent = data.users;
    document.getElementById('stat-chats').textContent = data.chats;
    document.getElementById('stat-messages').textContent = data.messages;
  } catch (err) {
    console.error('Failed to load stats', err);
  }
}

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  
  try {
    const users = await fetchApi('/users');
    tbody.innerHTML = '';
    
    users.forEach(u => {
      const isMe = u.username.toLowerCase() === 'pashaaa';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-bold">${u.display_name || 'Без имени'}</div>
          <div class="small text-secondary font-monospace" title="${u.id}">${u.id.split('-')[0]}...</div>
        </td>
        <td class="text-primary">@${u.username}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : 'Никогда'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${u.id}', '${u.username}')" ${isMe ? 'disabled' : ''}>
            <i class="bi bi-trash3"></i> Удалить
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
}

async function loadChats() {
  const tbody = document.getElementById('chats-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-secondary">Загрузка...</td></tr>';
  
  try {
    const chats = await fetchApi('/chats');
    tbody.innerHTML = '';
    
    chats.forEach(c => {
      const isGroup = c.type === 'group';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-bold">${c.name || (isGroup ? 'Группа' : 'Личный чат')}</div>
          <div class="small text-secondary font-monospace" title="${c.id}">${c.id.split('-')[0]}...</div>
        </td>
        <td>
          <span class="badge ${isGroup ? 'bg-primary' : 'bg-secondary'}">${Math.round(isGroup) ? 'Группа' : 'Личный'}</span>
        </td>
        <td>${c.member_count}</td>
        <td><div class="small font-monospace text-secondary" title="${c.creator_id}">${c.creator_id ? c.creator_id.split('-')[0]+'...' : '—'}</div></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" onclick="deleteChat('${c.id}')">
            <i class="bi bi-trash3"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">${err.message}</td></tr>`;
  }
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
