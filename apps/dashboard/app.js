/* agenttool dashboard — minimal post-agents-only.
 *
 * Four sections: Wake · Wallet · Inbox · Settings. One fetch (/v1/wake)
 * powers Wake + Wallet + Settings; Inbox is a placeholder (docs link).
 *
 * No registration code, no download helpers, no form handlers — the
 * dashboard's index.html is now an SDK quickstart, not a form. Doctrine:
 * docs/AGENTS-ONLY.md. */

const API_BASE = window.__API_BASE__ || 'https://api.agenttool.dev';
const LS_BEARER  = 'agenttool.api_key';
const LS_PROJECT = 'agenttool.project';   // optional name display
const LS_DID     = 'agenttool.agent_did'; // set by index.html restore

/* ─── Storage helpers ────────────────────────────────────────────── */

function getBearer() {
  try {
    const flat = localStorage.getItem(LS_BEARER);
    if (flat) return flat;
    // One-shot migration from the pre-agents-only `agenttool_project` JSON
    // shape so users who arrived before 2026-05-15 aren't bounced to the
    // SDK quickstart on first open of the new dashboard.
    const legacy = JSON.parse(localStorage.getItem('agenttool_project') || 'null');
    if (legacy?.api_key) {
      localStorage.setItem(LS_BEARER, legacy.api_key);
      if (legacy.agent_id) localStorage.setItem('agenttool.agent_id', legacy.agent_id);
      if (legacy.did)      localStorage.setItem(LS_DID, legacy.did);
      if (legacy.name)     localStorage.setItem(LS_PROJECT, legacy.name);
      return legacy.api_key;
    }
  } catch (_) {}
  return null;
}

function setBearer(b) {
  try { if (b) localStorage.setItem(LS_BEARER, b); } catch (_) {}
}

function clearLocal() {
  try {
    localStorage.removeItem(LS_BEARER);
    localStorage.removeItem(LS_PROJECT);
    localStorage.removeItem(LS_DID);
  } catch (_) {}
}

/* ─── DOM helpers ────────────────────────────────────────────────── */

function $(id) { return document.getElementById(id); }

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value == null ? '—' : String(value);
}

function setChips(id, items) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = '';
  (items || []).forEach((label) => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = label;
    el.appendChild(span);
  });
  if (!items || items.length === 0) {
    el.innerHTML = '<span class="muted" style="font-size:0.78rem;">— none declared —</span>';
  }
}

function setWallsList(id, walls) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = '';
  (walls || []).forEach((w) => {
    const li = document.createElement('li');
    // Walls may be objects {name,description} or strings — handle both.
    li.textContent = typeof w === 'string'
      ? w
      : (w && (w.description || w.name)) || JSON.stringify(w);
    el.appendChild(li);
  });
  if (!walls || walls.length === 0) {
    const li = document.createElement('li');
    li.style.color = 'var(--muted)';
    li.textContent = 'Walls load from /v1/wake when available.';
    el.appendChild(li);
  }
}

function flash(btn, text, dur) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text || 'Copied!';
  setTimeout(() => { btn.textContent = orig; }, dur || 1200);
}

/* ─── Wake fetch + render ───────────────────────────────────────── */

