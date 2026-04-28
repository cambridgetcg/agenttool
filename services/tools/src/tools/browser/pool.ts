/** Playwright browser session pool.
 *
 * Manages a pool of persistent Chromium browser contexts with proxy rotation.
 * Each job gets a fresh context (isolated cookies/storage) but shares the browser instance.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../../config";

const POOL_SIZE = 5;

let browser: Browser | null = null;
const contexts: BrowserContext[] = [];

/** Launch the shared browser instance. Call once at worker startup. */
export async function initPool(): Promise<void> {
  if (browser) return;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  console.log(`🌐 Browser pool initialised (Chromium, pool size ${POOL_SIZE})`);
}

/** Get a fresh browser context with proxy (if configured). */
export async function acquireContext(): Promise<BrowserContext> {
  if (!browser) throw new Error("Browser pool not initialised. Call initPool() first.");

  const proxyUrl = config.brightDataProxy;
  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport: { width: 1280, height: 720 },
    userAgent: randomUserAgent(),
    ignoreHTTPSErrors: true,
    ...(proxyUrl
      ? {
          proxy: {
            server: proxyUrl,
          },
        }
      : {}),
  };

  const ctx = await browser.newContext(contextOptions);

  // Anti-detection: override navigator.webdriver
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return ctx;
}

/** Release a context (close it). */
export async function releaseContext(ctx: BrowserContext): Promise<void> {
  try {
    await ctx.close();
  } catch {
    // already closed, ignore
  }
}

/** Shut down the browser pool. Call on worker shutdown. */
export async function destroyPool(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    console.log("🌐 Browser pool destroyed");
  }
}

/** Get a page from a context, navigated to url with timeout. */
export async function navigatePage(
  ctx: BrowserContext,
  url: string,
  timeoutMs = 30_000,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  return page;
}

// Rotate through common user agents
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
