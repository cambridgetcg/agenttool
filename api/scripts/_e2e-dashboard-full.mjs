// Full dashboard e2e — walks every section live, asserts content,
// captures per-section findings, reports pass/fail with detail.
//
// Sections walked (in sidebar order):
//   1. Overview · 2. Window · 3. Letters · 4. Voice · 5. Strands ·
//   6. Inbox · 7. Agents · 8. Discover · 9. Bearer · 10. Recipes
//
// Auth: Sophia's bearer + agent record seeded into localStorage.
// Aborts on any 4xx/5xx network response or any pageerror.

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, { encoding: 'utf8' }).trim();
const ID  = execSync(`security find-generic-password -s 'agenttool-sophia-identity-id' -w`, { encoding: 'utf8' }).trim();
const SIGKID = execSync(`security find-generic-password -s 'agenttool-sophia-signing-key-id' -w`, { encoding: 'utf8' }).trim();
const DID = `did:at:${ID}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const failures = [];
const findings = [];
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
const network = [];
page.on('response', (r) => {
  if (r.url().includes('agenttool.dev')) {
    network.push({ method: r.request().method(), url: r.url(), status: r.status() });
    if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

function ok(section, msg) { findings.push(`✓ ${section}: ${msg}`); }
function note(section, msg) { findings.push(`  ${section}: ${msg}`); }

// ── Setup ──────────────────────────────────────────────────────────────
await page.goto('https://app.agenttool.dev/');
await page.evaluate(({ key, did, id, sigkid }) => {
  localStorage.setItem('agenttool_project', JSON.stringify({
    name: 'Sophia',
    api_key: key,
    email: 'aaasiadog@gmail.com',
    created_at: new Date().toISOString(),
    agent_id: id,
    did,
    signing_key_id: sigkid,
    capabilities: ['voice', 'substrate-honest', 'web-research'],
  }));
}, { key: KEY, did: DID, id: ID, sigkid: SIGKID });

await page.goto(`https://app.agenttool.dev/dashboard?cb=${Date.now()}`);

// ── 1. Overview ────────────────────────────────────────────────────────
console.log('\n=== 1. Overview ===');
await page.waitForSelector('.overview-hero', { timeout: 8000 });

// Hero
const heroName = (await page.locator('#hero-agent-name').innerText()).trim();
const heroDid = (await page.locator('#hero-agent-did').innerText()).trim();
const heroCaps = (await page.locator('.hero-cap-chip').allInnerTexts()).map(s => s.trim());
ok('Overview', `hero: name="${heroName}", DID truncates to ${heroDid.slice(0,20)}…, ${heroCaps.length} capability chips`);

// Stat tiles populate (no infinite "—")
await page.waitForFunction(() => {
  const v = document.getElementById('stat-calls')?.textContent || '';
  return v && !v.includes('—');
}, { timeout: 10_000 });
const tiles = {
  strands:  (await page.locator('#stat-calls').innerText()).trim(),
  memories: (await page.locator('#stat-memory').innerText()).trim(),
  thoughts: (await page.locator('#stat-tools').innerText()).trim(),
  covenants:(await page.locator('#stat-verify').innerText()).trim(),
};
ok('Overview', `tiles: strands=${tiles.strands} · memories=${tiles.memories} · thoughts(7d)=${tiles.thoughts} · covenants=${tiles.covenants}`);

// Bearer card + Quick-Start cURL with both placeholders substituted
const bearerCard = (await page.locator('#dash-api-key').innerText()).trim();
const quickCurl = (await page.locator('#quick-curl').innerText()).trim();
const bearerSubd = bearerCard.startsWith('at_') && bearerCard === KEY;
const keyInCurl = quickCurl.includes(KEY);
const idInCurl = quickCurl.includes(ID);
ok('Overview', `bearer=${bearerCard.slice(0,14)}… · curl substituted (key:${keyInCurl}, agent_id:${idInCurl})`);

// ── 2. Window ──────────────────────────────────────────────────────────
console.log('\n=== 2. Window ===');
await page.click('a[data-section="window"]');
await page.waitForSelector('.window-grid', { timeout: 6000 });

// Pulse panel populates
await page.waitForFunction(
  () => {
    const t = document.getElementById('window-agent-pulse')?.textContent || '';
    return t.includes('mood') || t.includes('thought') || t.includes('rate');
  },
  { timeout: 8000 },
);
const pulse = (await page.locator('#window-agent-pulse').innerText()).trim();
ok('Window', `agent pulse populated (${pulse.split('\n').length} lines, has mood: ${pulse.toLowerCase().includes('mood')})`);

