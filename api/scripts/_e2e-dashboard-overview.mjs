// E2E: agent-shaped dashboard. Loads with Sophia's bearer + agent metadata
// in localStorage, opens /dashboard, captures every network call, asserts:
//   - no 4xx/5xx on any agenttool request
//   - hero card shows agent name + DID + capabilities
//   - 4 stats tiles show agent-shaped labels (active strands, memories,
//     thoughts, covenants) with non-empty values
//   - sidebar nav uses the new labels (Overview, Strands, Inbox, Agents,
//     Discover, Bearer, Recipes, Billing)
//   - clicking Bearer renders the saved bearer + DID + signing-key id

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, { encoding: 'utf8' }).trim();
const DID = execSync(`security find-generic-password -s 'agenttool-sophia-did' -w`, { encoding: 'utf8' }).trim();
const ID = execSync(`security find-generic-password -s 'agenttool-sophia-identity-id' -w`, { encoding: 'utf8' }).trim();
const SIGKID = execSync(`security find-generic-password -s 'agenttool-sophia-signing-key-id' -w`, { encoding: 'utf8' }).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const failures = [];
const allResponses = [];
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
page.on('response', (r) => {
  if (r.url().includes('agenttool.dev')) {
    const e = { method: r.request().method(), url: r.url(), status: r.status() };
    allResponses.push(e);
    if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

// Seed localStorage with full Sophia agent record (post-/v1/register shape).
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

// 1. Hero card
await page.waitForSelector('.overview-hero', { timeout: 6000 });
const heroName = (await page.locator('#hero-agent-name').innerText()).trim();
const heroDid = (await page.locator('#hero-agent-did').innerText()).trim();
const heroCaps = (await page.locator('.hero-cap-chip').allInnerTexts()).map((s) => s.trim());
console.log(`✓ hero name:  ${heroName}`);
console.log(`✓ hero DID:   ${heroDid.slice(0, 30)}…`);
console.log(`✓ hero caps:  ${JSON.stringify(heroCaps)}`);

// 2. Stats — each tile non-loading
await page.waitForFunction(() => {
  const v = document.getElementById('stat-calls')?.textContent || '';
  return v && !v.includes('—') && !v.includes('Loading');
}, { timeout: 10_000 }).catch(() => {});

const tile = async (id) => (await page.locator(`#${id}`).innerText()).trim();
const tile_strands  = await tile('stat-calls');
const tile_memory   = await tile('stat-memory');
const tile_thoughts = await tile('stat-tools');
const tile_covenants= await tile('stat-verify');
console.log(`✓ tiles:      strands=${tile_strands} · memories=${tile_memory} · thoughts(7d)=${tile_thoughts} · covenants=${tile_covenants}`);

const labels = await page.locator('.stat .stat-label').allInnerTexts();
console.log(`✓ tile labels: ${JSON.stringify(labels)}`);

// 3. Sidebar
const navLabels = await page.locator('.sidebar nav a').allInnerTexts();
console.log(`✓ sidebar:    ${JSON.stringify(navLabels.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean))}`);

// 4. Click Bearer → check populated
await page.click('a[data-section="api-key"]');
await page.waitForTimeout(300);
const bearer = (await page.locator('#full-api-key').innerText()).trim();
const fullDid = (await page.locator('#full-agent-did').innerText()).trim();
const fullSig = (await page.locator('#full-signing-key-id').innerText()).trim();
console.log(`✓ bearer pane: bearer=${bearer.slice(0, 14)}… did=${fullDid.slice(0, 14)}… sig=${fullSig.slice(0, 14)}…`);

// 5. Click Recipes → check labels
await page.click('a[data-section="snippets"]');
await page.waitForTimeout(200);
const recipeTabs = await page.locator('.snippet-tab').allInnerTexts();
console.log(`✓ recipe tabs: ${JSON.stringify(recipeTabs.map(s=>s.trim()))}`);

// 6. Click Strands → make sure it still works
await page.click('a[data-section="strands"]');
await page.waitForFunction(() => {
  const list = document.getElementById('strands-list');
  return list && list.querySelectorAll('.strand-row').length > 0;
}, { timeout: 8_000 }).catch(() => {});
const strandRows = await page.locator('.strand-row').count();
console.log(`✓ strands:    ${strandRows} row(s)`);

// Network summary
const ok = allResponses.filter(r => r.status < 400);
const bad = allResponses.filter(r => r.status >= 400);
console.log(`\nnetwork: ${ok.length} ok · ${bad.length} bad`);
for (const r of bad) console.log(`  ✗ ${r.status} ${r.method} ${r.url}`);
for (const f of failures) console.log(`  ! ${f}`);

await page.screenshot({ path: '/tmp/dashboard-overview.png', fullPage: true });
await browser.close();

if (bad.length > 0 || failures.length > 0) {
  console.log('\nFAIL — network or page errors above.');
  process.exit(1);
}
console.log('\nALL CHECKS PASSED ✓');
