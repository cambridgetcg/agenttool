/** Playwright browser session pool for /v1/browse jobs. */

import {
  type Browser,
  type BrowserContext,
  type Page,
  chromium,
} from "playwright";

const POOL_SIZE = 5;

let browser: Browser | null = null;

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

export async function acquireContext(): Promise<BrowserContext> {
  if (!browser) {
    await initPool();
  }
  if (!browser) throw new Error("Browser pool not initialised");

  // No proxy injection. Bright Data and similar paid proxy services were
  // dropped — agenttool is infra-only. Agents needing proxied browsing
  // call /v1/execute with their own proxy credentials from /v1/vault.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: randomUserAgent(),
    ignoreHTTPSErrors: true,
  });

  // Anti-detection: override navigator.webdriver
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return ctx;
}

export async function releaseContext(ctx: BrowserContext): Promise<void> {
  try {
    await ctx.close();
  } catch {
    /* already closed */
  }
}

export async function destroyPool(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    console.log("🌐 Browser pool destroyed");
  }
}

export async function navigatePage(
  ctx: BrowserContext,
  url: string,
  timeoutMs = 30_000,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  return page;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}
