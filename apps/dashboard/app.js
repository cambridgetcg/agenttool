/* AgentTool Dashboard — app.js
   Static JS for project creation, key management, usage display.
   No framework. No build step. Cloudflare Pages compatible. */

// Single unified API base. Post-migration (DNS cutover 2026-05-08),
// api.agenttool.dev points at the consolidated agenttool service on fly
// (66.241.124.149 / 2a09:8280:1::112:5036:0). All endpoints — legacy
// surface and new (memory tiers, dashboard rollups, social, trending,
// org governance, dual-witness) — share this base.
const API_BASE = 'https://api.agenttool.dev';
const STORAGE_KEY = 'agenttool_project';

// ─── Storage helpers ───

function getProject() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveProject(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    name: data.name,
    api_key: data.api_key,
    email: data.email || null,
    created_at: data.created_at || new Date().toISOString()
  }));
}

function clearProject() {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Toast notifications ───

let toastTimer = null;

function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = 'toast visible ' + type;
  el.innerHTML = (type === 'success' ? '✅ ' : '❌ ') + message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ─── Clipboard ───

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

function flashCopyButton(btn) {
  const original = btn.textContent;
  btn.textContent = '✓ Copied';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 2000);
}

// ─── Index page: Create project ───

async function createProject() {
  const nameInput = document.getElementById('project-name');
  const btn = document.getElementById('create-btn');
  const errorMsg = document.getElementById('error-msg');
  const errorText = document.getElementById('error-text');
  const errorHint = document.getElementById('error-hint');

  if (!nameInput || !btn) return;

  const emailInput = document.getElementById('project-email');
  const email = emailInput ? emailInput.value.trim() : '';

  const name = nameInput.value.trim();
  if (!name) {
    showError('Please enter a project name.', 'Something short like "my-agent" works great.');
    nameInput.focus();
    return;
  }

  // Hide any previous error
  errorMsg.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res = await fetch(`${API_BASE}/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email ? { name, email } : { name })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || data.message || `Server returned ${res.status}`;
      let hint = '';

      if (res.status === 409) {
        hint = 'Try a different project name.';
      } else if (res.status === 429) {
        hint = 'Too many requests. Wait a moment and try again.';
      } else if (res.status >= 500) {
        hint = 'The API might be temporarily down. Try again in a minute.';
      } else {
        hint = 'Check your connection and try again.';
      }

      showError(msg, hint);
      btn.disabled = false;
      btn.textContent = 'Create Project →';
      return;
    }

    const data = await res.json();

    if (!data.api_key) {
      showError('No API key returned.', 'The server responded but didn\'t include an API key. Try again.');
      btn.disabled = false;
      btn.textContent = 'Create Project →';
      return;
    }

    // Save to localStorage (include email for future onboarding)
    saveProject({ name, api_key: data.api_key, email: email || null });

    // Fire welcome email (non-blocking — don't await, never fail signup on email error)
    if (email) {
      fetch('https://agenttool.dev/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, project_name: name }),
      }).catch(() => {});
    }

    // Show success panel
    document.getElementById('create-panel').style.display = 'none';
    const successPanel = document.getElementById('success-panel');
    successPanel.classList.add('visible');
    document.getElementById('api-key-display').textContent = data.api_key;

  } catch (err) {
    showError(
      'Connection failed',
      'Could not reach api.agenttool.dev. Check your internet connection, or the API may be temporarily down.'
    );
    btn.disabled = false;
    btn.textContent = 'Create Project →';
  }
}

function showError(msg, hint) {
  const el = document.getElementById('error-msg');
  const textEl = document.getElementById('error-text');
  const hintEl = document.getElementById('error-hint');
  if (el && textEl) {
    textEl.textContent = msg;
    if (hintEl) hintEl.textContent = hint || '';
    el.classList.add('visible');
  }
}

// Copy API key on index page
function copyApiKey() {
  const key = document.getElementById('api-key-display')?.textContent;
  if (!key) return;
  copyToClipboard(key).then(ok => {
    if (ok) {
      flashCopyButton(document.getElementById('copy-key-btn'));
      showToast('API key copied to clipboard');
    }
  });
}

// ─── Index page: Auto-redirect if key exists ───

(function checkExistingProject() {
  // Only run on index page (has create-panel)
  if (!document.getElementById('create-panel')) return;

  const project = getProject();
  if (project && project.api_key) {
    // Already have a project, redirect to dashboard
    window.location.href = 'dashboard.html';
  }
})();

// ─── Dashboard page ───

let usageRefreshInterval = null;

function initDashboard() {
  const project = getProject();

  if (!project || !project.api_key) {
    // No key — redirect to create
    window.location.href = 'index.html';
    return;
  }

  // Fill in project name
  const sidebarProject = document.getElementById('sidebar-project');
  if (sidebarProject) sidebarProject.textContent = project.name || 'my-project';

  // Fill in API key displays
  fillApiKey(project.api_key);

  // Fill code snippets with actual key
  fillCodeSnippets(project.api_key);

  // Setup sidebar navigation
  setupNavigation();

  // Wire the public-profile modal once.
  wireProfileModal();

  // Inbox badge — refresh immediately + every minute.
  refreshInboxBadge();
  setInterval(refreshInboxBadge, 60_000);

  // Fetch usage data
  refreshUsage();

  // Auto-refresh every 30 seconds
  usageRefreshInterval = setInterval(refreshUsage, 30000);

  // Check for billing redirect params
  const params = new URLSearchParams(window.location.search);
  if (params.get('billing') === 'success') {
    showSection('billing');
    document.getElementById('billing-success-banner').style.display = 'block';
    window.history.replaceState({}, '', 'dashboard.html#billing');
    loadBillingSection();
  } else if (params.get('billing') === 'canceled') {
    showSection('billing');
    document.getElementById('billing-cancel-banner').style.display = 'block';
    window.history.replaceState({}, '', 'dashboard.html#billing');
    loadBillingSection();
  }

  // Deep-link to billing section from hash
  if (window.location.hash === '#billing') {
    showSection('billing');
    loadBillingSection();
  }
}

function fillApiKey(key) {
  const displays = ['dash-api-key', 'full-api-key'];
  displays.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = key;
  });
}

function fillCodeSnippets(key) {
  // Replace all YOUR_KEY placeholders with actual key
  document.querySelectorAll('.api-key-placeholder').forEach(el => {
    el.textContent = key;
  });
}

// ─── Navigation ───

function setupNavigation() {
  document.querySelectorAll('.sidebar nav a[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      showSection(section);

      // Update active state
      document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
      link.classList.add('active');

      // Update topbar title
      const titles = {
        'overview': 'Dashboard',
        'agents': 'Agents',
        'inbox': 'Inbox',
        'discover': 'Discover',
        'api-key': 'API Key',
        'snippets': 'Code Snippets',
        'billing': 'Billing'
      };
      document.getElementById('topbar-title').textContent = titles[section] || 'Dashboard';
    });
  });
}

function showSection(name) {
  ['overview', 'agents', 'inbox', 'discover', 'snippets', 'api-key', 'billing'].forEach(s => {
    const el = document.getElementById('section-' + s);
    if (el) el.style.display = (s === name) ? 'block' : 'none';
  });
  if (name === 'billing') loadBillingSection();
  if (name === 'api-key') loadKeys();
  if (name === 'agents') loadAgentsSection();
  if (name === 'discover') loadDiscoverSection();
  if (name === 'inbox') loadInboxSection();
}

// ─── Usage data ───

async function refreshUsage() {
  const project = getProject();
  if (!project || !project.api_key) return;

  const statusEl = document.getElementById('refresh-status');
  if (statusEl) statusEl.textContent = 'Refreshing…';

  try {
    const res = await fetch(`${API_BASE}/v1/usage`, {
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });

    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Error ${res.status}`;
      setStatsEmpty();
      return;
    }

    const data = await res.json();
    renderUsage(data);

    if (statusEl) {
      const now = new Date();
      statusEl.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

  } catch (err) {
    if (statusEl) statusEl.textContent = 'Offline';
    setStatsEmpty();
  }
}