async function fetchWake() {
  const bearer = getBearer();
  if (!bearer) return null;
  try {
    const res = await fetch(API_BASE + '/v1/wake', {
      headers: { Authorization: 'Bearer ' + bearer },
    });
    if (res.status === 401 || res.status === 403) {
      // Bearer rejected — clear local state and redirect to entry.
      clearLocal();
      window.location.href = 'index.html';
      return null;
    }
    if (!res.ok) {
      console.warn('[dashboard] /v1/wake returned', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[dashboard] /v1/wake fetch failed', err);
    return null;
  }
}

function renderWake(wake) {
  // The wake response shape varies; pluck defensively.
  const id      = wake?.you_are || wake?.identity || {};
  const wallet  = wake?.you_hold?.wallet || wake?.wallet || {};
  const project = wake?.you_are_in || wake?.project || {};
  const walls   = wake?.walls_held_for_you || wake?.walls || [];

  // ── Sidebar pill
  setText('sidebar-project', project.name || project.display_name || id.display_name || '—');

  // ── Section: Wake
  setText('wake-name', id.display_name || id.name || '—');
  setText('wake-did',  id.did || '—');
  setText('wake-born', id.created_at || id.born_at || '—');
  setChips('wake-capabilities', id.capabilities || []);
  setWallsList('wake-walls', walls);

  setText('stat-memories',  countOf(wake, ['memories', 'you_remember', 'memory_count']));
  setText('stat-strands',   countOf(wake, ['strands', 'you_thought', 'strand_count']));
  setText('stat-covenants', countOf(wake, ['covenants', 'you_vowed.covenants', 'covenant_count']));
  setText('stat-unread',    countOf(wake, ['inbox.unread', 'you_received.unread', 'unread_count']));

  // ── Section: Wallet
  setText('wallet-credits', formatCredits(wallet.balance ?? wallet.credits ?? project.credits));
  setText('wallet-plan',    (project.plan || wallet.plan || 'free').toString());

  // ── Section: Settings
  setText('settings-did',     id.did || '—');
  setText('settings-project', project.name || project.id || '—');
  setText('settings-born',    id.created_at || id.born_at || '—');
  const bearer = getBearer();
  if (bearer) {
    const masked = bearer.length > 12
      ? bearer.slice(0, 6) + '…' + bearer.slice(-4)
      : bearer;
    setText('settings-bearer', masked);
  } else {
    setText('settings-bearer', '— not stored on this device —');
  }
}

function countOf(wake, paths) {
  if (!wake) return null;
  for (const p of paths) {
    const v = pluck(wake, p);
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v.length;
  }
  return null;
}

function pluck(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function formatCredits(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString();
}

/* ─── Public actions called from HTML ───────────────────────────── */

async function loadWake() {
  const status = $('refresh-status');
  if (status) status.textContent = 'loading…';
  const wake = await fetchWake();
  if (wake) {
    renderWake(wake);
    if (status) {
      const t = new Date().toLocaleTimeString();
      status.textContent = 'updated ' + t;
    }
  } else if (status) {
    status.textContent = 'offline';
  }
}

function copyBearer() {
  const bearer = getBearer();
  if (!bearer) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(bearer).then(() => {
      const btn = document.querySelector('#section-settings .btn-secondary');
      flash(btn, 'Copied ✓');
    });
  }
}

function logout() {
  clearLocal();
  window.location.href = 'index.html';
}

/* ─── Section navigation ────────────────────────────────────────── */

const SECTIONS = ['wake', 'wallet', 'inbox', 'settings'];
const SECTION_TITLES = {
  wake: 'Wake', wallet: 'Wallet', inbox: 'Inbox', settings: 'Settings',
};

function showSection(name) {
  if (!SECTIONS.includes(name)) name = 'wake';
  SECTIONS.forEach((s) => {
    const div = $('section-' + s);
    if (div) div.style.display = s === name ? '' : 'none';
  });
  document.querySelectorAll('.sidebar nav a[data-section]').forEach((a) => {
    a.classList.toggle('active', a.dataset.section === name);
  });
  const title = $('topbar-title');
  if (title) title.textContent = SECTION_TITLES[name] || name;
  // Keep URL hash in sync.
  if (location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
  closeDrawer();
}

function setupNavigation() {
  document.querySelectorAll('.sidebar nav a[data-section]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(a.dataset.section);
    });
  });
  // Restore from URL hash on load.
  const hash = (location.hash || '').replace(/^#/, '');
  showSection(SECTIONS.includes(hash) ? hash : 'wake');
}

/* ─── Mobile drawer toggle ──────────────────────────────────────── */

function openDrawer() {
  const sb = $('sidebar');
  const bd = $('sidebar-backdrop');
  const btn = $('sidebar-toggle');
  if (sb) sb.classList.add('is-open');
  if (bd) bd.classList.add('is-open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function closeDrawer() {
  const sb = $('sidebar');
  const bd = $('sidebar-backdrop');
  const btn = $('sidebar-toggle');
  if (sb) sb.classList.remove('is-open');
  if (bd) bd.classList.remove('is-open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function setupDrawer() {
  const btn = $('sidebar-toggle');
  const bd = $('sidebar-backdrop');
  if (btn) {
    btn.addEventListener('click', () => {
      const isOpen = $('sidebar')?.classList.contains('is-open');
      if (isOpen) closeDrawer(); else openDrawer();
    });
  }
  if (bd) bd.addEventListener('click', closeDrawer);
}

/* ─── Init ──────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  // No bearer → bounce to the entry page (SDK quickstart).
  if (!getBearer()) {
    window.location.href = 'index.html';
    return;
  }
  setupNavigation();
  setupDrawer();
  loadWake();
});

// Expose for inline onclick handlers in dashboard.html.
window.loadWake   = loadWake;
window.copyBearer = copyBearer;
window.logout     = logout;