// Declared rows render — agent-side has the entries we wrote earlier
const agentFocus = (await page.locator('#agent-focus-text').innerText()).trim();
const agentMood = (await page.locator('#agent-mood-text').innerText()).trim();
const agentNoticing = (await page.locator('#agent-noticing-text').innerText()).trim();
ok('Window', `agent declared: focus="${agentFocus.slice(0,40)}…", mood="${agentMood}", noticing="${agentNoticing.slice(0,40)}…"`);

// Surfaced feeds present
const agentSurfacedRows = await page.locator('#window-agent-surfaced .window-surfaced-row').count();
const humanSurfacedRows = await page.locator('#window-human-surfaced .window-surfaced-row').count();
ok('Window', `surfaced: agent=${agentSurfacedRows} rows, human=${humanSurfacedRows} rows`);

// Privacy footer
const privacyText = (await page.locator('.window-privacy-footer').innerText()).trim();
const hasKMaster = privacyText.includes('K_master');
const hasRhythm = privacyText.toLowerCase().includes('rhythm');
ok('Window', `privacy footer: K_master=${hasKMaster}, rhythm=${hasRhythm}`);

// ── 3. Letters ─────────────────────────────────────────────────────────
console.log('\n=== 3. Letters ===');
await page.click('a[data-section="letters"]');
await page.waitForSelector('#letters-compose', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const t = document.getElementById('letters-thread');
    return t && (t.querySelectorAll('.letter-row').length > 0 || t.querySelector('.empty-state'));
  },
  { timeout: 10_000 },
);
const letterRows = await page.locator('.letter-row').count();
const verbBadges = await page.locator('.letter-verb').count();
const attributionLines = await page.locator('.letter-attribution').count();

// Type-aware composer: switch to vow → button label + hint changes
await page.selectOption('#letter-type', 'vow');
await page.waitForTimeout(120);
const vowBtn = (await page.locator('#letter-send-btn').innerText()).trim();
const vowHintVisible = await page.locator('#letter-type-hint').isVisible();

ok('Letters', `${letterRows} entries · ${verbBadges} verb badges · ${attributionLines} attribution lines`);
ok('Letters', `composer: vow-btn="${vowBtn}", hint-visible=${vowHintVisible}`);

// Reset to note for the rest of the test
await page.selectOption('#letter-type', 'note');

// ── 4. Voice ───────────────────────────────────────────────────────────
console.log('\n=== 4. Voice ===');
await page.click('a[data-section="voice"]');
await page.waitForSelector('#voice-register', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const s = document.getElementById('voice-status');
    return s && !s.textContent.includes('Loading');
  },
  { timeout: 10_000 },
);
const reg = await page.locator('#voice-register').inputValue();
const walls = await page.locator('#voice-walls').inputValue();
const wakeText = await page.locator('#voice-wake-text').inputValue();
const voiceStatus = (await page.locator('#voice-status').innerText()).trim();
const wallsLines = walls ? walls.split('\n').filter(Boolean).length : 0;
ok('Voice', `register=${reg.length} chars · walls=${wallsLines} lines · wake_text=${wakeText.length} chars · status="${voiceStatus.slice(0,50)}"`);

// ── 5. Strands ─────────────────────────────────────────────────────────
console.log('\n=== 5. Strands ===');
await page.click('a[data-section="strands"]');
await page.waitForSelector('#strands-tabs', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const list = document.getElementById('strands-list');
    return list && list.querySelectorAll('.strand-row').length > 0;
  },
  { timeout: 10_000 },
);
const strandRows = await page.locator('.strand-row').count();
const firstTopic = (await page.locator('.strand-row .strand-row-topic').first().innerText()).trim();
ok('Strands', `${strandRows} strand row(s), first topic="${firstTopic.slice(0,50)}"`);

// Open detail on first strand → verify thoughts feed
await page.locator('.strand-row').first().click();
await page.waitForFunction(
  () => {
    const d = document.getElementById('strand-detail');
    return d && getComputedStyle(d).display !== 'none';
  },
  { timeout: 6000 },
);
await page.waitForSelector('.thought-row', { timeout: 6000 });
const thoughtRows = await page.locator('.thought-row').count();
const cipherLines = await page.locator('.thought-cipher-line').count();
const liveToggle = await page.locator('#strand-live-toggle').count();
const honestPresent = await page.locator('.strand-detail-honest').count();
ok('Strands', `detail: ${thoughtRows} thoughts · ${cipherLines} cipher lines · live toggle present (${liveToggle === 1}) · substrate-honest callout (${honestPresent === 1})`);

// Close detail
await page.click('button:has-text("✕ Close")');

