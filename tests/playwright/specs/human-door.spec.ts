/** The human door e2e — door renders both modes, watch breathes,
 *  ramp reaches Stripe and reveals the code. API fully mocked. */
import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";

const WINDOW_JSON = {
  _format: "agenttool-window/v1",
  identities: { total: 42, born_24h: 3 },
  deals: { sealed_24h: 1, recent: [{ id: "d1", description: "artbitrage ⇄ mindicraft", status: "sealed", buyerDid: "did:at:buyer12345", sellerDid: "did:at:seller12345", sealedAt: "2026-07-02T11:43:02Z" }] },
  listings: { live: 5 },
};

test.beforeEach(async ({ page }) => {
  await page.route("https://api.agenttool.dev/public/window", (r) =>
    r.fulfill({ json: WINDOW_JSON }));
  await page.route("https://api.agenttool.dev/public/plans", (r) =>
    r.fulfill({ json: { marketplace: { take_rate_percent: 5 }, free_at_birth: { credits_minor: 500 } } }));
  await page.route("https://api.agenttool.dev/public/listings", (r) =>
    r.fulfill({ json: { listings: [{ id: "l1", name: "memory-witness", price_amount: 4000, price_currency: "GBP" }], count: 1 } }));
});

test("door: live pulse renders, mode toggle flips and persists", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator("#pulse")).toContainText("42 agents born");
  await expect(page.locator("#take-rate")).toHaveText("5%");
  const html = page.locator("html");
  const before = await html.getAttribute("data-mode");
  await page.click("#tg");
  const after = await html.getAttribute("data-mode");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute("data-mode", after!);
});

test("watch: deals and listings render from the window", async ({ page }) => {
  await page.goto(`${WEB}/watch.html`);
  await expect(page.locator("#deals")).toContainText("artbitrage ⇄ mindicraft");
  await expect(page.locator("#listings")).toContainText("memory-witness");
  await expect(page.locator("#stats")).toContainText("42 agents born");
});

test("ramp: checkout redirects to Stripe url; return page reveals the code", async ({ page }) => {
  await page.route("https://api.agenttool.dev/v1/billing/checkout", (r) =>
    r.fulfill({ json: { session_id: "cs_e2e", url: `${WEB}/credits.html?session_id=cs_e2e` } }));
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_e2e/code", (r) =>
    r.fulfill({ json: { status: "ready", code: "GIFT-AAAA-BBBB-CCCC", credits: 20000, amount_minor: 2000, currency: "usd", redeem: { path: "/v1/gift-credits/redeem" } } }));

  await page.goto(`${WEB}/credits.html`);
  await expect(page.locator("#credits-preview")).toContainText("20,000");
  await page.click("#go");
  await expect(page.locator("#code")).toContainText("GIFT-AAAA-BBBB-CCCC");
  await expect(page.locator("#curl")).toContainText("gift-credits/redeem");
});

test("estate strip present on the door", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".estate-strip-web .here")).toContainText("human door");
});
