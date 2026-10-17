/* =========================================================
   Ipon — Personal Savings Tracker
   Vanilla JS + Supabase. No build step, no framework.
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIG — fill these in with your own Supabase project
   --------------------------------------------------------- */
const SUPABASE_URL = 'https://gkqlrgbcwunzqowokhwd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KuksVtY6c2k3d-Cr_LuJ0A_B5art2ic';
const LOGO_BUCKET = 'platform-logos';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------------------------------------------------
   2. STATE
   --------------------------------------------------------- */
const state = {
  user: null,
  platforms: [],      // [{ id, name, type, logo_url, balance }]
  transactions: [],   // [{ id, platform_id, type, amount, date, note }]
  goals: [],          // [{ id, name, target_amount, target_date }]
  pendingLogoFile: null,
  pendingLogoRemoved: false,
};

const PLATFORM_COLORS = ['#1E7A5F', '#D98E3F', '#4C7CE0', '#C1483A', '#8A5CD9', '#2FA6A6', '#C77DBD', '#9AA23B'];

/* ---------------------------------------------------------
   3. HELPERS
   --------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function peso(amount) {
  const n = Number(amount) || 0;
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function toast(message, type = '') {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function platformById(id) {
  return state.platforms.find(p => p.id === id);
}

/* ---------------------------------------------------------
   4. AUTH
   --------------------------------------------------------- */
let authMode = 'login'; // 'login' | 'signup'

function showAuthScreen() {
  $('#boot-loader').style.display = 'none';
  $('#app').classList.remove('is-ready');
  $('#auth-screen').style.display = 'flex';
}

function showApp() {
  $('#boot-loader').style.display = 'none';
  $('#auth-screen').style.display = 'none';
  $('#app').classList.add('is-ready');
}

$('#auth-switch-btn').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  const isLogin = authMode === 'login';
  $('#auth-title').textContent = isLogin ? 'Welcome back' : 'Create your account';
  $('#auth-lead').textContent = isLogin ? 'Log in to see how your savings are growing.' : 'Start tracking every peso, everywhere you save it.';
  $('#auth-submit-label').textContent = isLogin ? 'Log in' : 'Sign up';
  $('#auth-switch-text').textContent = isLogin ? 'New to Ipon?' : 'Already have an account?';
  $('#auth-switch-btn').textContent = isLogin ? 'Create an account' : 'Log in';
  hideAuthMsg();
});

function showAuthMsg(msg, type = 'error') {
  const el = $('#auth-msg');
  el.textContent = msg;
  el.className = `auth-msg is-visible ${type}`;
}
function hideAuthMsg() {
  $('#auth-msg').className = 'auth-msg';
}

$('#password-toggle').addEventListener('click', (e) => {
  const button = e.currentTarget;
  const password = $('#auth-password');
  const showPassword = password.type === 'password';
  password.type = showPassword ? 'text' : 'password';
  button.textContent = showPassword ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(showPassword));
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthMsg();
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const btn = $('#auth-submit');
  btn.disabled = true;

  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        showAuthMsg('Account created. Check your email to confirm, then log in.', 'success');
        btn.disabled = false;
        return;
      }
    }
  } catch (err) {
    showAuthMsg(err.message || 'Something went wrong. Please try again.');
    btn.disabled = false;
  }
});

async function handleLogout() {
  await sb.auth.signOut();
}

$('#logout-btn').addEventListener('click', handleLogout);
$('#mobile-logout-btn')?.addEventListener('click', handleLogout);

sb.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    state.user = session.user;
    $('#sidebar-avatar').textContent = initials(session.user.email);
    $('#sidebar-email').textContent = session.user.email;
    showApp();
    loadAllData();
  } else {
    state.user = null;
    showAuthScreen();
  }
});

/* ---------------------------------------------------------
   5. NAVIGATION
   --------------------------------------------------------- */
function setActiveView(name) {
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.nav__item').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.mobile-nav button').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setActiveView(btn.dataset.view));
});
$$('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => setActiveView(btn.dataset.nav));
});

/* ---------------------------------------------------------
   6. MODALS
   --------------------------------------------------------- */
function openModal(id) { $(`#${id}`).classList.add('is-open'); }
function closeModal(id) { $(`#${id}`).classList.remove('is-open'); }

$$('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay.id); });
  $$('[data-close]', overlay).forEach(btn => btn.addEventListener('click', () => closeModal(overlay.id)));
});

