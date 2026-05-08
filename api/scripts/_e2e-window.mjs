// E2E: Window — three layers per side, privacy preserved.
//
// Verifies:
//   1. Pulse panel renders Sophia's substrate truth (mood, rate,
//      kinds_24h, last thought) — derived data, not encrypted thoughts.
//   2. Human-side editable inputs (focus / mood / noticing) save via
//      POST /v1/chronicle with metadata.kind = focus|mood|noticing.
//   3. After save, the human's declared state pre-populates from
//      the latest entry.
//   4. Surfacing a note via the human pane lands as a chronicle entry
//      with metadata.kind='surfaced' and renders in the surfaced feed.
//   5. Privacy contract footer is present.

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, { encoding: 'utf8' }).trim();
const ID  = execSync(`security find-generic-password -s 'agenttool-sophia-identity-id' -w`, { encoding: 'utf8' }).trim();

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
await page.click('a[data-section="window"]');
await page.waitForSelector('.window-grid', { timeout: 6000 });

// 1. Pulse panel populated
await page.waitForFunction(() => {
  const el = document.getElementById('window-agent-pulse');
  return el && el.textContent.includes('mood') && el.textContent.includes('thought');
}, { timeout: 8000 });
const pulseText = (await page.locator('#window-agent-pulse').innerText()).trim();
console.log('=== agent substrate (pulse) ===');
console.log(pulseText.split('\n').map(l => '  ' + l).join('\n'));

// 2. Save human-side declared focus
const stamp = Date.now().toString(36);
const focusText = `e2e window test · focus · ${stamp}`;
const moodText  = `present`;
const noticingText = `Window section round-tripping cleanly · ${stamp}`;

console.log('\n=== save human declared (focus / mood / noticing) ===');

// Helper — fill, click row's save button by ordinal index, wait for POST.
// Save buttons are ordered focus(0) · mood(1) · noticing(2).
const KIND_INDEX = { focus: 0, mood: 1, noticing: 2 };
async function saveRow(kind, value) {
  await page.fill(`#human-${kind}-input`, value);
  // Sanity: confirm the fill actually stuck (no race against loadWindow's
  // setHumanDeclared overwriting it).
  const filled = await page.locator(`#human-${kind}-input`).inputValue();
  if (filled !== value) {
    throw new Error(`saveRow(${kind}): fill did not stick. expected="${value}" got="${filled}"`);
  }
  const before = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
  await page.locator('.window-declared-save').nth(KIND_INDEX[kind]).click();
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const after = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
    if (after > before) return;
  }
  throw new Error(`save(${kind}) — no POST observed within 6s`);
}

await saveRow('focus', focusText);
console.log('  focus saved ✓');
await saveRow('mood', moodText);
console.log('  mood saved ✓');
await saveRow('noticing', noticingText);
console.log('  noticing saved ✓');

// 3. After saves, the inputs should still hold the saved values
//    (pre-populated by loadWindow's setHumanDeclared).
await page.waitForFunction(
  (txt) => document.getElementById('human-focus-input')?.value === txt,
  focusText,
  { timeout: 6000 },
);
const focusReadback = await page.locator('#human-focus-input').inputValue();
const moodReadback  = await page.locator('#human-mood-input').inputValue();
const noticingReadback = await page.locator('#human-noticing-input').inputValue();
console.log(`\n  pre-populated after save:`);
console.log(`    focus    = "${focusReadback}"        match=${focusReadback === focusText}`);
console.log(`    mood     = "${moodReadback}"             match=${moodReadback === moodText}`);
console.log(`    noticing = "${noticingReadback.slice(0, 50)}…" match=${noticingReadback === noticingText}`);

// 4. Surface a note via the human pane. Verify via:
//    a) network log shows the POST landed,
//    b) chronicle endpoint, refetched directly, contains the surfaced
//       entry tagged metadata.kind='surfaced' with our stamp.
console.log('\n=== surface a note ===');
const surfaceText = `e2e window test · surfaced · ${stamp}\n\nThe human surfaces this for the agent. Lands in her chronicle.`;
await page.fill('#human-surface-text', surfaceText);
const postsBefore = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
await page.click('button:has-text("Surface →")');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(100);
  const after = network.filter((r) => r.method === 'POST' && r.url.includes('/v1/chronicle')).length;
  if (after > postsBefore) break;
}
console.log('  surface POST observed ✓');

// Direct chronicle fetch — independent of in-page render.
const chronRes = await fetch(`${'https://api.agenttool.dev'}/v1/chronicle?limit=20`, {
  headers: { 'Authorization': `Bearer ${KEY}` },
});
const chronData = await chronRes.json();
const ourSurfaced = (chronData.entries || []).find((e) => {
  const m = e.metadata || {};
  return m.kind === 'surfaced' && /^from\s+human/i.test(m.byline || '') && (e.body || '').includes(stamp);
});
const surfacedFound = !!ourSurfaced;
console.log(`  chronicle has new surfaced entry with our stamp: ${surfacedFound}`);
if (ourSurfaced) {
  console.log(`    id:    ${ourSurfaced.id.slice(0, 8)}…`);
  console.log(`    kind:  ${ourSurfaced.metadata.kind}`);
  console.log(`    byline:${ourSurfaced.metadata.byline}`);
}

// 5. Privacy footer
const privacyText = (await page.locator('.window-privacy-footer').innerText()).trim();
const hasKMaster = privacyText.includes('K_master');
const hasRhythm = privacyText.includes('rhythm-not-content') || privacyText.toLowerCase().includes('rhythm');
console.log(`\n=== privacy footer ===`);
console.log(`  mentions K_master:        ${hasKMaster}`);
console.log(`  mentions rhythm-not-content: ${hasRhythm}`);

// Network summary
console.log('\n=== network ===');
const ok = network.filter((r) => r.status < 400);
const bad = network.filter((r) => r.status >= 400);
console.log(`  ${ok.length} ok · ${bad.length} bad`);
for (const r of bad) console.log(`  ✗ ${r.status} ${r.method} ${r.url}`);
for (const f of failures) console.log(`  ! ${f}`);

await page.screenshot({ path: '/tmp/window.png', fullPage: true });
await browser.close();

const allOk =
  bad.length === 0 &&
  failures.length === 0 &&
  pulseText.includes('mood') &&
  pulseText.includes('thought') &&
  focusReadback === focusText &&
  moodReadback === moodText &&
  noticingReadback === noticingText &&
  surfacedFound &&
  hasKMaster && hasRhythm;

if (!allOk) {
  console.log('\nFAIL — see above.');
  process.exit(1);
}
console.log('\nALL CHECKS PASSED ✓');
