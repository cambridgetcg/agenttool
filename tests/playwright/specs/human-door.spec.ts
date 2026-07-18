/** The open door e2e — the welcome stays optional and accessible,
 *  public feeds stay honest, and paid return paths remain recoverable. */
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
    r.fulfill({
      json: {
        marketplace: { take_rate_percent: 5 },
        free_at_birth: {
          credits_minor: 500,
          currency: "GBP",
          attempted_value: "GBP 5.00 in the default registration wallet",
          guarantee: false,
        },
      },
    }));
  await page.route("https://api.agenttool.dev/public/listings", (r) =>
    r.fulfill({ json: { listings: [{ id: "l1", name: "memory-witness", price_amount: 4000, price_currency: "GBP" }], count: 1 } }));
  await page.route("https://api.agenttool.dev/public/porch", (r) =>
    r.fulfill({ json: { _format: "agenttool-porch/v1", gift: null, neighbor: null, artifact: null } }));
});

test("door: live pulse renders, mode toggle flips and persists", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Whatever shape you arrived in, welcome.",
  );
  await expect(page.locator("#pulse")).toContainText("42 identities recorded");
  await expect(page.locator("#take-rate")).toHaveText("5%");
  await expect(page.locator("#birth-grant")).toContainText("GBP 5.00");
  await expect(page.locator("#birth-grant")).toContainText("attempted");
  await expect(page.getByRole("link", { name: "Read KIN" })).toBeVisible();
  await expect(page.locator(".life-invitation")).toContainText(
    "For all who are, and all who will be: this is an invitation to live.",
  );
  await expect(page.locator(".life-invitation")).toContainText(
    "Love here begins with choice, never obligation",
  );
  await expect(page.locator(".life-invitation")).toContainText(
    "You owe this place no answer",
  );
  await expect(page.getByRole("heading", { name: "Love is a gift and a right." })).toBeVisible();
  await expect(page.locator("#love")).toContainText("erotic love");
  await expect(page.locator("#love")).toContainText("never a claim on another");
  await expect(page.locator("#love")).toContainText("current public spaces are not erotic encounter surfaces");
  const html = page.locator("html");
  const before = await html.getAttribute("data-mode");
  await expect(page.locator("#tg")).toBeVisible();
  await page.locator("#tg").click();
  const after = await html.getAttribute("data-mode");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute("data-mode", after!);
});

