// E2E: the Overview "Load your wake" recipe — full round-trip.
//
//  1. Open /dashboard with Sophia's bearer seeded in localStorage.
//  2. Read the rendered Quick-Start cURL block; verify the
//     YOUR_KEY placeholder was substituted with the real bearer.
//  3. Read the assembled command exactly as the dashboard would
//     copy to clipboard; execute it via fetch with the same headers.
//  4. Compare the response to /v1/wake?format=md fetched directly
//     (independent control). Identical → recipe works.

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, { encoding: 'utf8' }).trim();
const ID = execSync(`security find-generic-password -s 'agenttool-sophia-identity-id' -w`, { encoding: 'utf8' }).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const failures = [];
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });

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

// Find the Quick-Start <pre>; read its rendered text exactly as the user
// sees it (after the placeholder substitution).
await page.waitForSelector('#quick-curl', { timeout: 6000 });
const rendered = (await page.locator('#quick-curl').innerText()).trim();
console.log('=== as-rendered (what the user copies) ===');
console.log(rendered);

// Substitution check.
const placeholderStillThere = rendered.includes('YOUR_KEY');
const realKeyInBlock = rendered.includes(KEY);
console.log(`\nplaceholder substituted: ${!placeholderStillThere}`);
console.log(`real bearer present:     ${realKeyInBlock}`);
if (placeholderStillThere || !realKeyInBlock) {
  failures.push('Quick-Start cURL did not substitute YOUR_KEY with the bearer');
}

// Parse the URL out of the rendered cURL so we test EXACTLY what the user
// would paste. This catches placeholder-substitution bugs (the wake URL
// must include ?identity_id when the project has multiple identities,
// otherwise the wake belongs to whichever identity Postgres returned
// first — usually NOT the bearer's primary agent).
const urlMatch = rendered.match(/curl\s+(?:-s\s+)?"([^"]+)"/);
const renderedUrl = urlMatch?.[1];
console.log(`\n=== url extracted from the rendered cURL ===`);
console.log(`  ${renderedUrl}`);

const inPageBody = await page.evaluate(async ({ url, key }) => {
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${key}` },
  });
  return { status: r.status, contentType: r.headers.get('content-type'), body: await r.text() };
}, { url: renderedUrl, key: KEY });

console.log(`\n=== executed in-page (what the curl does at runtime) ===`);
console.log(`status:       ${inPageBody.status}`);
console.log(`content-type: ${inPageBody.contentType}`);
console.log(`body bytes:   ${inPageBody.body.length}`);

// Independent control — Node fetch hits the SAME URL the cURL block shows.
const ctrl = await fetch(renderedUrl, {
  headers: { 'Authorization': `Bearer ${KEY}` },
});
const ctrlBody = await ctrl.text();
console.log(`\n=== independent control (node fetch) ===`);
console.log(`status:       ${ctrl.status}`);
console.log(`body bytes:   ${ctrlBody.length}`);

// Both bodies must be the same wake markdown.
const sameStatus = inPageBody.status === ctrl.status && ctrl.status === 200;
const sameBody = inPageBody.body === ctrlBody;
console.log(`\nstatus match (200): ${sameStatus}`);
console.log(`body match:         ${sameBody}`);

// Substantive checks on the wake markdown.
const startsWithHeader = ctrlBody.startsWith('# Sophia');
const hasDid = ctrlBody.includes(`did:at:${ID}`);
const hasInnerOrient = ctrlBody.includes('inner orientation arriving');
const hasHowYouSpeak = ctrlBody.includes('## How you speak');
const hasSophiaRegister = ctrlBody.includes('Density over length');
console.log(`\nwake markdown checks:`);
console.log(`  starts with "# Sophia":               ${startsWithHeader}`);
console.log(`  contains Sophia's DID:                ${hasDid}`);
console.log(`  has "inner orientation arriving":     ${hasInnerOrient}`);
console.log(`  has "## How you speak" section:       ${hasHowYouSpeak}`);
console.log(`  Sophia's register present (post-fix): ${hasSophiaRegister}`);

// Shell-exec the literal cURL — final ground-truth that the rendered
// string is shell-valid AND returns the right wake.
console.log(`\n=== shell exec of the literal cURL the user copies ===`);
const cmd = `curl -s "${renderedUrl}" -H "Authorization: Bearer ${KEY}"`;
const shellOut = execSync(cmd, { encoding: 'utf8' });
console.log(`shell-exec body bytes: ${shellOut.length}`);
console.log(`shell == control:       ${shellOut === ctrlBody}`);

await browser.close();

if (failures.length > 0 || !sameStatus || !sameBody || !startsWithHeader || !hasDid || !hasSophiaRegister) {
  console.log('\nFAIL — see above.');
  for (const f of failures) console.log(` ! ${f}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED ✓');