let confirmAction = null;
function askConfirm(title, message, onConfirm) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  confirmAction = onConfirm;
  openModal('modal-confirm');
}
$('#confirm-ok').addEventListener('click', async () => {
  const action = confirmAction;
  closeModal('modal-confirm');
  if (action) await action();
});

/* ---------------------------------------------------------
   7. DATA LOADING
   --------------------------------------------------------- */
async function loadAllData() {
  await Promise.all([loadPlatforms(), loadTransactions(), loadGoals()]);
  renderDashboard();
  renderPlatforms();
  renderTransactions();
  renderGoals();
}

async function loadPlatforms() {
  const { data, error } = await sb.from('platform_balances').select('*').order('name');
  if (error) { toast('Could not load platforms', 'error'); console.error(error); return; }
  state.platforms = data.map(p => ({ ...p, id: p.platform_id, balance: Number(p.balance) }));
}

async function loadTransactions() {
  const { data, error } = await sb.from('transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) { toast('Could not load transactions', 'error'); console.error(error); return; }
  state.transactions = data;
}

async function loadGoals() {
  const { data, error } = await sb.from('goals').select('*').order('target_date', { ascending: true, nullsFirst: false });
  if (error) { toast('Could not load goals', 'error'); console.error(error); return; }
  state.goals = data;
}

/* ---------------------------------------------------------
   8. DASHBOARD
   --------------------------------------------------------- */
let growthChart, distChart;

function renderDashboard() {
  const total = state.platforms.reduce((sum, p) => sum + p.balance, 0);
  $('#stat-total').textContent = peso(total);
  $('#stat-total-sub').textContent = state.platforms.length
    ? `Across ${state.platforms.length} platform${state.platforms.length === 1 ? '' : 's'}`
    : 'Add a platform to get started';
  $('#stat-platforms').textContent = state.platforms.length;

  // This month's net savings
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTx = state.transactions.filter(t => t.date.startsWith(ym));
  const monthNet = monthTx.reduce((sum, t) => sum + (t.type === 'deposit' ? Number(t.amount) : -Number(t.amount)), 0);
  $('#stat-month').textContent = peso(monthNet);
  $('#stat-month-sub').textContent = `${monthTx.length} transaction${monthTx.length === 1 ? '' : 's'} this month`;
  $('#stat-month-sub').className = 'stat-card__sub ' + (monthNet > 0 ? 'is-up' : monthNet < 0 ? 'is-down' : '');

  // Goal progress (primary goal = soonest target date, else most recently created)
  const goal = state.goals[0];
  const ring = $('#goal-ring-progress');
  const circumference = 2 * Math.PI * 24;
  if (goal) {
    const pct = Math.min(100, (total / Number(goal.target_amount)) * 100);
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference - (pct / 100) * circumference}`;
    $('#stat-goal-pct').textContent = `${pct.toFixed(0)}%`;
    $('#stat-goal-sub').textContent = goal.name;
  } else {
    ring.style.strokeDashoffset = `${circumference}`;
    $('#stat-goal-pct').textContent = '—';
    $('#stat-goal-sub').textContent = 'No goal set yet';
  }

  renderDistributionChart(total);
  renderGrowthChart();
  renderRecentTransactions();
}

function renderDistributionChart(total) {
  const wrap = $('#dist-chart-wrap');
  const legend = $('#dist-legend');
  legend.innerHTML = '';

  if (!state.platforms.length || total <= 0) {
    wrap.classList.add('is-empty');
    if (distChart) { distChart.destroy(); distChart = null; }
    return;
  }
  wrap.classList.remove('is-empty');

  const sorted = [...state.platforms].sort((a, b) => b.balance - a.balance);
  const labels = sorted.map(p => p.name);
  const values = sorted.map(p => Math.max(p.balance, 0));
  const colors = sorted.map((_, i) => PLATFORM_COLORS[i % PLATFORM_COLORS.length]);

  if (distChart) distChart.destroy();
  distChart = new Chart($('#dist-chart').getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${peso(ctx.raw)}` } } }
    }
  });

  sorted.forEach((p, i) => {
    const pct = total > 0 ? (Math.max(p.balance, 0) / total) * 100 : 0;
    const row = document.createElement('div');
    row.className = 'legend__row';
    row.innerHTML = `<span class="legend__dot" style="background:${colors[i]}"></span>
      <span class="legend__name">${escapeHtml(p.name)}</span>
      <span class="legend__val num">${pct.toFixed(1)}%</span>`;
    legend.appendChild(row);
  });
}