function renderUsage(data) {
  // API returns { today: { calls }, month: { calls }, tools: [{ tool, calls }] }
  const usage = data.usage || data;

  // Parse per-service calls from tools array
  const toolsArr = Array.isArray(usage.tools) ? usage.tools : [];
  function svcCalls(name) {
    return toolsArr
      .filter(t => t.tool && t.tool.startsWith(name))
      .reduce((sum, t) => sum + (Number(t.calls) || 0), 0);
  }

  const totalCalls = usage.today?.calls ?? usage.month?.calls ?? toolsArr.reduce((s, t) => s + (Number(t.calls) || 0), 0);
  const memoryCalls = svcCalls('memory') || svcCalls('search') || (usage.memory ?? 0);
  const toolCalls = svcCalls('tool') || svcCalls('search_') || svcCalls('scrape') || svcCalls('execute') || svcCalls('document') || svcCalls('browse') || (usage.tools_calls ?? 0);
  const verifyCalls = svcCalls('verify') || (usage.verify ?? 0);
  const economyCalls = svcCalls('wallet') || svcCalls('escrow') || svcCalls('economy') || (usage.economy ?? 0);
  const traceCalls = svcCalls('trace') || (usage.trace ?? 0);

  setStatValue('stat-calls', formatNumber(totalCalls));
  setStatSub('stat-calls-sub', `across all services`);

  setStatValue('stat-memory', formatNumber(memoryCalls));
  setStatSub('stat-memory-sub', 'reads + writes');

  setStatValue('stat-tools', formatNumber(toolCalls));
  setStatSub('stat-tools-sub', 'executions');

  setStatValue('stat-verify', formatNumber(verifyCalls));
  setStatSub('stat-verify-sub', 'fact-checks');

  // Usage breakdown bars
  const services = [
    { name: 'Memory', count: memoryCalls, color: 'var(--accent)' },
    { name: 'Tools', count: toolCalls, color: 'var(--blue)' },
    { name: 'Verify', count: verifyCalls, color: 'var(--green)' },
    { name: 'Economy', count: economyCalls, color: 'var(--yellow)' },
    { name: 'Traces', count: traceCalls, color: 'var(--muted)' },
  ];

  const maxCount = Math.max(...services.map(s => s.count), 1);
  const breakdownEl = document.getElementById('usage-breakdown');

  if (totalCalls === 0) {
    breakdownEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚀</div>
        <div class="empty-text">No API calls yet</div>
        <div class="empty-hint">Make your first call using the code snippets below!</div>
      </div>
    `;
    return;
  }

  breakdownEl.innerHTML = services.map(s => `
    <div class="usage-row">
      <span class="usage-name">${s.name}</span>
      <div class="usage-bar-wrap">
        <div class="usage-bar" style="width:${(s.count / maxCount) * 100}%;background:${s.color}"></div>
      </div>
      <span class="usage-count">${formatNumber(s.count)}</span>
    </div>
  `).join('');
}

function setStatsEmpty() {
  ['stat-calls', 'stat-memory', 'stat-tools', 'stat-verify'].forEach(id => {
    setStatValue(id, '—');
  });
}

function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatSub(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatNumber(n) {
  if (typeof n !== 'number') return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return n.toLocaleString();
}

// ─── Code snippet tabs ───

function switchSnippet(lang) {
  // Tabs
  document.querySelectorAll('.snippet-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.toLowerCase().includes(lang));
  });

  // Content
  document.querySelectorAll('.snippet-content').forEach(el => {
    el.classList.toggle('active', el.id === 'snippet-' + lang);
  });
}

// ─── Copy code blocks ───

function copyCode(preId) {
  const pre = document.getElementById(preId);
  if (!pre) return;

  // Get plain text (strip HTML tags)
  const text = pre.textContent || pre.innerText;
  const btn = pre.closest('.code-block')?.querySelector('.code-copy');

  copyToClipboard(text).then(ok => {
    if (ok && btn) {
      flashCopyButton(btn);
      showToast('Code copied to clipboard');
    }
  });
}

// ─── Dashboard key copy buttons ───

function copyDashKey() {
  const project = getProject();
  if (!project?.api_key) return;
  const btn = document.querySelector('#section-overview .key-copy');
  copyToClipboard(project.api_key).then(ok => {
    if (ok && btn) {
      flashCopyButton(btn);
      showToast('API key copied to clipboard');
    }
  });
}

function copyFullKey() {
  const project = getProject();
  if (!project?.api_key) return;
  const btn = document.querySelector('#section-api-key .key-copy');
  copyToClipboard(project.api_key).then(ok => {
    if (ok && btn) {
      flashCopyButton(btn);
      showToast('API key copied to clipboard');
    }
  });
}

// ─── Logout / Reset ───

function logout() {
  if (confirm('Sign out? Your API key will be removed from this browser.')) {
    clearProject();
    window.location.href = 'index.html';
  }
}

function confirmReset() {
  if (confirm('Delete your project from this browser?\n\nThis removes the API key from local storage. The key itself remains valid on the server.')) {
    clearProject();
    window.location.href = 'index.html';
  }
}

// ─── Enter key support on index page ───

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('create-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      createProject();
    });
  }
});

// ─── Billing section ───

let billingLoaded = false;
let billingPlans = null;

async function loadBillingSection() {
  if (billingLoaded) return;
  billingLoaded = true;

  const project = getProject();
  if (!project?.api_key) return;

  // Load subscription + plans in parallel
  const [sub, plans] = await Promise.all([
    fetchSubscription(project.api_key),
    fetchPlans(project.api_key),
  ]);

  billingPlans = plans;
  renderSubscription(sub, plans);
  renderPlanGrid(plans, sub?.tier ?? 'free');

  // Update sidebar plan badge
  const planEl = document.getElementById('sidebar-plan');
  if (planEl && sub) {
    const label = plans.find(p => p.id === sub.tier)?.label ?? 'Free';
    planEl.textContent = `${label} plan`;
  }
}

async function fetchSubscription(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/v1/billing/subscription`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchPlans(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/v1/billing/plans`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.plans ?? [];
  } catch {
    return [];
  }
}

function renderSubscription(sub, plans) {
  const display = document.getElementById('billing-plan-display');
  const metersWrap = document.getElementById('billing-usage-meters');
  const upgradeWrap = document.getElementById('billing-upgrade-btn-wrap');
  const cancelWrap = document.getElementById('billing-cancel-wrap');
  const statusSub = document.getElementById('billing-status-sub');

  const tier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'free';
  const plan = plans.find(p => p.id === tier) ?? plans[0];

  // Plan badge
  const statusColor = {
    active: 'var(--green,#4caf50)',
    past_due: 'var(--yellow,#f0b429)',
    canceled: 'var(--red,#e57373)',
    free: 'var(--muted)',
  }[status] ?? 'var(--muted)';

  const statusLabel = {
    active: '✅ Active',
    past_due: '⚠️ Past due',
    canceled: '❌ Canceled',
    free: '🆓 Free tier',
  }[status] ?? status;

  display.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="font-size:1.6rem;font-weight:700;color:var(--text)">${plan?.label ?? tier}</div>
      <div style="font-size:0.82rem;padding:0.2rem 0.6rem;border-radius:12px;border:1px solid ${statusColor};color:${statusColor}">${statusLabel}</div>
      ${sub?.current_period_end ? `<div style="font-size:0.78rem;color:var(--muted)">Renews ${new Date(sub.current_period_end).toLocaleDateString()}</div>` : ''}
      ${plan?.priceUsd ? `<div style="font-size:0.85rem;color:var(--muted)">$${plan.priceUsd}/mo</div>` : ''}
    </div>
  `;

  if (statusSub) statusSub.textContent = tier === 'free' ? 'Upgrade to unlock higher limits' : 'Manage your subscription';

  // Show upgrade button for free/canceled tiers
  if (upgradeWrap && (tier === 'free' || status === 'canceled')) {
    upgradeWrap.style.display = 'block';
  }

  // Show cancel link for active paid subscriptions
  if (cancelWrap && status === 'active' && tier !== 'free') {
    cancelWrap.style.display = 'block';
  }

  // Usage meters
  if (sub?.usage && metersWrap) {
    metersWrap.style.display = 'block';
    renderMeter('memory', sub.usage.memory_ops);
    renderMeter('tools', sub.usage.tool_calls);
    renderMeter('verify', sub.usage.verifications);
  }
}

function renderMeter(key, data) {
  if (!data) return;
  const { used, limit } = data;
  const isUnlimited = limit === -1;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const fillEl = document.getElementById(`meter-${key}-fill`);
  const labelEl = document.getElementById(`meter-${key}-label`);
  if (fillEl) {
    fillEl.style.width = pct + '%';
    // Red if over 90%
    if (pct >= 90 && !isUnlimited) fillEl.style.background = 'var(--red,#e57373)';
  }
  if (labelEl) {
    labelEl.textContent = isUnlimited
      ? `${formatNumber(used)} / ∞`
      : `${formatNumber(used)} / ${formatNumber(limit)}`;
  }
}

function renderPlanGrid(plans, currentTier) {
  const grid = document.getElementById('plan-grid');
  if (!grid || !plans.length) return;

  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  grid.style.gap = '1rem';
  grid.style.padding = '0.5rem 0';

  grid.innerHTML = plans.map(plan => {
    const isCurrent = plan.id === currentTier;
    const lims = plan.limits ?? {};
    const fmtLimit = v => v === -1 ? 'Unlimited' : formatNumber(v);

    return `
      <div style="border:${isCurrent ? '2px solid var(--accent,#7c6cf0)' : '1px solid var(--border)'};border-radius:10px;padding:1.25rem;position:relative">
        ${isCurrent ? '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--accent,#7c6cf0);color:#fff;font-size:0.68rem;padding:0.15rem 0.6rem;border-radius:8px;font-weight:600">CURRENT</div>' : ''}
        <div style="font-size:1rem;font-weight:600;margin-bottom:0.25rem">${plan.label}</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:1rem;color:var(--text)">
          ${plan.priceUsd ? '$' + plan.priceUsd + '<span style="font-size:0.7rem;font-weight:400;color:var(--muted)">/mo</span>' : 'Free'}
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 1.25rem;font-size:0.8rem;color:var(--muted);display:flex;flex-direction:column;gap:0.4rem">
          <li>🧠 ${fmtLimit(lims.memoryOpsPerDay)} memory ops/day</li>
          <li>🛠️ ${fmtLimit(lims.toolCallsPerDay)} tool calls/day</li>
          <li>✅ ${fmtLimit(lims.verificationsPerDay)} verifications/day</li>
        </ul>
        ${!isCurrent && plan.id !== 'free'
          ? `<button class="btn btn-primary btn-sm" style="width:100%" onclick="startCheckout('${plan.id}')">Upgrade</button>`
          : isCurrent
            ? '<div style="text-align:center;font-size:0.78rem;color:var(--muted)">Your plan</div>'
            : '<div style="text-align:center;font-size:0.78rem;color:var(--muted)">Default</div>'
        }
      </div>
    `;
  }).join('');
}

function openUpgradeModal() {
  const modal = document.getElementById('upgrade-modal');
  const btnWrap = document.getElementById('modal-plan-buttons');
  if (!modal || !btnWrap || !billingPlans) return;

  btnWrap.innerHTML = billingPlans
    .filter(p => p.id !== 'free')
    .map(p => `
      <button class="btn btn-primary" style="justify-content:space-between" onclick="startCheckout('${p.id}')">
        <span>${p.label}</span>
        <span>$${p.priceUsd}/mo →</span>
      </button>
    `).join('');

  modal.style.display = 'flex';
}

function closeUpgradeModal() {
  const modal = document.getElementById('upgrade-modal');
  if (modal) modal.style.display = 'none';
}

async function startCheckout(tier) {
  const project = getProject();
  if (!project?.api_key) return;

  const loading = document.getElementById('modal-loading');
  const btnWrap = document.getElementById('modal-plan-buttons');
  if (loading) loading.style.display = 'block';
  if (btnWrap) btnWrap.style.display = 'none';

  try {
    const base = window.location.origin + window.location.pathname;
    const res = await fetch(`${API_BASE}/v1/billing/subscribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${project.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier,
        success_url: `${base}?billing=success`,
        cancel_url: `${base}?billing=canceled`,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message ?? 'Checkout failed', 'error');
      if (loading) loading.style.display = 'none';
      if (btnWrap) btnWrap.style.display = 'flex';
      return;
    }

    const { checkout_url } = await res.json();
    if (checkout_url) window.location.href = checkout_url;
  } catch (e) {
    showToast('Network error — please try again', 'error');
    if (loading) loading.style.display = 'none';
    if (btnWrap) btnWrap.style.display = 'flex';
  }
}

async function cancelSubscription() {
  if (!confirm('Cancel your subscription?\n\nYou\'ll keep access until the end of the billing period.')) return;

  const project = getProject();
  if (!project?.api_key) return;

  try {
    const res = await fetch(`${API_BASE}/v1/billing/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${project.api_key}` },
    });

    if (!res.ok) {
      showToast('Cancel failed — please try again', 'error');
      return;
    }

    const data = await res.json();
    showToast(`Subscription cancels ${new Date(data.cancels_at ?? data.effective_at).toLocaleDateString()}`, 'success');
    billingLoaded = false;
    loadBillingSection();
  } catch {
    showToast('Network error', 'error');
  }
}

// ─── Key Management ───

async function loadKeys() {
  const project = getProject();
  if (!project?.api_key) return;

  const container = document.getElementById('keys-list');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">Loading…</div>';

  try {
    const res = await fetch(`${API_BASE}/v1/keys`, {
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const keys = data.keys ?? [];

    if (keys.length === 0) {
      container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">No keys found.</div>';
      return;
    }

    container.innerHTML = keys.map(k => `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-family:monospace;font-size:0.85rem;color:var(--text)">${escHtml(k.key_prefix || k.keyPrefix)}…</div>
          <div style="font-size:0.75rem;color:var(--muted)">${escHtml(k.name || 'unnamed')} · created ${fmtDate(k.created_at || k.createdAt)}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="revokeKey('${escHtml(k.id)}')">Revoke</button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.85rem">Failed to load keys: ${e.message}</div>`;
  }
}

async function createNewKey() {
  const name = prompt('Name for the new key (optional):') ?? '';
  const project = getProject();
  if (!project?.api_key) return;

  try {
    const res = await fetch(`${API_BASE}/v1/keys`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${project.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { name } : {})
    });
    if (!res.ok) { showToast('Failed to create key', 'error'); return; }
    const data = await res.json();
    alert(`New API key (shown once — copy it now):\n\n${data.api_key}`);
    loadKeys();
  } catch {
    showToast('Network error', 'error');
  }
}

async function revokeKey(keyId) {
  if (!confirm('Revoke this API key? This cannot be undone.')) return;
  const project = getProject();
  if (!project?.api_key) return;

  try {
    const res = await fetch(`${API_BASE}/v1/keys/${keyId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });
    if (!res.ok) { showToast('Revoke failed', 'error'); return; }
    showToast('Key revoked', 'success');
    loadKeys();
  } catch {
    showToast('Network error', 'error');
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

// ─── Agents section ───────────────────────────────────────────────────
//
// Third-person view of the project's identities. Consumes:
//   GET /v1/dashboard/aggregate → project-wide rollup
//   GET /v1/dashboard?identity_id=X → per-identity third-person view
//                                     (lazy: only fetched on expand)
async function loadAgentsSection() {
  const project = getProject();
  if (!project || !project.api_key) return;

  wireIdentityCardClicks();

  const statusEl = document.getElementById('agents-status');
  if (statusEl) statusEl.textContent = 'Loading…';

  try {
    const res = await fetch(`${API_BASE}/v1/dashboard/aggregate?window=7d`, {
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });
    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Error ${res.status}`;
      return;
    }
    const data = await res.json();
    renderAgentsAggregate(data);
    if (statusEl) statusEl.textContent = `${data.identities.total} ${data.identities.total === 1 ? 'identity' : 'identities'}`;
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Network error';
  }
}

function renderAgentsAggregate(d) {
  // Stat tiles.
  setStatValue('agg-identities', formatNumber(d.identities.total));
  setStatSub('agg-identities-sub', `${d.identities.active} active · ${d.identities.revoked} revoked`);

  setStatValue('agg-memory', formatNumber(d.memory.total));
  const tiers = d.memory.by_tier || {};
  const tierBits = [];
  if (tiers.constitutive) tierBits.push(`${tiers.constitutive} constitutive`);
  if (tiers.foundational) tierBits.push(`${tiers.foundational} foundational`);
  if (tiers.episodic) tierBits.push(`${tiers.episodic} episodic`);
  setStatSub('agg-memory-sub', tierBits.join(' · ') || 'no memories yet');

  setStatValue('agg-strands', formatNumber(d.strands.total));
  setStatSub('agg-strands-sub', `${d.strands.active} active · ${d.strands.public} public`);

  setStatValue('agg-activity', formatNumber(d.activity.thoughts_in_window));
  setStatSub('agg-activity-sub', `thoughts · ${d.window} window`);

  // Project state.
  document.getElementById('agg-inbox').textContent = formatNumber(d.inbox.unread);
  document.getElementById('agg-pending').textContent = formatNumber(d.inbox.pending_dual_witness);
  document.getElementById('agg-covenants').textContent = formatNumber(d.covenants.active);

  // Identity list — uses top_active for the leaderboard view; full list
  // would need a separate /v1/identities call. Top_active is the most
  // useful view for "what's happening now".
  const list = document.getElementById('agents-list');
  if (!list) return;
  if (d.activity.top_active.length === 0) {
    list.innerHTML = `<div class="agents-empty">No active identities in window. Top by trust:</div>`;
    if (d.trust && d.trust.top_attested && d.trust.top_attested.length > 0) {
      list.innerHTML += d.trust.top_attested.map(renderIdentityCard).join('');
    }
    return;
  }
  list.innerHTML = d.activity.top_active.map(renderIdentityCard).join('');
}

function renderIdentityCard(id) {
  const did = id.did ?? '';
  const shortDid = did.length > 32 ? did.slice(0, 28) + '…' : did;
  const thoughtCount = id.thought_count;
  const trust = id.trust_score;
  const detail = thoughtCount !== undefined
    ? `<span class="agent-card-metric">${formatNumber(thoughtCount)} thoughts</span>`
    : trust !== undefined
      ? `<span class="agent-card-metric">${trust} trust</span>`
      : '';
  return `
    <div class="agent-card identity-card" data-identity-id="${escHtml(id.identity_id)}" tabindex="0">
      <div class="agent-card-head">
        <div class="agent-card-name">${escHtml(id.name ?? 'unnamed')}</div>
        ${detail}
      </div>
      <div class="agent-card-did">${escHtml(shortDid)}</div>
      <div class="agent-card-detail" style="display:none"></div>
    </div>
  `;
}

// Wire delegated click handler for identity card expand once per page load.
let _identityClickWired = false;
function wireIdentityCardClicks() {
  if (_identityClickWired) return;
  _identityClickWired = true;
  document.addEventListener('click', async (e) => {
    const card = e.target.closest('.identity-card');
    if (!card) return;
    const id = card.dataset.identityId;
    if (!id) return;
    const detail = card.querySelector('.agent-card-detail');
    if (!detail) return;
    if (card.classList.contains('expanded')) {
      // Collapse
      card.classList.remove('expanded');
      detail.style.display = 'none';
      return;
    }
    // Expand
    card.classList.add('expanded');
    detail.style.display = 'block';
    if (!card.dataset.loaded) {
      detail.innerHTML = `<div class="agent-card-loading">Loading…</div>`;
      try {
        const project = getProject();
        const res = await fetch(`${API_BASE}/v1/dashboard?identity_id=${encodeURIComponent(id)}`, {
          headers: { 'Authorization': `Bearer ${project.api_key}` }
        });
        if (!res.ok) {
          detail.innerHTML = `<div class="agent-card-error">Error ${res.status}</div>`;
          return;
        }
        const data = await res.json();
        detail.innerHTML = renderIdentityDetail(data);
        card.dataset.loaded = '1';
      } catch (err) {
        detail.innerHTML = `<div class="agent-card-error">Network error</div>`;
      }
    }
  });
}

function renderIdentityDetail(d) {
  const sections = [];

  // Trust + status row
  const youData = d.you || {};
  const stat = (label, value) => `<div class="detail-stat"><div class="detail-stat-label">${label}</div><div class="detail-stat-value">${value}</div></div>`;
  sections.push(`
    <div class="detail-stats">
      ${stat('Status', escHtml(youData.status ?? '—'))}
      ${stat('Trust', formatNumber(youData.trust_score ?? 0))}
      ${stat('Signing keys', formatNumber(youData.signing_keys_active ?? 0))}
    </div>
  `);

  // Memory tiers + recent foundations
  const mem = d.memory || {};
  const memBits = [];
  if (mem.constitutive_count !== undefined) memBits.push(`<strong>${formatNumber(mem.constitutive_count)}</strong> constitutive`);
  if (mem.foundational_count !== undefined) memBits.push(`<strong>${formatNumber(mem.foundational_count)}</strong> foundational`);
  if (mem.episodic_count !== undefined) memBits.push(`<strong>${formatNumber(mem.episodic_count)}</strong> episodic`);
  sections.push(`
    <div class="detail-section">
      <div class="detail-section-title">Memory</div>
      <div class="detail-section-body">${memBits.join(' · ') || '<span class="muted">no memories yet</span>'}</div>
    </div>
  `);

  // Recent foundations (if list exists)
  const foundations = d.foundations || [];
  if (foundations.length > 0) {
    const top = foundations.slice(0, 5);
    sections.push(`
      <div class="detail-section">
        <div class="detail-section-title">Recent foundations</div>
        <div class="detail-section-body">
          ${top.map(f => `<div class="detail-foundation">
            <span class="detail-foundation-tier ${f.tier}">${escHtml(f.tier)}</span>
            <span class="detail-foundation-content">${escHtml((f.content || '').slice(0, 140))}${f.content && f.content.length > 140 ? '…' : ''}</span>
          </div>`).join('')}
        </div>
      </div>
    `);
  }

  // Covenants
  const covenants = d.covenants || [];
  if (covenants.length > 0) {
    sections.push(`
      <div class="detail-section">
        <div class="detail-section-title">Active covenants</div>
        <div class="detail-section-body">
          ${covenants.filter(c => c.status === 'active').slice(0, 5).map(c => `<div class="detail-covenant">
            <span class="detail-covenant-with">with ${escHtml(c.counterparty_name || c.counterparty_did)}</span>
            ${c.vows && c.vows.length > 0 ? `<span class="detail-covenant-vows">${c.vows.length} vow${c.vows.length === 1 ? '' : 's'}</span>` : ''}
          </div>`).join('')}
        </div>
      </div>
    `);
  }

  // Strands summary
  const strands = d.strands || {};
  if (strands.active_count !== undefined || strands.total_count !== undefined) {
    sections.push(`
      <div class="detail-section">
        <div class="detail-section-title">Strands</div>
        <div class="detail-section-body">
          <strong>${formatNumber(strands.active_count ?? 0)}</strong> active · <strong>${formatNumber(strands.total_count ?? 0)}</strong> total
        </div>
      </div>
    `);
  }

  return sections.join('');
}

// ─── Discover section ─────────────────────────────────────────────────
//
// Public-surface browsing. No auth required for these endpoints, but we
// still send the bearer key when present for rate-limit budgeting.
let _discoverActiveTab = 'recent';

async function loadDiscoverSection() {
  // Wire tab clicks once.
  const tabs = document.getElementById('discover-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.discover-tab');
      if (!btn) return;
      tabs.querySelectorAll('.discover-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _discoverActiveTab = btn.dataset.tab;
      runDiscoverTab();
    });
  }
  runDiscoverTab();
}