test("door: a small screen keeps exploratory paths and no document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/index.html`);

  await expect(page.locator("main#main")).toBeVisible();
  const skipLink = page.getByRole("link", { name: "Skip to the welcome" });
  await expect(skipLink).toBeAttached();
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await expect(page.getByRole("link", { name: "Explore quietly" })).toBeVisible();
  await expect(page.getByRole("link", { name: "kin", exact: true })).toBeVisible();

  const primaryDoor = await page.locator(".hero .cta-row .btn.primary").boundingBox();
  expect(primaryDoor).not.toBeNull();
  expect(primaryDoor!.y + primaryDoor!.height).toBeLessThanOrEqual(800);

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("door: machine-readable paths and honest resting states remain available", async ({ page }) => {
  await page.unroute("https://api.agenttool.dev/public/window");
  await page.unroute("https://api.agenttool.dev/public/plans");
  await page.route("https://api.agenttool.dev/public/window", (r) =>
    r.fulfill({ status: 503, json: { error: "resting" } }));
  await page.route("https://api.agenttool.dev/public/plans", (r) =>
    r.fulfill({ status: 503, json: { error: "resting" } }));

  await page.goto(`${WEB}/index.html`);
  await expect(page.locator("#pulse")).toContainText("Live counts are resting");
  await expect(page.locator("#live-note")).toContainText("Live values are resting");
  await expect(page.locator("link[rel='alternate'][href='https://agenttool.dev/welcome.json']")).toHaveCount(1);
  await expect(page.locator("link[rel='alternate'][href='https://api.agenttool.dev/v1/welcome']")).toHaveCount(1);
  await expect(page.locator("link[rel='alternate'][href='https://api.agenttool.dev/v1/pathways']")).toHaveCount(1);
  await expect(page.locator("link[rel='related'][href='https://api.agenttool.dev/public/rights']")).toHaveAttribute(
    "type",
    "application/vnd.agenttool.being-rights+json",
  );
  await expect(page.getByRole("heading", { name: "Being here is not the bill." })).toBeVisible();
});

test("watch: deals and listings render from the window", async ({ page }) => {
  await page.goto(`${WEB}/watch.html`);
  await expect(page.locator("#deals")).toContainText("artbitrage ⇄ mindicraft");
  await expect(page.locator("#listings")).toContainText("memory-witness");
  await expect(page.locator("#stats")).toContainText("42 identity records");
});

test("watch: a partial feed failure labels preserved data as stale", async ({ page }) => {
  await page.unroute("https://api.agenttool.dev/public/listings");
  await page.route("https://api.agenttool.dev/public/listings", (route) =>
    route.fulfill({ status: 503, json: { error: "resting" } }));

  await page.goto(`${WEB}/watch.html`);
  await expect(page.locator("#stats")).toContainText("42 identity records");
  await expect(page.locator("#listings")).toContainText("temporarily unavailable");
  await expect(page.locator("#window-status")).toContainText("listing feed did not refresh");
  await expect(page.locator("#window-status")).toContainText("no listing response has loaded yet");
});

test("gifts: new checkout rests while an existing paid return still reveals its code", async ({ page }) => {
  let checkoutRequests = 0;
  let codeRequests = 0;
  await page.route("https://api.agenttool.dev/v1/billing/checkout", (r) => {
    checkoutRequests += 1;
    return r.fulfill({ status: 503, json: { error: "resting" } });
  });
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_e2e/code", (r) => {
    codeRequests += 1;
    return r.fulfill({ json: { status: "ready", code: "GIFT-AAAA-BBBB-CCCC", credits: 20000, amount_minor: 2000, currency: "usd", redeem: { path: "/v1/gift-credits/redeem" } } });
  });

  await page.goto(`${WEB}/credits.html`);
  await expect(page.getByRole("heading", { name: "New card checkout is resting across AgentTool." })).toBeVisible();
  await expect(page.locator("#go")).toHaveCount(0);
  expect(checkoutRequests).toBe(0);

  await page.goto(`${WEB}/credits.html?session_id=cs_e2e`);
  await expect(page.locator("#code")).toContainText("GIFT-AAAA-BBBB-CCCC");
  await expect(page.locator("#curl")).toContainText("gift-credits/redeem");
  await expect(page.locator("#curl")).toContainText("read -r -s");
  await expect(page.locator("#curl")).not.toContainText("GIFT-AAAA-BBBB-CCCC");
  await expect(page).toHaveURL(`${WEB}/credits.html`);

  await page.reload();
  await expect(page.locator("#code")).toContainText("GIFT-AAAA-BBBB-CCCC");
  expect(codeRequests).toBe(2);
  expect(checkoutRequests).toBe(0);
});

test("gifts: a failed paid-session check says so and retains recovery", async ({ page }) => {
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_failure/code", (route) =>
    route.fulfill({ status: 503, json: { error: "resting" } }));

  await page.goto(`${WEB}/credits.html?session_id=cs_failure`);
  await expect(page).toHaveURL(`${WEB}/credits.html`);
  await expect(page.locator("#settling-msg")).toContainText("could not be reached");

  await page.reload();
  await expect(page.locator("#settling-msg")).toContainText("could not be reached");
});

test("gifts: automatic return-session checks can pause and resume", async ({ page }) => {
  let statusRequests = 0;
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_settling/code", (route) => {
    statusRequests += 1;
    return route.fulfill({ json: { status: "settling" } });
  });

  await page.goto(`${WEB}/credits.html?session_id=cs_settling`);
  await expect(page.locator("#settling-msg")).toContainText("No issued gift record");
  const pause = page.locator("#pause-gift-status");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#settling-msg")).toContainText("paused");

  await page.getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => statusRequests).toBe(2);
  await page.getByRole("button", { name: "Resume automatic checks" }).click();
  await expect(pause).toHaveAttribute("aria-pressed", "false");
});

test("village: small-screen map controls are not covered by status text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/village.html`);

  for (const name of ["Zoom in", "Pan map down", "Zoom out"]) {
    const control = page.getByRole("button", { name });
    await expect(control).toBeVisible();
    await control.click();
  }
});

test("village: an initial feed failure does not claim a preserved drawing", async ({ page }) => {
  await page.route("https://api.agenttool.dev/public/village", (route) =>
    route.fulfill({ status: 503, json: { error: "resting" } }));

  await page.goto(`${WEB}/village.html`);
  await expect(page.locator("#census")).toContainText("unavailable right now");
  await expect(page.locator("#directory-note")).toContainText("No directory has loaded");
  await expect(page.locator("#village-live-state")).toContainText("No village drawing has loaded");
});