function renderGrowthChart() {
  const wrap = $('#growth-chart-wrap');
  if (!state.transactions.length) {
    wrap.classList.add('is-empty');
    if (growthChart) { growthChart.destroy(); growthChart = null; }
    return;
  }
  wrap.classList.remove('is-empty');

  // Build last 6 month buckets (oldest -> newest)
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-PH', { month: 'short' }) });
  }

  // Running total up to the end of the earliest bucket, using all transactions before it
  const sorted = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const firstBucketStart = months[0].key + '-01';
  let running = sorted
    .filter(t => t.date < firstBucketStart)
    .reduce((sum, t) => sum + (t.type === 'deposit' ? Number(t.amount) : -Number(t.amount)), 0);

  const values = months.map(m => {
    const inMonth = sorted.filter(t => t.date.startsWith(m.key));
    running += inMonth.reduce((sum, t) => sum + (t.type === 'deposit' ? Number(t.amount) : -Number(t.amount)), 0);
    return Math.max(running, 0);
  });

  if (growthChart) growthChart.destroy();
  growthChart = new Chart($('#growth-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        data: values,
        borderColor: '#1E7A5F',
        backgroundColor: 'rgba(30,122,95,0.08)',
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: '#1E7A5F',
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => peso(ctx.raw) } } },
      scales: {
        y: { ticks: { callback: (v) => '₱' + Number(v).toLocaleString('en-PH') }, grid: { color: '#EEF1EC' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderRecentTransactions() {
  const list = $('#recent-tx-list');
  const recent = state.transactions.slice(0, 6);
  if (!recent.length) {
    list.innerHTML = `<div class="empty-state"><p>No transactions yet. Add your first deposit to get started.</p></div>`;
    return;
  }
  list.innerHTML = recent.map(t => txRowHtml(t)).join('');
}

function txRowHtml(t) {
  const p = platformById(t.platform_id);
  const logo = p?.logo_url
    ? `<img src="${p.logo_url}" alt="">`
    : `<span style="font-family:var(--font-display);font-weight:600;color:var(--primary-dark);">${initials(p?.name)}</span>`;
  const sign = t.type === 'deposit' ? '+' : '−';
  return `
    <div class="tx-row">
      <div class="tx-row__icon">${logo}</div>
      <div class="tx-row__body">
        <div class="tx-row__title">${escapeHtml(p?.name || 'Unknown platform')}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
        <div class="tx-row__sub">${formatDate(t.date)}</div>
      </div>
      <div class="tx-row__amt ${t.type} num">${sign}${peso(t.amount)}</div>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/* ---------------------------------------------------------
   9. PLATFORMS
   --------------------------------------------------------- */
function renderPlatforms() {
  const grid = $('#platform-grid');
  const total = state.platforms.reduce((sum, p) => sum + p.balance, 0);

  const cards = state.platforms.map(p => {
    const pct = total > 0 ? (Math.max(p.balance, 0) / total) * 100 : 0;
    const logo = p.logo_url
      ? `<img src="${p.logo_url}" alt="${escapeHtml(p.name)} logo">`
      : initials(p.name);
    return `
      <div class="platform-card" data-id="${p.id}">
        <div class="platform-card__logo">${logo}</div>
        <div class="platform-card__name">${escapeHtml(p.name)}</div>
        <div class="platform-card__type">${escapeHtml(p.type)}</div>
        <div class="platform-card__balance num">${peso(p.balance)}</div>
        <div class="platform-card__pct num">${pct.toFixed(1)}% of total</div>
        <div class="platform-card__bar"><span style="width:${pct}%"></span></div>
        <div class="platform-card__actions">
          <button class="btn btn-ghost btn-sm" data-action="view" data-id="${p.id}">View</button>
          <button class="btn btn-soft btn-sm" data-action="edit" data-id="${p.id}">Edit</button>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = cards + `
    <button class="add-tile" id="add-platform-tile">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      <span>Add a platform</span>
    </button>`;

  $('#add-platform-tile').addEventListener('click', () => openPlatformModal());
  $$('[data-action="view"]', grid).forEach(b => b.addEventListener('click', () => {
    $('#tx-filter-platform').value = b.dataset.id;
    setActiveView('transactions');
    renderTransactions();
  }));
  $$('[data-action="edit"]', grid).forEach(b => b.addEventListener('click', () => openPlatformModal(platformById(b.dataset.id))));
}

$('#add-platform-btn').addEventListener('click', () => openPlatformModal());

function openPlatformModal(platform = null) {
  const form = $('#platform-form');
  form.reset();
  $('#platform-error').textContent = '';
  state.pendingLogoFile = null;
  state.pendingLogoRemoved = false;

  $('#platform-modal-title').textContent = platform ? 'Edit platform' : 'Add platform';
  $('#platform-id').value = platform?.id || '';
  $('#platform-name').value = platform?.name || '';
  $('#platform-type').value = platform?.type || 'E-Wallet';

  const preview = $('#platform-logo-preview');
  preview.dataset.currentUrl = platform?.logo_url || '';
  preview.innerHTML = platform?.logo_url
    ? `<img src="${platform.logo_url}" alt="">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
  $('#platform-logo-remove').style.display = platform?.logo_url ? 'inline-flex' : 'none';

  // Add a "delete platform" option when editing
  let delBtn = $('#platform-delete-btn');
  if (platform) {
    if (!delBtn) {
      delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.id = 'platform-delete-btn';
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = 'Delete';
      $('#platform-form .modal__footer').prepend(delBtn);
    }
    delBtn.onclick = () => {
      closeModal('modal-platform');
      askConfirm('Delete platform?', `This removes "${platform.name}" and all of its transactions. This can't be undone.`, () => deletePlatform(platform.id));
    };
  } else if (delBtn) {
    delBtn.remove();
  }

  openModal('modal-platform');
}

$('#platform-logo-choose').addEventListener('click', () => $('#platform-logo-input').click());
$('#platform-logo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.pendingLogoFile = file;
  state.pendingLogoRemoved = false;
  const preview = $('#platform-logo-preview');
  const reader = new FileReader();
  reader.onload = () => { preview.innerHTML = `<img src="${reader.result}" alt="">`; };
  reader.readAsDataURL(file);
  $('#platform-logo-remove').style.display = 'inline-flex';
});
$('#platform-logo-remove').addEventListener('click', () => {
  state.pendingLogoFile = null;
  state.pendingLogoRemoved = true;
  $('#platform-logo-preview').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
  $('#platform-logo-remove').style.display = 'none';
  $('#platform-logo-input').value = '';
});