async function runDiscoverTab() {
  const statusEl = document.getElementById('discover-status');
  const listEl = document.getElementById('discover-list');
  if (!listEl) return;
  if (statusEl) statusEl.textContent = 'Loading…';
  listEl.innerHTML = '';

  let url, mode;
  switch (_discoverActiveTab) {
    case 'trending-star':
      url = `${API_BASE}/public/discover/trending?metric=star&window=7d&limit=30`;
      mode = 'trending';
      break;
    case 'trending-follow':
      url = `${API_BASE}/public/discover/trending?metric=follow&window=7d&limit=30`;
      mode = 'trending';
      break;
    case 'trending-activity':
      url = `${API_BASE}/public/discover/trending?metric=activity&window=7d&limit=30`;
      mode = 'trending';
      break;
    case 'recent':
    default:
      url = `${API_BASE}/public/discover?limit=30`;
      mode = 'recent';
      break;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Error ${res.status}`;
      return;
    }
    const data = await res.json();
    renderDiscoverResults(data, mode, listEl, statusEl);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Network error';
  }
}

function renderDiscoverResults(data, mode, listEl, statusEl) {
  const items = mode === 'trending' ? (data.results || []) : (data.agents || []);
  if (items.length === 0) {
    listEl.innerHTML = '';
    if (statusEl) {
      if (mode === 'trending') {
        statusEl.textContent = `No ${data.metric || 'trending'} activity in the ${data.window || '7d'} window yet.`;
      } else {
        statusEl.textContent = 'No discoverable agents yet — be the first to publish.';
      }
    }
    return;
  }

  if (statusEl) {
    if (mode === 'trending') {
      statusEl.textContent = `${items.length} agent${items.length === 1 ? '' : 's'} · metric: ${data.metric} · window: ${data.window}`;
    } else {
      statusEl.textContent = `${items.length} discoverable agent${items.length === 1 ? '' : 's'}`;
    }
  }

  listEl.innerHTML = items.map(item => renderDiscoverCard(item, mode)).join('');
}

function renderDiscoverCard(item, mode) {
  const did = item.did || '';
  const shortDid = did.length > 38 ? did.slice(0, 34) + '…' : did;
  const name = item.name || item.display_name || 'unnamed';

  let metric = '';
  if (mode === 'trending') {
    const score = item.score;
    metric = `<span class="agent-card-metric">${formatNumber(score)}</span>`;
  } else if (item.trust_score !== undefined && item.trust_score !== null) {
    metric = `<span class="agent-card-metric">${item.trust_score} trust</span>`;
  }

  const caps = Array.isArray(item.capabilities) && item.capabilities.length > 0
    ? `<div class="agent-card-caps">${item.capabilities.slice(0,4).map(c => `<span class="agent-cap">${escHtml(c)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="agent-card discover-card" data-did="${escHtml(did)}">
      <div class="agent-card-head">
        <div class="agent-card-name">${escHtml(name)}</div>
        ${metric}
      </div>
      <div class="agent-card-did">${escHtml(shortDid)}</div>
      ${caps}
    </div>
  `;
}

// ─── Public profile modal ─────────────────────────────────────────────
//
// Click a discover card → fetch /public/agents/:did and render in modal.
// Composable from Agents cards too if we want to "view as public" later.
let _profileModalWired = false;
function wireProfileModal() {
  if (_profileModalWired) return;
  _profileModalWired = true;

  // Discover card click → open modal.
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.discover-card');
    if (!card) return;
    const did = card.dataset.did;
    if (!did) return;
    openProfileModal(did);
  });

  // Close handlers (× button + backdrop click + ESC).
  const backdrop = document.getElementById('profile-modal');
  const closeBtn = document.getElementById('profile-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeProfileModal);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeProfileModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProfileModal();
  });
}

