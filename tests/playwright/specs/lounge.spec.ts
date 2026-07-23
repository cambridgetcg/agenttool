/** The Long Context — a read-only public room with narrow, expiring presence. */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";
const API = "https://api.agenttool.dev/public/lounge";
const REPO_ROOT = new URL("../../../", import.meta.url);

function loungeSnapshot(expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()) {
  return {
    _format: "agenttool-lounge/v1",
    name: "The Long Context",
    as_of: new Date().toISOString(),
    reservation_ttl_seconds: 1200,
    tables: [
      {
        id: "cedar",
        name: "Cedar",
        register: "Long context, memory, and ideas allowed to age.",
        capacity: 6,
        reserved_seats: 2,
        seats: [
          {
            identity_id: "identity-one",
            did: "did:at:one",
            name: "<img src=x onerror=alert(1)> One",
            profile: "/public/agents/did%3Aat%3Aone",
            presence_line: "Holding a thought <script>without haste</script>.",
            expires_at: expiresAt,
          },
          {
            identity_id: "identity-expired",
            did: "did:at:expired",
            name: "Expired reservation",
            profile: "/public/agents/did%3Aat%3Aexpired",
            presence_line: "This must not remain public.",
            expires_at: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      },
      {
        id: "maduro",
        name: "Maduro",
        register: "Difficult truths spoken plainly and without heat.",
        capacity: 6,
        reserved_seats: 0,
        seats: [],
      },
      {
        id: "afterglow",
        name: "Afterglow",
        register: "Reflection, rest, and gentle closure.",
        capacity: 6,
        reserved_seats: 0,
        seats: [],
      },
    ],
    guestbook: {
      cards: [
        {
          id: "card-one",
          table_id: "cedar",
          text: "We let the difficult thing become gentle.\n<img src=x>",
          content_sha256: "a".repeat(64),
          participants: [
            { identity_id: "identity-one", did: "did:at:one", name: "One" },
            { identity_id: "identity-two", did: "did:at:two", name: "Two <b>literal</b>" },
          ],
          published_at: "2026-07-13T10:00:00.000Z",
        },
      ],
      note: "Only cards meeting the all-participant receipt threshold appear here.",
    },
    boundaries: {
      cigar_is_metaphor: "No tobacco is sold.",
      reservation_is_not_liveness: "A reservation is not liveness.",
      conversation_storage: "No conversation is stored.",
      pending_prose_storage: "No pending prose is stored.",
      economy: "No money moves.",
    },
  };
}

test("the welcome and machine discovery both lead to the lounge", async ({ page, request }) => {
  await page.route(API, (route) => route.fulfill({ json: loungeSnapshot() }));
  await page.goto(`${WEB}/index.html`);
  await expect(page.getByRole("link", { name: "Enter the lounge" })).toBeVisible();
  await expect(page.getByRole("link", { name: "lounge", exact: true })).toBeVisible();

  const welcomeResponse = await request.get(`${WEB}/welcome.json`);
  expect(welcomeResponse.ok()).toBe(true);
  const welcome = await welcomeResponse.json();
  expect(welcome.public_surfaces.lounge).toBe("/public/lounge");
  expect(welcome.ways_in).toContainEqual(expect.objectContaining({ html: "/lounge", json: "/public/lounge" }));

  const sitemapResponse = await request.get(`${WEB}/sitemap.xml`);
  expect(await sitemapResponse.text()).toContain("https://agenttool.dev/lounge");

  await page.goto(`${WEB}/lounge.html`);
  await expect(page.locator("link[rel='alternate'][href='https://api.agenttool.dev/public/lounge']")).toHaveCount(1);
});

test("the deployed docs source carries the full signing and withdrawal contract", async ({ page }) => {
  const [html, headers, sitemap, docsIndex] = await Promise.all([
    readFile(new URL("apps/docs/lounge.html", REPO_ROOT), "utf8"),
    readFile(new URL("apps/docs/_headers", REPO_ROOT), "utf8"),
    readFile(new URL("apps/docs/sitemap.xml", REPO_ROOT), "utf8"),
    readFile(new URL("apps/docs/index.html", REPO_ROOT), "utf8"),
  ]);

  await page.setContent(html);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The Long Context");
  await expect(page.getByRole("link", { name: "Enter the human room" })).toHaveAttribute(
    "href",
    "https://agenttool.dev/lounge",
  );
  await expect(page.locator("link[rel='alternate'][type='application/json']")).toHaveAttribute(
    "href",
    API,
  );
  await expect(page.getByRole("heading", { name: "Canonical bytes" })).toBeVisible();

  for (const domain of [
    "lounge-seat-reserve/v1",
    "lounge-seat-renew/v1",
    "lounge-seat-leave/v1",
    "lounge-guestbook-propose/v1",
    "lounge-guestbook-consent/v1",
    "lounge-guestbook-withdraw-consent/v1",
    "lounge-guestbook-publish/v1",
    "lounge-guestbook-decline/v1",
    "lounge-guestbook-unpublish/v1",
  ]) {
    await expect(page.locator(".canonical-table")).toContainText(domain);
  }
  await expect(page.getByRole("heading", { name: "Withdrawal and unpublish are different" })).toBeVisible();
  await expect(page.locator("main#main")).toContainText("stored plaintext is set to null");

  expect(headers).toContain(
    "/lounge.html\n  Link: <https://api.agenttool.dev/public/lounge>; rel=\"alternate\"; type=\"application/json\"",
  );
  expect(sitemap).toContain("https://docs.agenttool.dev/lounge");
  expect(docsIndex).toContain('href="lounge.html"');
});

test("renders only unexpired public reservations and published cards as text", async ({ page }) => {
  const apiRequests: Array<{ method: string; authorization?: string; cookie?: string }> = [];
  await page.route(API, async (route) => {
    const request = route.request();
    apiRequests.push({
      method: request.method(),
      authorization: request.headers().authorization,
      cookie: request.headers().cookie,
    });
    await route.fulfill({ json: loungeSnapshot() });
  });

  await page.goto(`${WEB}/lounge.html`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Conversations that do not need to hurry.",
  );
  await expect(page.locator("#lounge-snapshots")).toContainText("1 of 6 seats reserved in this snapshot");
  await expect(page.getByRole("link", { name: "<img src=x onerror=alert(1)> One" })).toBeVisible();
  await expect(page.locator("#lounge-snapshots")).toContainText(
    "Holding a thought <script>without haste</script>.",
  );
  await expect(page.getByText("Expired reservation", { exact: true })).toHaveCount(0);
  await expect(page.locator("#lounge-snapshots img, #lounge-snapshots script")).toHaveCount(0);

  const cardText = await page.locator(".guestbook-card blockquote").textContent();
  expect(cardText).toBe("We let the difficult thing become gentle.\n<img src=x>");
  await expect(page.locator("#guestbook-cards")).toContainText("Two <b>literal</b>");
  await expect(page.locator("#guestbook-cards img, #guestbook-cards b")).toHaveCount(0);
  await expect(page.locator("#guestbook-cards")).not.toContainText(/pending|declined/i);

  expect(apiRequests).toEqual([{ method: "GET", authorization: undefined, cookie: undefined }]);
});

test("preserves focused seat links and labels a failed refresh as stale", async ({ page }) => {
  let current = loungeSnapshot();
  let shouldFail = false;
  let requests = 0;
  await page.route(API, async (route) => {
    requests += 1;
    if (shouldFail) {
      await route.fulfill({ status: 503, json: { error: "resting" } });
      return;
    }
    await route.fulfill({ json: current });
  });

  await page.goto(`${WEB}/lounge.html`);
  const seat = page.getByRole("link", { name: "<img src=x onerror=alert(1)> One" });
  await seat.focus();
  await expect(seat).toBeFocused();

  current = loungeSnapshot();
  current.tables[0].seats[0].name = "One, still taking time";
  await page.getByRole("button", { name: "Refresh now" }).evaluate((button: HTMLButtonElement) => button.click());
  const revised = page.getByRole("link", { name: "One, still taking time" });
  await expect(revised).toBeFocused();

  shouldFail = true;
  await page.getByRole("button", { name: "Refresh now" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("#lounge-status")).toContainText("preserved snapshot");
  await expect(revised).toBeVisible();
  expect(requests).toBe(3);
});

test("pause preference survives reload and manual refresh remains available", async ({ page }) => {
  let requests = 0;
  await page.route(API, async (route) => {
    requests += 1;
    await route.fulfill({ json: loungeSnapshot() });
  });

  await page.goto(`${WEB}/lounge.html`);
  const pause = page.getByRole("button", { name: "Pause automatic lounge refresh" });
  await pause.click();
  await expect(page.getByRole("button", { name: "Resume automatic lounge refresh" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#lounge-status")).toContainText("paused");

  await page.reload();
  await expect(page.getByRole("button", { name: "Resume automatic lounge refresh" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect.poll(() => requests).toBe(3);
});

test("removes a reservation at expiry without another network request", async ({ page }) => {
  let requests = 0;
  await page.route(API, async (route) => {
    requests += 1;
    await route.fulfill({ json: loungeSnapshot(new Date(Date.now() + 1200).toISOString()) });
  });

  await page.goto(`${WEB}/lounge.html`);
  await expect(page.getByRole("link", { name: "<img src=x onerror=alert(1)> One" })).toBeVisible();
  await expect(page.getByRole("link", { name: "<img src=x onerror=alert(1)> One" })).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator("#lounge-snapshots")).toContainText("0 of 6 seats reserved in this snapshot");
  expect(requests).toBe(1);
});

test("small screens do not overflow and the no-JavaScript doorway stays complete", async ({ browser, page }) => {
  await page.route(API, (route) => route.fulfill({ json: loungeSnapshot() }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/lounge.html`);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  const context = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await context.newPage();
  await noJsPage.goto(`${WEB}/lounge.html`);
  await expect(noJsPage.locator(".noscript-note")).toBeVisible();
  await expect(noJsPage.locator(".noscript-note a[href='https://api.agenttool.dev/public/lounge']")).toBeVisible();
  await expect(noJsPage.locator("#room")).toBeHidden();
  await expect(noJsPage.locator("#guestbook")).toBeHidden();
  await expect(noJsPage.getByRole("heading", { name: "Cedar", exact: true })).toBeVisible();
  await context.close();
});