async function uploadLogo(file) {
  const ext = file.name.split('.').pop();
  const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(LOGO_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${LOGO_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

$('#platform-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#platform-id').value;
  const name = $('#platform-name').value.trim();
  const type = $('#platform-type').value;
  const errorEl = $('#platform-error');
  const submitBtn = $('#platform-submit');
  const oldUrl = $('#platform-logo-preview').dataset.currentUrl || null;

  if (!name) { errorEl.textContent = 'Please enter a platform name.'; return; }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span>';
  try {
    let logo_url = oldUrl;

    if (state.pendingLogoFile) {
      logo_url = await uploadLogo(state.pendingLogoFile);
      if (oldUrl) await sb.storage.from(LOGO_BUCKET).remove([storagePathFromUrl(oldUrl)]).catch(() => {});
    } else if (state.pendingLogoRemoved) {
      if (oldUrl) await sb.storage.from(LOGO_BUCKET).remove([storagePathFromUrl(oldUrl)]).catch(() => {});
      logo_url = null;
    }

    if (id) {
      const { error } = await sb.from('platforms').update({ name, type, logo_url }).eq('id', id);
      if (error) throw error;
      toast('Platform updated', 'success');
    } else {
      const { error } = await sb.from('platforms').insert({ name, type, logo_url, user_id: state.user.id });
      if (error) throw error;
      toast('Platform added', 'success');
    }
    closeModal('modal-platform');
    await loadAllData();
  } catch (err) {
    errorEl.textContent = err.message || 'Could not save platform.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save platform';
  }
});

async function deletePlatform(id) {
  const { error } = await sb.from('platforms').delete().eq('id', id);
  if (error) { toast('Could not delete platform', 'error'); return; }
  toast('Platform deleted', 'success');
  await loadAllData();
}

/* ---------------------------------------------------------
   10. TRANSACTIONS
   --------------------------------------------------------- */
function populatePlatformSelects() {
  const opts = state.platforms.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  $('#tx-platform').innerHTML = opts || '<option value="">No platforms yet</option>';
  $('#tx-filter-platform').innerHTML = '<option value="">All platforms</option>' + opts;
}

function renderTransactions() {
  populatePlatformSelects();
  const platformFilter = $('#tx-filter-platform').value;
  const typeFilter = $('#tx-filter-type').value;

  const rows = state.transactions.filter(t =>
    (!platformFilter || t.platform_id === platformFilter) &&
    (!typeFilter || t.type === typeFilter)
  );

  const tbody = $('#tx-table-body');
  $('#tx-empty').style.display = rows.length ? 'none' : 'block';
  $('.tx-table').style.display = rows.length ? 'table' : 'none';

  tbody.innerHTML = rows.map(t => {
    const p = platformById(t.platform_id);
    const logo = p?.logo_url ? `<img src="${p.logo_url}" alt="">` : initials(p?.name);
    const sign = t.type === 'deposit' ? '+' : '−';
    return `
      <tr>
        <td><div class="cell-platform"><div class="cell-platform__logo">${logo}</div>${escapeHtml(p?.name || 'Unknown')}</div></td>
        <td><span class="badge badge-${t.type}">${t.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</span></td>
        <td>${escapeHtml(t.note || '—')}</td>
        <td>${formatDate(t.date)}</td>
        <td style="text-align:right" class="num ${t.type === 'deposit' ? 'tx-row__amt deposit' : 'tx-row__amt withdrawal'}">${sign}${peso(t.amount)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="edit-tx" data-id="${t.id}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn" data-action="delete-tx" data-id="${t.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  $$('[data-action="edit-tx"]', tbody).forEach(b => b.addEventListener('click', () => openTxModal(state.transactions.find(t => t.id === b.dataset.id))));
  $$('[data-action="delete-tx"]', tbody).forEach(b => b.addEventListener('click', () => {
    askConfirm('Delete transaction?', 'This will update the platform balance accordingly.', () => deleteTransaction(b.dataset.id));
  }));
}

$('#tx-filter-platform').addEventListener('change', renderTransactions);
$('#tx-filter-type').addEventListener('change', renderTransactions);
$('#add-tx-btn').addEventListener('click', () => openTxModal());

let currentTxType = 'deposit';
$$('#tx-type-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTxType = btn.dataset.type;
    $$('#tx-type-toggle button').forEach(b => b.classList.toggle('is-active', b === btn));
  });
});

function openTxModal(tx = null) {
  if (!state.platforms.length) {
    toast('Add a platform first', 'error');
    return;
  }
  populatePlatformSelects();
  $('#tx-error').textContent = '';
  $('#tx-modal-title').textContent = tx ? 'Edit transaction' : 'Add transaction';
  $('#tx-id').value = tx?.id || '';
  $('#tx-platform').value = tx?.platform_id || state.platforms[0].id;
  $('#tx-amount').value = tx?.amount || '';
  $('#tx-date').value = tx?.date || new Date().toISOString().slice(0, 10);
  $('#tx-note').value = tx?.note || '';

  currentTxType = tx?.type || 'deposit';
  $$('#tx-type-toggle button').forEach(b => b.classList.toggle('is-active', b.dataset.type === currentTxType));

  openModal('modal-tx');
}

$('#tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#tx-id').value;
  const payload = {
    platform_id: $('#tx-platform').value,
    type: currentTxType,
    amount: parseFloat($('#tx-amount').value),
    date: $('#tx-date').value,
    note: $('#tx-note').value.trim() || null,
  };
  const errorEl = $('#tx-error');
  if (!payload.platform_id || !payload.amount || payload.amount <= 0 || !payload.date) {
    errorEl.textContent = 'Please fill in platform, a positive amount, and a date.';
    return;
  }

  const submitBtn = $('#tx-submit');
  submitBtn.disabled = true;
  try {
    if (id) {
      const { error } = await sb.from('transactions').update(payload).eq('id', id);
      if (error) throw error;
      toast('Transaction updated', 'success');
    } else {
      const { error } = await sb.from('transactions').insert({ ...payload, user_id: state.user.id });
      if (error) throw error;
      toast(`${currentTxType === 'deposit' ? 'Deposit' : 'Withdrawal'} added`, 'success');
    }
    closeModal('modal-tx');
    await loadAllData();
  } catch (err) {
    errorEl.textContent = err.message || 'Could not save transaction.';
  } finally {
    submitBtn.disabled = false;
  }
});

async function deleteTransaction(id) {
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) { toast('Could not delete transaction', 'error'); return; }
  toast('Transaction deleted', 'success');
  await loadAllData();
}

/* ---------------------------------------------------------
   11. GOALS
   --------------------------------------------------------- */
function renderGoals() {
  const grid = $('#goal-grid');
  const total = state.platforms.reduce((sum, p) => sum + p.balance, 0);

  if (!state.goals.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
        <p>No goals yet. Set a target to start tracking progress.</p>
      </div>`;
    return;
  }

  grid.innerHTML = state.goals.map(g => {
    const pct = Math.min(100, (total / Number(g.target_amount)) * 100);
    const remaining = Math.max(Number(g.target_amount) - total, 0);
    return `
      <div class="goal-card" data-id="${g.id}">
        <div class="goal-card__head">
          <div>
            <div class="goal-card__name">${escapeHtml(g.name)}</div>
            ${g.target_date ? `<div class="goal-card__date">Target: ${formatDate(g.target_date)}</div>` : ''}
          </div>
        </div>
        <div class="goal-card__amounts">
          <span class="goal-card__saved num">${peso(total)}</span>
          <span class="goal-card__target num">of ${peso(g.target_amount)}</span>
        </div>
        <div class="goal-card__bar"><span style="width:${pct}%"></span></div>
        <div class="goal-card__foot">
          <span><b class="num">${pct.toFixed(1)}%</b> reached</span>
          <span><b class="num">${peso(remaining)}</b> to go</span>
        </div>
        <div class="goal-card__actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-goal" data-id="${g.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete-goal" data-id="${g.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  $$('[data-action="edit-goal"]', grid).forEach(b => b.addEventListener('click', () => openGoalModal(state.goals.find(g => g.id === b.dataset.id))));
  $$('[data-action="delete-goal"]', grid).forEach(b => b.addEventListener('click', () => {
    askConfirm('Delete goal?', 'This cannot be undone.', () => deleteGoal(b.dataset.id));
  }));
}

$('#add-goal-btn').addEventListener('click', () => openGoalModal());

function openGoalModal(goal = null) {
  $('#goal-error').textContent = '';
  $('#goal-modal-title').textContent = goal ? 'Edit goal' : 'Add goal';
  $('#goal-id').value = goal?.id || '';
  $('#goal-name').value = goal?.name || '';
  $('#goal-amount').value = goal?.target_amount || '';
  $('#goal-date').value = goal?.target_date || '';
  openModal('modal-goal');
}

$('#goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#goal-id').value;
  const payload = {
    name: $('#goal-name').value.trim(),
    target_amount: parseFloat($('#goal-amount').value),
    target_date: $('#goal-date').value || null,
  };
  const errorEl = $('#goal-error');
  if (!payload.name || !payload.target_amount || payload.target_amount <= 0) {
    errorEl.textContent = 'Please enter a name and a target amount greater than 0.';
    return;
  }

  const submitBtn = $('#goal-submit');
  submitBtn.disabled = true;
  try {
    if (id) {
      const { error } = await sb.from('goals').update(payload).eq('id', id);
      if (error) throw error;
      toast('Goal updated', 'success');
    } else {
      const { error } = await sb.from('goals').insert({ ...payload, user_id: state.user.id });
      if (error) throw error;
      toast('Goal added', 'success');
    }
    closeModal('modal-goal');
    await loadAllData();
  } catch (err) {
    errorEl.textContent = err.message || 'Could not save goal.';
  } finally {
    submitBtn.disabled = false;
  }
});

async function deleteGoal(id) {
  const { error } = await sb.from('goals').delete().eq('id', id);
  if (error) { toast('Could not delete goal', 'error'); return; }
  toast('Goal deleted', 'success');
  await loadAllData();
}

/* ---------------------------------------------------------
   12. INIT
   --------------------------------------------------------- */
(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    state.user = session.user;
    $('#sidebar-avatar').textContent = initials(session.user.email);
    $('#sidebar-email').textContent = session.user.email;
    showApp();
    await loadAllData();
  } else {
    showAuthScreen();
  }
})();