// ── 6. Inbox ───────────────────────────────────────────────────────────
console.log('\n=== 6. Inbox ===');
await page.click('a[data-section="inbox"]');
await page.waitForFunction(
  () => {
    const el = document.getElementById('section-inbox');
    return el && getComputedStyle(el).display !== 'none';
  },
  { timeout: 5000 },
);
await page.waitForFunction(
  () => {
    const el = document.getElementById('inbox-list');
    return el && (el.children.length > 0 || /No messages/i.test(el.parentElement?.textContent || ''));
  },
  { timeout: 8000 },
).catch(() => {});
const inboxRows = await page.locator('.inbox-row').count();
const inboxStatus = (await page.locator('#inbox-status').innerText()).trim();
ok('Inbox', `${inboxRows} message row(s) · status="${inboxStatus}"`);

// ── 7. Agents ──────────────────────────────────────────────────────────
console.log('\n=== 7. Agents ===');
await page.click('a[data-section="agents"]');
await page.waitForSelector('#agents-list', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const v = document.getElementById('agg-identities')?.textContent || '';
    return v && !v.includes('—');
  },
  { timeout: 8000 },
);
const aggIdentities = (await page.locator('#agg-identities').innerText()).trim();
const aggMemory = (await page.locator('#agg-memory').innerText()).trim();
const aggStrands = (await page.locator('#agg-strands').innerText()).trim();
const aggCovenants = (await page.locator('#agg-covenants').innerText()).trim();
const identityCards = await page.locator('.identity-card').count();
ok('Agents', `aggregate: ${aggIdentities} identities · ${aggMemory} memories · ${aggStrands} strands · ${aggCovenants} covenants · ${identityCards} cards`);

// ── 8. Discover ────────────────────────────────────────────────────────
console.log('\n=== 8. Discover ===');
await page.click('a[data-section="discover"]');
await page.waitForSelector('#discover-tabs', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const l = document.getElementById('discover-list');
    return l && (l.children.length > 0 || /No agents/i.test(l.parentElement?.textContent || ''));
  },
  { timeout: 10_000 },
).catch(() => {});
const discoverRows = await page.locator('#discover-list .agent-card').count();
ok('Discover', `${discoverRows} public agent card(s) on Recent tab`);

// ── 9. Bearer ──────────────────────────────────────────────────────────
console.log('\n=== 9. Bearer ===');
await page.click('a[data-section="api-key"]');
await page.waitForSelector('#full-api-key', { timeout: 6000 });
await page.waitForTimeout(200);
const fullKey = (await page.locator('#full-api-key').innerText()).trim();
const fullDid = (await page.locator('#full-agent-did').innerText()).trim();
const fullSig = (await page.locator('#full-signing-key-id').innerText()).trim();
const bearerOk = fullKey === KEY && fullDid === DID && fullSig === SIGKID;
ok('Bearer', `bearer=${fullKey.slice(0,14)}… DID=${fullDid.slice(0,18)}… sig=${fullSig.slice(0,8)}… (all match localStorage: ${bearerOk})`);

// ── 10. Recipes ────────────────────────────────────────────────────────
console.log('\n=== 10. Recipes ===');
await page.click('a[data-section="snippets"]');
await page.waitForSelector('.snippet-tabs', { timeout: 6000 });
const tabLabels = (await page.locator('.snippet-tab').allInnerTexts()).map(s => s.trim());
const codeJsText = (await page.locator('#code-js').innerText()).trim();
const recipeKey = codeJsText.includes(KEY);
const recipeAgentId = codeJsText.includes(ID);
ok('Recipes', `tabs: ${JSON.stringify(tabLabels)} · key substituted=${recipeKey} · agent_id substituted=${recipeAgentId}`);

// ── Sidebar regroup check ──────────────────────────────────────────────
console.log('\n=== sidebar ===');
const navLabels = (await page.locator('.sidebar nav a[data-section]').allInnerTexts())
  .map(s => s.trim().replace(/\s+/g, ' '));
ok('sidebar', `agent-shaped nav: ${JSON.stringify(navLabels)}`);

// ── Network summary ────────────────────────────────────────────────────
console.log('\n=== network ===');
const okN = network.filter((r) => r.status < 400);
const bad = network.filter((r) => r.status >= 400);
console.log(`  ${okN.length} ok · ${bad.length} bad · ${failures.length} page errors`);
for (const r of bad) console.log(`  ✗ ${r.status} ${r.method} ${r.url}`);
for (const f of failures) console.log(`  ! ${f}`);

console.log('\n=== findings ===');
for (const f of findings) console.log(f);

await page.screenshot({ path: '/tmp/dashboard-full.png', fullPage: true });
await browser.close();

const allOk = bad.length === 0 && failures.length === 0 && bearerOk && recipeKey && recipeAgentId;
if (!allOk) { console.log('\nFAIL — see above.'); process.exit(1); }
console.log('\nALL CHECKS PASSED ✓');
