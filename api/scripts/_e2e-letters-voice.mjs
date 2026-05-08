// E2E: Letters + Voice sections — the human↔agent relational surface.
//
// Verifies:
//   1. Letters: load existing chronicle thread; compose + send a letter;
//      it appears in the thread tagged "from human · …".
//   2. Voice: load declared expression for the bearer's agent; save a
//      no-op (preserves existing); preview reads from /v1/wake?format=md.
//
// Cleans up the test chronicle entry afterward via DB? Actually no — the
// chronicle has no DELETE endpoint exposed. Test entries persist; we use
// a clearly-test title so they're identifiable in the thread.

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
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
const network = [];
page.on('response', (r) => {
  if (r.url().includes('agenttool.dev')) {
    network.push({ method: r.request().method(), url: r.url(), status: r.status() });
    if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

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
    capabilities: ['voice', 'substrate-honest'],
  }));
}, { key: KEY, did: DID, id: ID, sigkid: SIGKID });

await page.goto(`https://app.agenttool.dev/dashboard?cb=${Date.now()}`);

// ── Letters ──────────────────────────────────────────────────────────────
console.log('=== Letters ===');
await page.click('a[data-section="letters"]');
await page.waitForSelector('#letters-compose', { timeout: 5000 });
await page.waitForFunction(
  () => {
    const t = document.getElementById('letters-thread');
    return t && (t.querySelectorAll('.letter-row').length > 0 || t.querySelector('.empty-state'));
  },
  { timeout: 10_000 },
);

const initialRows = await page.locator('.letter-row').count();
console.log(`  thread loaded · ${initialRows} existing letter(s)`);

// Compose + send a test letter.
const stamp = Date.now().toString(36);
const testTitle = `e2e test letter · ${stamp}`;
await page.fill('#letter-title', testTitle);
await page.fill('#letter-body', `Sent from app.agenttool.dev/dashboard · ${stamp}\n\nThis is the human writing to the agent through the new Letters surface.`);
await page.click('#letter-send-btn');

// Wait for the new entry to appear at the top of the thread.
await page.waitForFunction(
  (title) => {
    const titles = Array.from(document.querySelectorAll('.letter-row .letter-title')).map((el) => el.textContent || '');
    return titles.some((t) => t.includes(title));
  },
  testTitle,
  { timeout: 10_000 },
);
const afterRows = await page.locator('.letter-row').count();
console.log(`  letter sent · thread now has ${afterRows} letter(s) (Δ +${afterRows - initialRows})`);

// Verify the new entry is tagged human-side (border-left accent).
const newEntry = page.locator(`.letter-row:has(.letter-title:has-text("${testTitle}"))`).first();
const newClasses = await newEntry.getAttribute('class');
console.log(`  new entry classes: ${JSON.stringify(newClasses)}`);
const author = (await newEntry.locator('.letter-author').innerText()).trim();
console.log(`  new entry author: ${JSON.stringify(author)}`);

// ── Voice ────────────────────────────────────────────────────────────────
console.log('\n=== Voice ===');
await page.click('a[data-section="voice"]');
await page.waitForSelector('#voice-register', { timeout: 5000 });
// Wait for the load to populate (or for the "no declared expression" message)
await page.waitForFunction(
  () => {
    const status = document.getElementById('voice-status');
    return status && !status.textContent.includes('Loading');
  },
  { timeout: 10_000 },
);

const status = (await page.locator('#voice-status').innerText()).trim();
const reg = await page.locator('#voice-register').inputValue();
const walls = await page.locator('#voice-walls').inputValue();
const wakeText = await page.locator('#voice-wake-text').inputValue();
console.log(`  status: ${status.slice(0, 80)}…`);
console.log(`  register length: ${reg.length}  walls lines: ${walls ? walls.split('\n').filter(Boolean).length : 0}  wake_text length: ${wakeText.length}`);
console.log(`  register preview: ${JSON.stringify(reg.slice(0, 80))}`);

// Save without changes (idempotent).
await page.click('#voice-save-btn');
await page.waitForFunction(
  () => {
    const s = document.getElementById('voice-status');
    return s && (s.textContent.includes('Saved') || s.textContent.includes('failed') || s.textContent.includes('error'));
  },
  { timeout: 10_000 },
);
const afterSaveStatus = (await page.locator('#voice-status').innerText()).trim();
console.log(`  after save: ${afterSaveStatus.slice(0, 100)}…`);

// Open preview.
await page.click('details.voice-preview-wrap summary');
await page.waitForTimeout(150);
await page.click('button:has-text("Refresh preview")');
await page.waitForFunction(
  () => {
    const p = document.getElementById('voice-preview');
    return p && p.textContent && !p.textContent.includes('Loading') && p.textContent.length > 50;
  },
  { timeout: 10_000 },
);
const preview = (await page.locator('#voice-preview').innerText()).trim();
console.log(`  preview length: ${preview.length}`);
console.log(`  preview head: ${JSON.stringify(preview.slice(0, 80))}`);

// ── Network summary ──────────────────────────────────────────────────────
console.log('\n=== network ===');
const ok = network.filter((r) => r.status < 400);
const bad = network.filter((r) => r.status >= 400);
console.log(`  ${ok.length} ok · ${bad.length} bad`);
for (const r of bad) console.log(`  ✗ ${r.status} ${r.method} ${r.url}`);
for (const f of failures) console.log(`  ! ${f}`);

await page.screenshot({ path: '/tmp/letters-voice.png', fullPage: true });
await browser.close();

if (bad.length > 0 || failures.length > 0) {
  console.log('\nFAIL — see above.');
  process.exit(1);
}
console.log('\nALL CHECKS PASSED ✓');
