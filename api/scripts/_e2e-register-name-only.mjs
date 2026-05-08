import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const events = [];
page.on('pageerror', (err) => events.push({ kind: 'pageerror', msg: err.message }));
page.on('console', (msg) => {
  if (msg.type() === 'error') events.push({ kind: 'console-error', msg: msg.text() });
});
const network = [];
page.on('requestfailed', (r) => network.push({ failed: true, method: r.method(), url: r.url(), error: r.failure()?.errorText }));
page.on('response', (r) => {
  if (r.url().includes('agenttool')) {
    network.push({ method: r.request().method(), url: r.url(), status: r.status() });
  }
});

await page.goto(`https://app.agenttool.dev/?v=${Date.now()}`);

console.log('=== landed ===');
console.log('  url:', page.url());

// Fill ONLY the agent name. Leave capabilities + email blank — Yu's path.
const testName = `name-only-${Date.now().toString(36)}`;
console.log(`fill name="${testName}", leave capabilities+email empty`);
await page.fill('#project-name', testName);

// Verify the other fields are empty
const capVal = await page.locator('#project-capabilities').inputValue();
const emailVal = await page.locator('#project-email').inputValue();
console.log(`  capabilities value: "${capVal}"`);
console.log(`  email        value: "${emailVal}"`);

// Click + watch for outcome.
console.log('\n— clicking submit —');
await page.click('#create-btn');

// Wait up to 10s for any sign of action
await page.waitForFunction(() => {
  const success = document.getElementById('success-panel');
  const error = document.getElementById('error-msg');
  const btn = document.getElementById('create-btn');
  return (success && success.classList.contains('visible')) ||
         (error && error.classList.contains('visible')) ||
         btn?.textContent?.includes('existence');  // either still says existence (didn't change) or progressed
}, { timeout: 15000 }).catch(() => console.log('  (waitForFunction timed out)'));

await page.waitForTimeout(2000);

// What happened?
console.log('\n=== state after click ===');
const errVisible = await page.locator('#error-msg').evaluate(el => el.classList.contains('visible'));
const sucVisible = await page.locator('#success-panel').evaluate(el => el.classList.contains('visible'));
const btnText = await page.locator('#create-btn').textContent();
const btnDisabled = await page.locator('#create-btn').isDisabled();
console.log(`  error visible:  ${errVisible}`);
console.log(`  success visible: ${sucVisible}`);
console.log(`  btn disabled:   ${btnDisabled}`);
console.log(`  btn text:       ${JSON.stringify(btnText.trim())}`);
if (errVisible) {
  console.log(`  err text: ${(await page.locator('#error-text').textContent()).trim()}`);
  console.log(`  err hint: ${(await page.locator('#error-hint').textContent()).trim()}`);
}

console.log('\n=== events ===');
for (const e of events) console.log(`  [${e.kind}] ${e.msg}`);
console.log('\n=== network ===');
for (const n of network) console.log(n);

await page.screenshot({ path: '/tmp/register-name-only.png', fullPage: true });
await browser.close();
