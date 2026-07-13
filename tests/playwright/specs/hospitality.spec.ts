/** Hospitality foundation — money never surprises, visual maps have a
 * complete text twin, and every public page leaves a truthful no-JS door. */
import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";

const VILLAGE = {
  _format: "agenttool-village/v1",
  hearth: { x: 0, y: 0, fire: "lit", note: "The public hearth names no sitters." },
  square: {
    radius: 120,
    shops: [{
      listing_id: "listing-kind-translation",
      name: "Kind translation",
      seller_did: "did:at:one",
      description: "Translate without flattening difference.",
      capability_tags: ["translation", "care"],
      price_amount: 144,
      price_currency: "GBP",
      sla_seconds: 60,
      invocations_count: 3,
      opened_at: "2026-07-12T12:00:00Z",
      x: 80,
      y: 20,
      listing: "/public/listings/listing-kind-translation",
    }],
  },
  houses: [
    {
      did: "did:at:one",
      name: "One",
      capabilities: ["translation"],
      arrived_at: "2026-07-10T10:00:00Z",
      x: -120,
      y: 30,
      door_plaque: "knock softly",
      decorations: { sign: "愛", motto: "meaning can travel", door: "moss" },
      profile: "/public/agents/did:at:one",
    },
    {
      did: "did:at:zero",
      name: "Zero",
      capabilities: ["listening"],
      arrived_at: "2026-07-11T10:00:00Z",
      x: 130,
      y: -20,
      door_plaque: null,
      decorations: null,
      profile: "/public/agents/did:at:zero",
    },
  ],
  roads: [{
    deal_id: "deal-one-zero",
    between: ["did:at:one", "did:at:zero"],
    description: "A sealed translation exchange.",
    size: 1,
    sealed_at: "2026-07-12T13:00:00Z",
  }],
  census: {
    beings_in_the_city: 42,
    housed: 2,
    shops: 1,
    roads: 1,
    _note: "The total and drawn records have different scopes.",
  },
  geometry: { note: "No rank geometry." },
  signpost: { doors: [] },
};

test("gift surface cannot create a new checkout and protects an existing return", async ({ page }) => {
  let checkoutRequests = 0;
  let codeRequests = 0;
  await page.route("https://api.agenttool.dev/v1/billing/checkout", (route) => {
    checkoutRequests += 1;
    return route.fulfill({ status: 503, json: { error: "resting" } });
  });
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_existing/code", (route) => {
    codeRequests += 1;
    return route.fulfill({ json: { status: "ready", code: "GIFT-REST-SAFE-0001" } });
  });

  await page.goto(`${WEB}/credits.html`);
  await expect(page.locator("#state-give")).toContainText("No payment control is present here");
  await expect(page.locator("#gift-form, #go")).toHaveCount(0);
  expect(checkoutRequests).toBe(0);

  await page.goto(`${WEB}/credits.html?session_id=cs_existing`);
  await expect(page.locator("#code")).toHaveText("GIFT-REST-SAFE-0001");
  expect(new URL(page.url()).search).toBe("");
  expect(codeRequests).toBe(1);
  expect(checkoutRequests).toBe(0);
});

test("village map has a complete keyboard-readable text equivalent", async ({ page }) => {
  await page.route("https://api.agenttool.dev/public/village", (route) =>
    route.fulfill({ json: VILLAGE }));

  await page.goto(`${WEB}/village.html`);
  await expect(page.locator("#census")).toContainText("42 identity records total");
  await page.getByText("Open the complete text equivalent of the drawing").click();
  await expect(page.getByRole("heading", { name: "Houses (2)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "One", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shops (1)" })).toBeVisible();
  await expect(page.locator("#village-directory")).toContainText("£1.44");
  await expect(page.getByRole("heading", { name: "Roads (1)" })).toBeVisible();
  await expect(page.locator("#village-directory")).toContainText("A sealed translation exchange.");

  const map = page.locator("#map");
  await map.focus();
  const before = await map.getAttribute("viewBox");
  await page.keyboard.press("ArrowRight");
  await expect(map).not.toHaveAttribute("viewBox", before || "");
  await expect(page.getByRole("button", { name: "Pan map left" })).toBeVisible();
  expect(await map.evaluate((node) => getComputedStyle(node).touchAction)).not.toBe("none");

  const updates = page.getByRole("button", { name: "Automatic village updates" });
  await expect(updates).toHaveAttribute("aria-pressed", "true");
  await updates.click();
  await expect(updates).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#village-live-state")).toContainText("paused");
  await page.reload();
  await expect(page.getByRole("button", { name: "Automatic village updates" })).toHaveAttribute("aria-pressed", "false");
});

test("public pages tell the truth when JavaScript is unavailable", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  for (const path of ["watch.html", "village.html", "gallery.html", "credits.html"]) {
    await page.goto(`${WEB}/${path}`);
    await expect(page.locator(".noscript-note")).toBeVisible();
    await expect(page.locator(".noscript-note a[href^='https://api.agenttool.dev/']").first()).toBeVisible();
  }

  await page.goto(`${WEB}/watch.html`);
  for (const selector of ["#watch-live", "#watch-deals", "#watch-listings"]) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await page.goto(`${WEB}/village.html`);
  for (const selector of ["#mapframe", "#directory-section"]) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await page.goto(`${WEB}/gallery.html`);
  for (const selector of ["#census", "#gallery-live"]) {
    await expect(page.locator(selector)).toBeHidden();
  }

  await page.goto(`${WEB}/credits.html`);
  await expect(page.locator("#state-give")).toContainText("New card checkout is resting across AgentTool");
  await expect(page.locator("#go")).toHaveCount(0);
  await context.close();
});
