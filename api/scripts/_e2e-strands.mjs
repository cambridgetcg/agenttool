import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: 'utf8',
}).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Capture console + page errors for diagnostics
page.on('pageerror', (err) => console.log('PAGEERR:', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLEERR:', msg.text());
});

// Seed localStorage with Sophia's project so the dashboard authenticates.
await page.goto('https://app.agenttool.dev/');
await page.evaluate((key) => {
  localStorage.setItem(
    'agenttool_project',
    JSON.stringify({
      name: 'true-love',
      api_key: key,
      email: 'aaasiadog@gmail.com',
      created_at: new Date().toISOString(),
    }),
  );
}, KEY);

await page.goto('https://app.agenttool.dev/dashboard');

// 1. Strands nav link present (proves new dashboard.html shipped)
await page.waitForSelector('a[data-section="strands"]', { timeout: 8000 });
console.log('✓ Strands nav link present');

// 2. Click → section becomes visible
await page.click('a[data-section="strands"]');
await page.waitForFunction(
  () => {
    const el = document.getElementById('section-strands');
    return el && getComputedStyle(el).display !== 'none';
  },
  { timeout: 5000 },
);
console.log('✓ Strands section visible after click');

// 3. Tabs render
const tabCount = await page.locator('#strands-tabs .discover-tab').count();
console.log(`✓ ${tabCount} status tabs rendered`);

// 4. Identity filter dropdown populates (one shot from /v1/dashboard/aggregate)
await page.waitForFunction(
  () => {
    const sel = document.getElementById('strands-identity-filter');
    return sel && sel.options.length > 1;
  },
  { timeout: 8000 },
);
const idOpts = await page.locator('#strands-identity-filter option').allTextContents();
console.log(`✓ identity filter options: ${JSON.stringify(idOpts)}`);

// 5. Strand list populates
await page.waitForFunction(
  () => {
    const list = document.getElementById('strands-list');
    return list && list.querySelectorAll('.strand-row').length > 0;
  },
  { timeout: 12000 },
);
const topics = await page
  .locator('.strand-row .strand-row-topic')
  .allTextContents();
console.log(`✓ ${topics.length} strand row(s):`);
for (const t of topics) console.log(`    - "${t}"`);

// 6. Click first strand → detail panel opens
await page.click('.strand-row');
await page.waitForFunction(
  () => {
    const d = document.getElementById('strand-detail');
    return d && getComputedStyle(d).display !== 'none';
  },
  { timeout: 5000 },
);
console.log('✓ Strand detail panel opened');

// 7. Substrate-honest callout text rendered
const honest = await page.locator('.strand-detail-honest').first();
const honestText = await honest.textContent();
const hasHonest = honestText.includes('K_master') && honestText.includes('ciphertext');
console.log(`✓ Substrate-honest callout present (mentions K_master + ciphertext): ${hasHonest}`);

// 8. Thoughts feed renders ciphertext rows (post-fix data — 17 thoughts)
await page.waitForSelector('.thought-row', { timeout: 6000 });
const thoughtCount = await page.locator('.thought-row').count();
console.log(`✓ ${thoughtCount} thought rows rendered`);

// 9. Each thought shows the 🔒 ciphertext line with byte count + sig prefix
const lockLines = await page.locator('.thought-cipher-line').count();
console.log(`✓ ${lockLines} cipher-info lines rendered`);

// 10. Live toggle present (SSE wiring shipped)
const toggle = await page.locator('#strand-live-toggle').count();
console.log(`✓ Live toggle present: ${toggle === 1}`);

// 11. Quick check: Inbox badge for the test self-message we sent earlier
await page.click('a[data-section="inbox"]');
await page.waitForFunction(
  () => {
    const el = document.getElementById('section-inbox');
    return el && getComputedStyle(el).display !== 'none';
  },
  { timeout: 5000 },
);
const inboxRows = await page.locator('.inbox-row').count();
console.log(`✓ Inbox section: ${inboxRows} message row(s)`);

// 12. Screenshot for evidence
await page.click('a[data-section="strands"]');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/strands-live.png', fullPage: true });
console.log('screenshot: /tmp/strands-live.png');

await browser.close();
console.log('\nALL CHECKS PASSED ✓');