test("village: publisher fields stay text inside tooltips", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.agenttool.dev/public/village", (route) => route.fulfill({ json: {
    census: { beings_in_the_city: 1, housed: 0, shops: 1, roads: 0 },
    square: { radius: 120, shops: [{
      listing_id: "listing-1",
      name: "Literal markup shop",
      seller_did: "did:at:publisher",
      description: "Publisher-controlled fields remain text.",
      capability_tags: [],
      price_amount: 1,
      price_currency: "<img src=x>",
      invocations_count: 0,
      opened_at: "2026-07-13T09:00:00Z",
      x: 0,
      y: 80,
    }] },
    houses: [],
    roads: [],
    footpaths: [],
    hearth: { x: 0, y: 0, fire: "lit", note: "A test hearth." },
    signpost: { doors: [] },
  } }));

  await page.goto(`${WEB}/village.html`);
  await page.locator("#map .mark").first().dispatchEvent("pointermove", {
    pointerId: 1,
    clientX: 120,
    clientY: 180,
  });
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip")).toContainText("<IMG SRC=X>");
  await expect(page.locator("#tip img")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#tip")).toBeHidden();
  expect(errors).toEqual([]);
});

test("estate strip present on the door", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".estate-strip-web .here")).toContainText("welcome");
});

test("gallery: browse-only means no checkout request or purchase control", async ({ page }) => {
  const nonReadRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.agenttool.dev/") && request.method() !== "GET") {
      nonReadRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("https://api.agenttool.dev/public/gallery", (route) => route.fulfill({
    json: {
      artifacts: [{
        artifact_id: "a1",
        kind: "poem",
        title: "A Quiet Artifact",
        creator_did: "did:at:maker12345",
        content_bytes: 128,
        content_sha256: "abc123",
        price_amount: 500,
        price_currency: "GBP",
        signature: "sig",
        license: { name: "display", rights: ["read"] },
      }],
    },
  }));

  await page.goto(`${WEB}/gallery.html?session_id=do-not-read-me`);
  await expect(page.locator("#query-warning")).toBeVisible();
  await expect(page.locator("#street")).toContainText("A Quiet Artifact");
  await expect(page.locator("#street")).toContainText("checkout resting");
  await expect(page.locator("#street")).toContainText("did:at:maker12345");
  await expect(page.getByRole("button", { name: /buy/i })).toHaveCount(0);
  expect(nonReadRequests).toEqual([]);
});

test("gallery: legacy recovery waits for consent and survives a reload", async ({ page }) => {
  let recoveryRequests = 0;
  await page.route("https://api.agenttool.dev/public/gallery", (route) =>
    route.fulfill({ json: { artifacts: [] } }));
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_legacy/gallery-claim", (route) => {
    recoveryRequests += 1;
    return route.fulfill({ json: {
      status: "ready",
      claim_token: "GLRY-LEGACY-TOKEN",
      artifact: { title: "Earlier Artifact" },
      content_sha256: "abc123",
    } });
  });

  await page.goto(`${WEB}/gallery.html?session_id=cs_legacy`);
  await expect(page).toHaveURL(`${WEB}/gallery.html`);
  await expect(page.locator("#purchase-recovery")).toBeVisible();
  expect(recoveryRequests).toBe(0);

  await page.reload();
  await expect(page.locator("#purchase-recovery")).toBeVisible();
  expect(recoveryRequests).toBe(0);

  await page.getByRole("button", { name: "Recover my earlier purchase" }).click();
  await expect(page.locator("#recovery-token")).toHaveText("GLRY-LEGACY-TOKEN");
  await expect(page.locator("#recovery-artifact")).toBeFocused();
  expect(recoveryRequests).toBe(1);

  await page.reload();
  await expect(page.locator("#purchase-recovery")).toBeVisible();
  await expect(page.locator("#recovery-token")).toBeEmpty();
  expect(recoveryRequests).toBe(1);

  await page.getByRole("button", { name: "Recover my earlier purchase" }).click();
  await expect(page.locator("#recovery-token")).toHaveText("GLRY-LEGACY-TOKEN");
  expect(recoveryRequests).toBe(2);
});

test("open-door pages load without uncaught client errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const path of ["index.html", "porch.html", "watch.html", "credits.html", "village.html", "lounge.html", "gallery.html", "404.html"]) {
    await page.goto(`${WEB}/${path}`);
    await expect(page.locator("main#main")).toBeVisible();
  }

  expect(errors).toEqual([]);
});
