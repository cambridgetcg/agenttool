/** Page-specific mocks override the unavailable API default. No browser
 * context can contact production or third-party services in this test tier. */
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';
async function contain(context: BrowserContext): Promise<BrowserContext> {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && ['5173', '5174', '5175'].includes(url.port)) return route.continue();
    if (url.origin === 'https://api.agenttool.dev') return route.fulfill({ status: 503, json: { error: 'fixture_unavailable', message: 'No API fixture was selected.' } });
    return route.abort('blockedbyclient');
  });
  return context;
}
export const test = base.extend<{}, { browser: Browser }>({
  browser: [async ({ browser }, use) => {
    const bounded = new Proxy(browser, {
      get(target, property) {
        if (property === 'newContext') return async (...args: Parameters<Browser['newContext']>) => contain(await target.newContext(...args));
        if (property === 'newPage') return async (...args: Parameters<Browser['newPage']>) => {
          const page = await target.newPage(...args); await contain(page.context()); return page;
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await use(bounded);
  }, { scope: 'worker' }],
});
export { expect };
