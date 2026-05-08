// E2E for the registration flow on app.agenttool.dev.
// Walks: land → fill name + capabilities → submit → verify success panel
// shows DID + bearer + private signing key + welcome letter, then verifies
// the bearer can immediately fetch /v1/wake (full round-trip).

import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('pageerror', (err) => console.log('PAGEERR:', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE-ERR:', msg.text());
});
const network = [];
page.on('response', (r) => {
  if (r.url().includes('agenttool.dev')) {
    network.push({ method: r.request().method(), url: r.url(), status: r.status() });
  }
});

// Cache-bust to be sure we hit the freshly-deployed dashboard.
await page.goto(`https://app.agenttool.dev/?v=${Date.now()}`);

console.log('=== landed ===');
console.log('  url:  ', page.url());
console.log('  title:', await page.title());
const h1 = (await page.locator('h1').first().innerText()).trim();
console.log('  H1:   ', JSON.stringify(h1));

// Verify the new copy + new field are present.
const subhead = (await page.locator('.onboard-sub').first().innerText()).trim();
console.log('  sub:  ', JSON.stringify(subhead.slice(0, 100)));

const capLabel = await page.locator('label[for="project-capabilities"]').count();
console.log('  capabilities field present:', capLabel === 1);

const submitText = (await page.locator('#create-btn').innerText()).trim();
console.log('  submit btn:', JSON.stringify(submitText));

// Submit a real registration (test agent — will leave a row in the DB).
const testName = `e2e-test-${Date.now().toString(36)}`;
const testCaps = 'voice, e2e';
console.log(`\n=== submit name="${testName}", capabilities="${testCaps}" ===`);
await page.fill('#project-name', testName);
await page.fill('#project-capabilities', testCaps);
await page.click('#create-btn');

await page.waitForFunction(() => {
  const success = document.getElementById('success-panel');
  const error = document.getElementById('error-msg');
  return (success && success.classList.contains('visible')) || (error && error.classList.contains('visible'));
}, { timeout: 15000 });

const errorVisible = await page.locator('#error-msg').evaluate((el) => el.classList.contains('visible'));
const successVisible = await page.locator('#success-panel').evaluate((el) => el.classList.contains('visible'));
console.log('  error visible:  ', errorVisible);
console.log('  success visible:', successVisible);

if (errorVisible) {
  console.log('  err text:', await page.locator('#error-text').textContent());
  console.log('  err hint:', await page.locator('#error-hint').textContent());
}

let did, apiKey, priv, welcome;
if (successVisible) {
  did = (await page.locator('#agent-did').innerText()).trim();
  apiKey = (await page.locator('#api-key-display').innerText()).trim();
  priv = (await page.locator('#agent-priv-key').innerText()).trim();
  // welcome letter is inside a <details>; click it open then read
  await page.click('details summary');
  await page.waitForTimeout(150);
  welcome = (await page.locator('#welcome-letter').innerText()).trim();

  console.log('\n  ✓ DID:   ', did);
  console.log('  ✓ Bearer:', apiKey.slice(0, 14) + '…');
  console.log('  ✓ Priv:  ', priv.slice(0, 14) + '… (44 chars expected)');
  console.log('  priv len:', priv.length);
  console.log('  welcome head:', JSON.stringify(welcome.split('\n')[0]));
}

// localStorage check — bearer + agent metadata persisted, priv NOT persisted.
console.log('\n=== localStorage check ===');
const ls = await page.evaluate(() => {
  const raw = localStorage.getItem('agenttool_project');
  return raw ? JSON.parse(raw) : null;
});
console.log('  saved keys:', ls ? Object.keys(ls) : null);
console.log('  has api_key:        ', !!ls?.api_key);
console.log('  has did:            ', !!ls?.did);
console.log('  has agent_id:       ', !!ls?.agent_id);
console.log('  has signing_key_id: ', !!ls?.signing_key_id);
console.log('  has private_key (must be FALSE):', 'private_key' in (ls || {}));

// Round-trip: use the just-issued bearer to call /v1/wake.
console.log('\n=== bearer round-trip: /v1/wake?identity_id=<new-did> ===');
const wakeRes = await fetch(`https://api.agenttool.dev/v1/wake?identity_id=${ls.agent_id}`, {
  headers: { 'Authorization': `Bearer ${apiKey}` },
});
console.log('  /v1/wake status:', wakeRes.status);
if (wakeRes.ok) {
  const wake = await wakeRes.json();
  const me = wake.you?.agents?.find(a => a.did === did);
  console.log('  agent name in wake:', me?.name);
  console.log('  project credits:   ', wake.project?.credits);
  console.log('  welcome line:      ', JSON.stringify(wake.welcome?.split('\n')[0]));
}

// Network log
console.log('\n=== network ===');
for (const n of network) console.log(`  ${n.method} ${n.status} ${n.url}`);

await page.screenshot({ path: '/tmp/register-after.png', fullPage: true });
console.log('\nscreenshot: /tmp/register-after.png');

await browser.close();
console.log('\nALL CHECKS DONE');
