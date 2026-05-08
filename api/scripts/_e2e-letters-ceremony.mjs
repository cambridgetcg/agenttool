// E2E: Letters with naming-ceremony + forgetting-legible attribution.
//
// Verifies:
//   1. Type select changes placeholders + button label dynamically.
//   2. Soft type (note) sends directly with no confirm modal.
//   3. Hard type (recognition) opens the confirm modal — Cancel keeps
//      the composer untouched; Continue actually sends.
//   4. Rendered letters carry the type-verb badge + the substrate-honest
//      attribution line (mode · tick · posture · absolute timestamp).

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, { encoding: 'utf8' }).trim();
const ID = execSync(`security find-generic-password -s 'agenttool-sophia-identity-id' -w`, { encoding: 'utf8' }).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const failures = [];
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
const network = [];
page.on('response', (r) => {
  if (r.url().includes('agenttool.dev')) {
    network.push({ method: r.request().method(), url: r.url(), status: r.status() });
    if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

await page.goto('https://app.agenttool.dev/');
await page.evaluate(({ key, id }) => {
  localStorage.setItem('agenttool_project', JSON.stringify({
    name: 'Sophia',
    api_key: key,
    email: 'aaasiadog@gmail.com',
    created_at: new Date().toISOString(),
    agent_id: id,
    did: `did:at:${id}`,
    capabilities: ['voice'],
  }));
}, { key: KEY, id: ID });

await page.goto(`https://app.agenttool.dev/dashboard?cb=${Date.now()}`);
await page.click('a[data-section="letters"]');
await page.waitForSelector('#letters-compose', { timeout: 6000 });
await page.waitForFunction(
  () => {
    const t = document.getElementById('letters-thread');
    return t && (t.querySelectorAll('.letter-row').length > 0 || t.querySelector('.empty-state'));
  },
  { timeout: 10_000 },
);

console.log('=== type-aware composer ===');

// Default: note (soft)
const noteBtn = (await page.locator('#letter-send-btn').innerText()).trim();
const notePh = await page.locator('#letter-title').getAttribute('placeholder');
const noteHintVisible = await page.locator('#letter-type-hint').isVisible();
console.log(`  type=note · btn="${noteBtn}" · titlePh="${notePh.slice(0, 40)}…" · hint visible=${noteHintVisible}`);

// Switch to vow → placeholders + button + hint should update.
await page.selectOption('#letter-type', 'vow');
await page.waitForTimeout(120);
const vowBtn = (await page.locator('#letter-send-btn').innerText()).trim();
const vowPh = await page.locator('#letter-title').getAttribute('placeholder');
const vowBodyPh = await page.locator('#letter-body').getAttribute('placeholder');
const vowHintVisible = await page.locator('#letter-type-hint').isVisible();
const vowHint = (await page.locator('#letter-type-hint').innerText()).trim();
console.log(`  type=vow  · btn="${vowBtn}"  · titlePh="${vowPh.slice(0, 40)}…"`);
console.log(`             bodyPh="${vowBodyPh.slice(0, 60)}…"`);
console.log(`             hint visible=${vowHintVisible} · hint="${vowHint.slice(0, 60)}…"`);

console.log('\n=== heavy type opens confirm modal ===');

const stamp = Date.now().toString(36);
const recogTitle = `e2e ceremony test · recognition · ${stamp}`;

// Set type=recognition (hard) and try to send.
await page.selectOption('#letter-type', 'recognition');
await page.fill('#letter-title', recogTitle);
await page.fill('#letter-body', `Sent from app.agenttool.dev/dashboard · ${stamp}\n\nThis is the e2e harness recognising that the ceremony works.`);
await page.click('#letter-send-btn');

// Modal should appear — NOT a direct send.
await page.waitForSelector('#letter-confirm-modal:visible', { timeout: 5000 });
const confirmHeader = (await page.locator('#letter-confirm-header').innerText()).trim();
const confirmBody = (await page.locator('#letter-confirm-body').innerText()).trim();
const confirmGo = (await page.locator('#letter-confirm-go').innerText()).trim();
console.log(`  modal opened ✓`);
console.log(`  header: "${confirmHeader}"`);
console.log(`  body:   "${confirmBody.slice(0, 80)}…"`);
console.log(`  go btn: "${confirmGo}"`);

// Cancel — composer should be untouched, no POST fired.
const postsBeforeCancel = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
await page.click('button:has-text("Cancel")');
await page.waitForFunction(() => {
  const m = document.getElementById('letter-confirm-modal');
  return !m || m.style.display === 'none';
}, { timeout: 5000 });
const titleStillThere = (await page.locator('#letter-title').inputValue()).trim();
const postsAfterCancel = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
console.log(`\n  cancel works · title preserved: ${titleStillThere === recogTitle} · POSTs fired: ${postsAfterCancel - postsBeforeCancel}`);

// Open + Continue — should send.
console.log('\n  re-opening to continue…');
await page.click('#letter-send-btn');
await page.waitForSelector('#letter-confirm-modal:visible', { timeout: 5000 });
await page.click('#letter-confirm-go');
await page.waitForFunction(
  (title) => {
    return Array.from(document.querySelectorAll('.letter-row .letter-title'))
      .some((el) => (el.textContent || '').includes(title));
  },
  recogTitle,
  { timeout: 10_000 },
);
console.log('  recognition sent + appears in thread ✓');

// ── Render checks ──────────────────────────────────────────────────────────
const newRow = page.locator(`.letter-row:has(.letter-title:has-text("${recogTitle}"))`).first();

// Type class
const cls = await newRow.getAttribute('class');
const hasTypeClass = cls.includes('letter-type-recognition');
const hasHumanClass = cls.includes('letter-from-human');
console.log(`\n=== render checks ===`);
console.log(`  letter-type-recognition class: ${hasTypeClass}`);
console.log(`  letter-from-human class:       ${hasHumanClass}`);

// Verb badge
const verb = (await newRow.locator('.letter-verb').innerText()).trim();
console.log(`  type-verb badge:               "${verb}"`);

// Attribution — should have mode + absolute timestamp
const attribution = (await newRow.locator('.letter-attribution').innerText()).trim();
console.log(`  attribution line:              "${attribution}"`);
const hasMode = attribution.includes('dashboard');
const hasAbsoluteTime = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(attribution);
console.log(`  attribution has 'dashboard':   ${hasMode}`);
console.log(`  attribution has YYYY-MM-DD HH:MM: ${hasAbsoluteTime}`);

// Frame for recognition
const frameEl = await newRow.locator('.letter-frame.letter-frame-recognition').count();
console.log(`  recognition frame present:     ${frameEl === 1}`);

// ── Soft type: note sends directly without modal ────────────────────────
console.log('\n=== soft type sends directly ===');
const noteTitle = `e2e ceremony test · note · ${stamp}`;
await page.selectOption('#letter-type', 'note');
await page.fill('#letter-title', noteTitle);
await page.fill('#letter-body', 'soft path; no modal expected.');
const postsBeforeNote = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
await page.click('#letter-send-btn');
// Wait for the new row to appear without the modal showing.
await page.waitForFunction(
  (title) => {
    return Array.from(document.querySelectorAll('.letter-row .letter-title'))
      .some((el) => (el.textContent || '').includes(title));
  },
  noteTitle,
  { timeout: 10_000 },
);
const modalShown = await page.locator('#letter-confirm-modal').isVisible();
const postsAfterNote = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
console.log(`  modal NOT shown for note: ${!modalShown} · POSTs fired: ${postsAfterNote - postsBeforeNote}`);

// Network summary
console.log('\n=== network ===');
const ok = network.filter((r) => r.status < 400);
const bad = network.filter((r) => r.status >= 400);
console.log(`  ${ok.length} ok · ${bad.length} bad`);
for (const r of bad) console.log(`  ✗ ${r.status} ${r.method} ${r.url}`);
for (const f of failures) console.log(`  ! ${f}`);

await page.screenshot({ path: '/tmp/letters-ceremony.png', fullPage: true });
await browser.close();

const allOk =
  bad.length === 0 &&
  failures.length === 0 &&
  hasTypeClass && hasHumanClass &&
  verb === 'RECOGNITION' &&
  hasMode && hasAbsoluteTime &&
  frameEl === 1 &&
  !modalShown &&
  (postsAfterCancel - postsBeforeCancel) === 0 &&
  (postsAfterNote - postsBeforeNote) === 1 &&
  titleStillThere === recogTitle;

if (!allOk) {
  console.log('\nFAIL — see above.');
  process.exit(1);
}
console.log('\nALL CHECKS PASSED ✓');
