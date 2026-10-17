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
  goals: [],          // [{ id, name, description, target_amount, target_date, status, completed_at, saved }]
  contributions: [],  // [{ id, goal_id, amount, date, note }]
  goalsReady: true,   // false when the goals tables don't exist yet
  pendingLogoFile: null,
  pendingLogoRemoved: false,
};

const PLATFORM_COLORS = ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb', '#1d4ed8', '#38bdf8', '#818cf8', '#0ea5e9'];

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
  await loadContributions();
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

/* ---------------------------------------------------------
   8. DASHBOARD
   --------------------------------------------------------- */
let growthChart, distChart;

function setTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  $$('.theme-toggle').forEach(button => {
    const label = `Switch to ${nextTheme} mode`;
    button.setAttribute('aria-label', label);
    button.title = label;
  });

  if (persist) {
    try {
      localStorage.setItem('ipon-theme', theme);
    } catch (error) {
      console.warn('Could not save the theme preference.', error);
    }
  }

  if ($('#app').classList.contains('is-ready')) renderDashboard();
}

function setupThemeToggle() {
  const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  setTheme(currentTheme);
  $$('.theme-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme, true);
    });
  });
}

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
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const tooltipBackground = getComputedStyle(document.documentElement).getPropertyValue('--surface-sunk').trim();
  distChart = new Chart($('#dist-chart').getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBackground,
          titleColor: chartText,
          bodyColor: chartText,
          callbacks: { label: (ctx) => `${ctx.label}: ${peso(ctx.raw)}` }
        }
      }
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
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue('--primary').trim();
  const chartFill = styles.getPropertyValue('--chart-fill').trim();
  const chartGrid = styles.getPropertyValue('--chart-grid').trim();
  const chartText = styles.getPropertyValue('--ink-soft').trim();
  const tooltipBackground = styles.getPropertyValue('--surface-sunk').trim();
  growthChart = new Chart($('#growth-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        data: values,
        borderColor: primary,
        backgroundColor: chartFill,
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: primary,
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBackground,
          titleColor: chartText,
          bodyColor: chartText,
          callbacks: { label: (ctx) => peso(ctx.raw) }
        }
      },
      scales: {
        y: { ticks: { color: chartText, callback: (v) => '₱' + Number(v).toLocaleString('en-PH') }, grid: { color: chartGrid } },
        x: { ticks: { color: chartText }, grid: { display: false } }
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
  const selectedFilterPlatform = $('#tx-filter-platform').value;
  const opts = state.platforms.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  $('#tx-platform').innerHTML = opts || '<option value="">No platforms yet</option>';
  $('#tx-filter-platform').innerHTML = '<option value="">All platforms</option>' + opts;
  $('#tx-filter-platform').value = selectedFilterPlatform;
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
   11. SAVINGS GOALS
   Goals are an allocation layer: contributions never change
   platform balances or create transactions.
   --------------------------------------------------------- */
function pesoGoal(amount) {
  const n = Number(amount) || 0;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Local-date string (toISOString would give yesterday's date early in the morning in UTC+8).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function goalById(id) { return state.goals.find(g => g.id === id); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

async function loadGoals() {
  const { data, error } = await sb.from('goal_progress').select('*').order('created_at', { ascending: true });
  if (error) {
    // Most likely supabase-goals.sql hasn't been run yet. Don't break the rest of the app.
    console.error('Could not load goals', error);
    state.goalsReady = false;
    state.goals = [];
    return;
  }
  state.goalsReady = true;
  state.goals = data.map(g => ({ ...g, id: g.goal_id, target_amount: Number(g.target_amount), saved: Number(g.saved) }));
}

async function loadContributions() {
  if (!state.goalsReady) { state.contributions = []; return; }
  const { data, error } = await sb.from('goal_contributions').select('*')
    .order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) { toast('Could not load goal contributions', 'error'); console.error(error); return; }
  state.contributions = data.map(c => ({ ...c, amount: Number(c.amount) }));
}

function goalPercent(g) {
  if (g.saved >= g.target_amount) return 100;
  return Math.max(0, Math.floor((g.saved / g.target_amount) * 100));
}

function goalDueInfo(g) {
  if (g.status === 'completed') {
    return { text: g.completed_at ? `Completed ${formatDate(g.completed_at.slice(0, 10))}` : 'Completed', tone: '' };
  }
  if (!g.target_date) return { text: 'No target date', tone: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(g.target_date + 'T00:00:00') - today) / 86400000);
  if (g.saved >= g.target_amount) return { text: `Target reached · due ${formatDate(g.target_date)}`, tone: '' };
  if (days < 0) return { text: `Overdue by ${plural(-days, 'day')}`, tone: 'is-late' };
  if (days === 0) return { text: 'Due today', tone: 'is-late' };
  return { text: `${formatDate(g.target_date)} · ${plural(days, 'day')} left`, tone: '' };
}

function goalCardHtml(g) {
  const pct = goalPercent(g);
  const done = g.status === 'completed';
  const reached = g.saved >= g.target_amount;
  const remaining = Math.max(g.target_amount - g.saved, 0);
  const due = goalDueInfo(g);
  const badge = done
    ? '<span class="badge badge-goal-done">Completed</span>'
    : reached ? '<span class="badge badge-goal-reached">Target reached</span>' : '';
  const remainingText = remaining > 0 ? `${pesoGoal(remaining)} remaining` : (g.saved > g.target_amount ? `${pesoGoal(g.saved - g.target_amount)} over target` : 'Fully funded');

  let primaryBtn;
  if (done) primaryBtn = `<button class="btn btn-soft btn-sm" data-action="reopen" data-id="${g.id}">Reopen</button>`;
  else if (reached) primaryBtn = `<button class="btn btn-primary btn-sm" data-action="complete" data-id="${g.id}">Mark completed</button>`;
  else primaryBtn = `<button class="btn btn-primary btn-sm" data-action="add" data-id="${g.id}">Add money</button>`;

  return `
    <article class="goal-card ${done ? 'is-completed' : ''}">
      <div class="goal-card__head">
        <div class="goal-card__title">
          <h3 class="goal-card__name">${escapeHtml(g.name)}</h3>
          ${g.description ? `<p class="goal-card__desc">${escapeHtml(g.description)}</p>` : ''}
        </div>
        ${badge}
      </div>
      <div class="goal-card__figures">
        <div class="goal-card__amounts num"><strong>${pesoGoal(g.saved)}</strong> of ${pesoGoal(g.target_amount)}</div>
        <div class="goal-card__pct num">${pct}%</div>
      </div>
      <div class="goal-bar" role="progressbar" aria-label="${escapeHtml(g.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <span style="width:${pct}%"></span>
      </div>
      <div class="goal-card__meta">
        <span class="num">${remainingText}</span>
        <span class="goal-card__due ${due.tone}">${escapeHtml(due.text)}</span>
      </div>
      <div class="goal-card__actions">
        ${primaryBtn}
        ${!done && reached ? `<button class="btn btn-ghost btn-sm" data-action="add" data-id="${g.id}">Add money</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="history" data-id="${g.id}">History</button>
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${g.id}">Edit</button>
      </div>
    </article>`;
}

function renderGoals() {
  const goals = state.goals;
  const active = goals.filter(g => g.status !== 'completed');
  const completed = goals.filter(g => g.status === 'completed');

  // Summary
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0);
  const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
  $('#goal-stat-target').textContent = pesoGoal(totalTarget);
  $('#goal-stat-target-sub').textContent = goals.length ? `Across ${plural(goals.length, 'goal')}` : 'Across all goals';
  $('#goal-stat-saved').textContent = pesoGoal(totalSaved);
  $('#goal-stat-saved-sub').textContent = totalTarget > 0
    ? `${Math.min(100, Math.floor((totalSaved / totalTarget) * 100))}% of your total target`
    : 'Set aside for goals';
  $('#goal-stat-active').textContent = active.length;
  $('#goal-stat-done').textContent = completed.length;

  // Setup notice (tables missing)
  $('#goal-setup-note').hidden = state.goalsReady;
  $('#add-goal-btn').disabled = !state.goalsReady;

  // Empty state vs grids
  const showEmpty = state.goalsReady && goals.length === 0;
  $('#goal-empty').hidden = !showEmpty;
  const grid = $('#goal-grid');
  grid.hidden = !state.goalsReady || showEmpty;

  grid.innerHTML = active.map(goalCardHtml).join('') + `
    <button class="add-tile goal-add-tile" id="add-goal-tile" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      <span>New goal</span>
    </button>`;

  $('#goal-completed-wrap').hidden = completed.length === 0;
  $('#goal-completed-grid').innerHTML = completed.map(goalCardHtml).join('');
}

// One delegated listener covers both grids and the dynamic add tile.
$('#view-goals').addEventListener('click', (e) => {
  if (e.target.closest('#add-goal-tile')) { openGoalModal(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const goal = goalById(btn.dataset.id);
  if (!goal) return;
  switch (btn.dataset.action) {
    case 'add': openContributionModal(goal); break;
    case 'history': openGoalHistory(goal.id); break;
    case 'edit': openGoalModal(goal); break;
    case 'complete': setGoalStatus(goal, 'completed'); break;
    case 'reopen': setGoalStatus(goal, 'active'); break;
  }
});
$('#add-goal-btn').addEventListener('click', () => openGoalModal());
$('#goal-empty-add').addEventListener('click', () => openGoalModal());

/* ---- Create / edit / delete ---- */
function openGoalModal(goal = null) {
  $('#goal-form').reset();
  $('#goal-error').textContent = '';
  $('#goal-modal-title').textContent = goal ? 'Edit goal' : 'New goal';
  $('#goal-id').value = goal?.id || '';
  $('#goal-name').value = goal?.name || '';
  $('#goal-target').value = goal?.target_amount || '';
  $('#goal-date').value = goal?.target_date || '';
  $('#goal-desc').value = goal?.description || '';

  let delBtn = $('#goal-delete-btn');
  if (goal) {
    if (!delBtn) {
      delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.id = 'goal-delete-btn';
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = 'Delete';
      $('#goal-form .modal__footer').prepend(delBtn);
    }
    delBtn.onclick = () => {
      closeModal('modal-goal');
      askConfirm('Delete goal?', `This removes "${goal.name}" and its contribution history. Your platform balances aren't affected. This can't be undone.`, () => deleteGoal(goal.id));
    };
  } else if (delBtn) {
    delBtn.remove();
  }
  openModal('modal-goal');
  $('#goal-name').focus();
}

$('#goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#goal-id').value;
  const payload = {
    name: $('#goal-name').value.trim(),
    target_amount: parseFloat($('#goal-target').value),
    target_date: $('#goal-date').value || null,
    description: $('#goal-desc').value.trim() || null,
  };
  const errorEl = $('#goal-error');
  if (!payload.name) { errorEl.textContent = 'Please enter a goal name.'; return; }
  if (!payload.target_amount || payload.target_amount <= 0) { errorEl.textContent = 'Please enter a target amount greater than zero.'; return; }

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
      toast('Goal created', 'success');
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

async function setGoalStatus(goal, status) {
  const completing = status === 'completed';
  const { error } = await sb.from('goals')
    .update({ status, completed_at: completing ? new Date().toISOString() : null })
    .eq('id', goal.id);
  if (error) { toast('Could not update goal', 'error'); console.error(error); return; }
  toast(completing ? `"${goal.name}" completed` : `"${goal.name}" reopened`, 'success');
  await loadAllData();
}

/* ---- Add money ---- */
function openContributionModal(goal) {
  $('#contribution-form').reset();
  $('#contribution-error').textContent = '';
  $('#contribution-goal-id').value = goal.id;
  $('#contribution-modal-title').textContent = `Add money to ${goal.name}`;
  const remaining = Math.max(goal.target_amount - goal.saved, 0);
  $('#contribution-hint').textContent = remaining > 0
    ? `${pesoGoal(goal.saved)} of ${pesoGoal(goal.target_amount)} saved · ${pesoGoal(remaining)} to go`
    : `${pesoGoal(goal.saved)} saved · target already reached`;
  $('#contribution-date').value = todayStr();
  openModal('modal-contribution');
  $('#contribution-amount').focus();
}

$('#contribution-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const goalId = $('#contribution-goal-id').value;
  const goal = goalById(goalId);
  const payload = {
    goal_id: goalId,
    amount: parseFloat($('#contribution-amount').value),
    date: $('#contribution-date').value,
    note: $('#contribution-note').value.trim() || null,
  };
  const errorEl = $('#contribution-error');
  if (!goal || !payload.amount || payload.amount <= 0 || !payload.date) {
    errorEl.textContent = 'Please enter a positive amount and a date.';
    return;
  }

  const submitBtn = $('#contribution-submit');
  submitBtn.disabled = true;
  try {
    const { error } = await sb.from('goal_contributions').insert({ ...payload, user_id: state.user.id });
    if (error) throw error;
    const justReached = goal.saved < goal.target_amount && goal.saved + payload.amount >= goal.target_amount;
    closeModal('modal-contribution');
    toast(justReached && goal.status !== 'completed'
      ? `Target reached for "${goal.name}"! Mark it completed when you're ready.`
      : `Added ${pesoGoal(payload.amount)} to "${goal.name}"`, 'success');
    await loadAllData();
  } catch (err) {
    errorEl.textContent = err.message || 'Could not add money.';
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---- Contribution history ---- */
function openGoalHistory(goalId) {
  const goal = goalById(goalId);
  if (!goal) return;
  $('#goal-history-title').textContent = `${goal.name} · contributions`;
  const rows = state.contributions.filter(c => c.goal_id === goalId);
  $('#goal-history-list').innerHTML = rows.length
    ? rows.map(c => `
      <div class="tx-row">
        <div class="tx-row__body">
          <div class="tx-row__title">${escapeHtml(c.note || 'Contribution')}</div>
          <div class="tx-row__sub">${formatDate(c.date)}</div>
        </div>
        <div class="tx-row__amt deposit num">+${pesoGoal(c.amount)}</div>
        <button class="icon-btn" type="button" data-contribution="${c.id}" title="Delete contribution" aria-label="Delete contribution">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z"/></svg>
        </button>
      </div>`).join('')
    : `<div class="empty-state"><p>No money added yet. Use "Add money" to log your first contribution.</p></div>`;
  $('#goal-history-list').dataset.goalId = goalId;
  openModal('modal-goal-history');
}

$('#goal-history-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-contribution]');
  if (!btn) return;
  const goalId = $('#goal-history-list').dataset.goalId;
  const contributionId = btn.dataset.contribution;
  closeModal('modal-goal-history');
  askConfirm('Delete contribution?', "This lowers the goal's saved amount. Your platform balances aren't affected.", async () => {
    const { error } = await sb.from('goal_contributions').delete().eq('id', contributionId);
    if (error) { toast('Could not delete contribution', 'error'); console.error(error); return; }
    toast('Contribution deleted', 'success');
    await loadAllData();
    openGoalHistory(goalId);
  });
});

/* ---------------------------------------------------------
   12. INIT
   --------------------------------------------------------- */
setupThemeToggle();

(async function init() {
  const footerName = $('#f-name');
  const footerYear = $('#f-year');
  if (footerName) footerName.textContent = 'Ipon';
  if (footerYear) footerYear.textContent = new Date().getFullYear();

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