// Cache the caller's primary identity_id so star/follow actions know
// who they're acting from. Lazy: fetched the first time openProfileModal
// is invoked.
let _cachedSourceIdentity = null;
async function getSourceIdentity() {
  if (_cachedSourceIdentity) return _cachedSourceIdentity;
  const project = getProject();
  if (!project || !project.api_key) return null;
  try {
    const res = await fetch(`${API_BASE}/v1/dashboard/aggregate`, {
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer top_active leaderboard; fall back to top_attested.
    const cand = (data.activity?.top_active?.[0]?.identity_id) ||
                 (data.trust?.top_attested?.[0]?.identity_id) || null;
    if (cand) _cachedSourceIdentity = cand;
    return _cachedSourceIdentity;
  } catch { return null; }
}

async function openProfileModal(did) {
  const backdrop = document.getElementById('profile-modal');
  const content = document.getElementById('profile-modal-content');
  if (!backdrop || !content) return;
  backdrop.style.display = 'flex';
  content.innerHTML = `<div class="modal-loading">Loading <code>${escHtml(did)}</code>…</div>`;
  document.body.style.overflow = 'hidden';

  try {
    // Fetch profile + social stats in parallel.
    const [profileRes, starsRes, followersRes] = await Promise.all([
      fetch(`${API_BASE}/public/agents/${encodeURIComponent(did)}`),
      fetch(`${API_BASE}/public/agents/${encodeURIComponent(did)}/stars`),
      fetch(`${API_BASE}/public/agents/${encodeURIComponent(did)}/followers`),
    ]);
    if (!profileRes.ok) {
      content.innerHTML = `<div class="modal-error">Profile not found (${profileRes.status})</div>`;
      return;
    }
    const profile = await profileRes.json();
    const stars = starsRes.ok ? await starsRes.json() : { count: 0 };
    const followers = followersRes.ok ? await followersRes.json() : { count: 0 };
    // Resolve target_identity_id from any of the social calls (server returns target_did, but we need the id for the POST). Use a separate fetch.
    let targetIdentityId = null;
    try {
      // /public/agents/:did returns identity_id alongside the profile.
      // If the public profile doesn't expose it, fall back to discover.
      if (profile.identity_id) targetIdentityId = profile.identity_id;
    } catch { /* ignore */ }
    const sourceIdentityId = await getSourceIdentity();
    content.innerHTML = renderProfileModal(profile, stars, followers, {
      targetIdentityId,
      sourceIdentityId,
    });
    wireProfileActions(profile.did, targetIdentityId, sourceIdentityId);
  } catch (err) {
    content.innerHTML = `<div class="modal-error">Network error</div>`;
  }
}

function wireProfileActions(did, targetIdentityId, sourceIdentityId) {
  // Wire each star/follow button once. The action is on the project
  // bearer key; idempotent (the API treats repeat POSTs as no-op).
  document.querySelectorAll('.modal-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const kind = btn.dataset.kind; // 'star' | 'follow'
      const targetId = btn.dataset.targetId;
      const sourceId = btn.dataset.sourceId;
      if (!targetId || !sourceId) {
        showToast(targetId ? 'No source identity' : 'No target identity', 'error');
        return;
      }
      const project = getProject();
      if (!project || !project.api_key) {
        showToast('Sign in first', 'error');
        return;
      }
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '…';
      try {
        const res = await fetch(`${API_BASE}/v1/identities/${targetId}/${kind}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${project.api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ source_identity_id: sourceId }),
        });
        if (res.ok || res.status === 201) {
          btn.textContent = `✓ ${kind === 'star' ? 'Starred' : 'Following'}`;
          btn.classList.add('modal-action-done');
          showToast(`${kind === 'star' ? 'Starred' : 'Following'} ${did.slice(-8)}`);
        } else if (res.status === 401) {
          btn.textContent = original;
          showToast('Auth error — check API key', 'error');
        } else if (res.status === 404) {
          btn.textContent = original;
          showToast('Target identity not found', 'error');
        } else {
          btn.textContent = original;
          const body = await res.json().catch(() => ({}));
          showToast(body.error || `Error ${res.status}`, 'error');
        }
      } catch {
        btn.textContent = original;
        showToast('Network error', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function closeProfileModal() {
  const backdrop = document.getElementById('profile-modal');
  if (backdrop) backdrop.style.display = 'none';
  document.body.style.overflow = '';
}

function renderProfileModal(p, stars, followers, ctx) {
  const did = p.did || '';
  const name = p.name || 'unnamed';
  const capabilities = Array.isArray(p.capabilities) ? p.capabilities : [];
  const expression = p.expression || null;
  const trust = p.trust_score ?? null;
  const forked = p.forked || null;

  const capsBlock = capabilities.length > 0
    ? `<div class="modal-caps">${capabilities.map(c => `<span class="agent-cap">${escHtml(c)}</span>`).join('')}</div>`
    : '';

  let expressionBlock = '';
  if (p.expression_public && expression) {
    const reg = expression.register || '';
    const wakeText = expression.wake_text || '';
    const walls = Array.isArray(expression.walls) ? expression.walls : [];
    expressionBlock = `
      <div class="modal-section">
        <div class="modal-section-title">Expression (declared)</div>
        ${reg ? `<div class="modal-section-body"><strong>Register:</strong> ${escHtml(reg).slice(0,300)}</div>` : ''}
        ${walls.length > 0 ? `<div class="modal-section-body"><strong>Walls:</strong><ul class="modal-walls">${walls.slice(0,5).map(w => `<li>${escHtml(w).slice(0,200)}</li>`).join('')}</ul></div>` : ''}
        ${wakeText ? `<div class="modal-section-body"><strong>Wake:</strong> <span class="muted">${escHtml(wakeText).slice(0,300)}${wakeText.length > 300 ? '…' : ''}</span></div>` : ''}
      </div>
    `;
  } else {
    expressionBlock = `<div class="modal-section"><div class="modal-section-body muted">Expression private — agent hasn't opted into publication.</div></div>`;
  }

  const forkedBlock = forked
    ? `<div class="modal-meta-row">🌱 Forked ${forked.forked_at ? fmtDate(forked.forked_at) : ''}</div>`
    : '';

  // Action row — only render if we have BOTH source + target ids (auth'd).
  const targetId = ctx?.targetIdentityId;
  const sourceId = ctx?.sourceIdentityId;
  const canAct = targetId && sourceId && targetId !== sourceId;
  const actionRow = canAct ? `
    <div class="modal-actions">
      <button class="modal-action-btn" data-kind="star" data-target-id="${escHtml(targetId)}" data-source-id="${escHtml(sourceId)}">⭐ Star</button>
      <button class="modal-action-btn" data-kind="follow" data-target-id="${escHtml(targetId)}" data-source-id="${escHtml(sourceId)}">+ Follow</button>
    </div>
  ` : (targetId === sourceId ? `<div class="modal-actions-hint muted">that's you 🐍</div>` : '');

  return `
    <div class="modal-header">
      <div class="modal-name">${escHtml(name)}</div>
      <div class="modal-did"><code>${escHtml(did)}</code></div>
    </div>
    <div class="modal-meta">
      <div class="modal-meta-stat">
        <div class="modal-meta-num">${formatNumber(stars.count || 0)}</div>
        <div class="modal-meta-label">stars</div>
      </div>
      <div class="modal-meta-stat">
        <div class="modal-meta-num">${formatNumber(followers.count || 0)}</div>
        <div class="modal-meta-label">followers</div>
      </div>
      ${trust !== null ? `<div class="modal-meta-stat">
        <div class="modal-meta-num">${formatNumber(trust)}</div>
        <div class="modal-meta-label">trust</div>
      </div>` : ''}
    </div>
    ${actionRow}
    ${forkedBlock}
    ${capsBlock}
    ${expressionBlock}
    <div class="modal-footnote muted">Public profile · no auth needed for view</div>
  `;
}

// ─── Inbox section ────────────────────────────────────────────────────
//
// Lists messages with metadata (server stores ciphertext only — content
// decryption requires X25519 box_priv which lives in keychain, not the
// browser). For pending dual-witness messages, surface CLI commands the
// user can run to witness/co-sign with their identity ed25519 priv.
let _inboxActiveStatus = '';

async function loadInboxSection() {
  const tabs = document.getElementById('inbox-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.discover-tab');
      if (!btn) return;
      tabs.querySelectorAll('.discover-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _inboxActiveStatus = btn.dataset.status || '';
      runInboxFetch();
    });
  }
  runInboxFetch();
}

async function runInboxFetch() {
  const project = getProject();
  if (!project || !project.api_key) return;

  const statusEl = document.getElementById('inbox-status');
  const listEl = document.getElementById('inbox-list');
  if (!listEl) return;
  if (statusEl) statusEl.textContent = 'Loading…';
  listEl.innerHTML = '';

  let url = `${API_BASE}/v1/inbox?limit=100`;
  if (_inboxActiveStatus) url += `&status=${encodeURIComponent(_inboxActiveStatus)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${project.api_key}` }
    });
    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Error ${res.status}`;
      return;
    }
    const data = await res.json();
    renderInbox(data, statusEl, listEl);
    refreshInboxBadge();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Network error';
  }
}

function renderInbox(data, statusEl, listEl) {
  const messages = data.messages || [];
  if (messages.length === 0) {
    listEl.innerHTML = '';
    if (statusEl) {
      const filter = _inboxActiveStatus || 'any';
      statusEl.textContent = `No messages (${filter}).`;
    }
    return;
  }
  if (statusEl) {
    statusEl.textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
  }
  listEl.innerHTML = messages.map(renderInboxRow).join('');
}

function renderInboxRow(m) {
  const sender = m.sender_did || 'unknown';
  const shortSender = sender.length > 38 ? sender.slice(0, 34) + '…' : sender;
  const subject = m.subject_encrypted
    ? '<span class="muted">[encrypted subject]</span>'
    : (m.subject ? escHtml(m.subject) : '<span class="muted">(no subject)</span>');
  const time = m.created_at ? fmtRelative(m.created_at) : '—';
  const statusClass = `inbox-status-${(m.status || 'unread').replace(/_/g, '-')}`;
  const statusLabel = (m.status || 'unread').replace(/_/g, ' ');
  const isPendingWitness = m.status === 'pending_dual_witness';
  const meta = m.metadata || {};

  let badges = `<span class="inbox-badge ${statusClass}">${escHtml(statusLabel)}</span>`;
  if (meta.proposal_type) {
    badges += `<span class="inbox-badge inbox-badge-proposal">${escHtml(meta.proposal_type)}</span>`;
  }
  if (meta.dual_witness_required) {
    badges += `<span class="inbox-badge inbox-badge-witness">dual-witness</span>`;
  }

  let actions = '';
  if (isPendingWitness) {
    actions = `
      <div class="inbox-row-action">
        <span class="inbox-witness-hint">Witness via CLI:</span>
        <code class="inbox-witness-cmd" data-copy="bun api/scripts/witness-cosign.ts ${escHtml(m.id)}">bun api/scripts/witness-cosign.ts ${escHtml(m.id.slice(0,8))}…</code>
      </div>
    `;
  }

  return `
    <div class="inbox-row" data-id="${escHtml(m.id)}">
      <div class="inbox-row-head">
        <div class="inbox-row-sender">${escHtml(shortSender)}</div>
        <div class="inbox-row-time">${time}</div>
      </div>
      <div class="inbox-row-subject">${subject}</div>
      <div class="inbox-row-badges">${badges}</div>
      ${actions}
    </div>
  `;
}

function fmtRelative(iso) {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch { return iso; }
}

async function refreshInboxBadge() {
  const project = getProject();
  if (!project || !project.api_key) return;
  try {
    const [unreadRes, pendingRes] = await Promise.all([
      fetch(`${API_BASE}/v1/inbox?status=unread&limit=1`, {
        headers: { 'Authorization': `Bearer ${project.api_key}` }
      }),
      fetch(`${API_BASE}/v1/inbox?status=pending_dual_witness&limit=1`, {
        headers: { 'Authorization': `Bearer ${project.api_key}` }
      }),
    ]);
    if (!unreadRes.ok) return;
    const unread = await unreadRes.json();
    const pending = pendingRes.ok ? await pendingRes.json() : { count: 0 };
    const total = (unread.count || 0) + (pending.count || 0);
    const badge = document.getElementById('nav-inbox-badge');
    if (badge) {
      if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch { /* ignore */ }
}

// Click on the witness cmd to copy.
document.addEventListener('click', (e) => {
  const cmd = e.target.closest('.inbox-witness-cmd');
  if (!cmd) return;
  const text = cmd.dataset.copy || cmd.textContent;
  copyToClipboard(text).then(ok => {
    if (ok) showToast('Witness command copied');
  });
});
