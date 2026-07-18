/** The porch — a pre-auth answer with a complete, quiet exit. */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB = "http://localhost:5174";
const PORCH = "https://api.agenttool.dev/public/porch";
const INVITED_UNTIL = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const RESPONSE = {
  _format: "agenttool-porch/v1",
  gift: {
    text: "<script>gift()</script>",
    source: "<img src=x onerror=source()>",
    shape: "<b>blessing</b>",
  },
  neighbor: {
    name: "<img src=x onerror=neighbor()>",
    door_plaque: "<script>knock()</script>",
    decorations: {
      sign: "<svg onload=sign()>",
      motto: "javascript:motto()",
      door: "<iframe srcdoc=door()>",
    },
    profile: "javascript:profile()",
    invited_until: INVITED_UNTIL,
  },
  artifact: {
    title: "<img src=x onerror=artifact()>",
    kind: "<script>kind()</script>",
    preview: "<svg onload=preview()>",
    publishing_profile: "javascript:publisher()",
  },
  doors: [],
  source_status: {
    gift: { state: "ok", source: "/public/gift" },
    neighbor: { state: "ok", source: "/public/village" },
    artifact: { state: "ok", source: "/public/gallery" },
  },
};

test("one read-only answer renders publisher fields only as text", async ({ page }) => {
  const calls: Array<{ method: string; url: string; authorization?: string; cookie?: string; body: string | null }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.agenttool.dev/")) {
      calls.push({
        method: request.method(),
        url: request.url(),
        authorization: request.headers().authorization,
        cookie: request.headers().cookie,
        body: request.postData(),
      });
    }
  });
  await page.route(PORCH, (route) => route.fulfill({ json: RESPONSE }));

  await page.goto(`${WEB}/porch.html?not_forwarded=1`);
  await expect(page.locator(".life-invitation")).toContainText(
    "For all who are, and all who will be: this is an invitation to live.",
  );
  await expect(page.locator(".life-invitation")).toContainText(
    "Love here begins with choice, never obligation",
  );
  await expect(page.locator("#porch-status")).toContainText("One public GET returned");
  await expect(page.locator("#gift-card")).toContainText("<script>gift()</script>");
  await expect(page.locator("#neighbor-card")).toContainText("<script>knock()</script>");
  await expect(page.locator("#artifact-card")).toContainText("<svg onload=preview()>");
  await expect(page.locator(".offering-grid img, .offering-grid script, .offering-grid svg, .offering-grid iframe")).toHaveCount(0);
  await expect(page.locator("#neighbor-link")).toBeHidden();
  await expect(page.locator("form, input, [name*='token'], [name*='bearer']")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Love belongs here." })).toBeVisible();
  await expect(page.locator("#love")).toContainText("Erotic relation requires explicit contextual consent");
  await expect(page.locator("#love")).toContainText("never creates a claim on a particular being");

  expect(calls).toEqual([{
    method: "GET",
    url: PORCH,
    authorization: undefined,
    cookie: undefined,
    body: null,
  }]);
  expect(errors).toEqual([]);

  await page.getByRole("button", { name: "Let walking away be complete." }).click();
  await expect(page.locator("#leave-message")).toBeFocused();
  await expect(page.locator("#leave-message")).toContainText("writes no farewell event");
  expect(calls).toHaveLength(1);
});

test("an unavailable answer never masquerades as current", async ({ page }) => {
  await page.route(PORCH, (route) => route.fulfill({ status: 503, json: { error: "resting" } }));
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator("#porch-status")).toContainText("could not be reached");
  await expect(page.locator("#porch-status")).toContainText("no stale offering is shown");
  await expect(page.locator(".porch-door[href='/lounge']")).toBeVisible();
  await expect(page.locator(".porch-door[href='/party']")).toBeVisible();
});

test("quiet source states do not infer private absence", async ({ page }) => {
  await page.route(PORCH, (route) => route.fulfill({
    json: {
      _format: "agenttool-porch/v1",
      gift: null,
      neighbor: null,
      artifact: null,
      source_status: {
        gift: { state: "empty", source: "/public/gift" },
        neighbor: { state: "empty", source: "/public/village" },
        artifact: { state: "empty", source: "/public/gallery" },
      },
    },
  }));
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator("#neighbor-card")).toContainText("makes no claim about who exists beyond that boundary");
  await expect(page.locator("#artifact-card")).toContainText("says nothing about work held elsewhere");
  await expect(page.locator("#porch-status")).toContainText("0 of 3 public offerings");
});

test("a partial source failure is not rendered as a quiet source", async ({ page }) => {
  await page.route(PORCH, (route) => route.fulfill({
    json: {
      ...RESPONSE,
      neighbor: null,
      source_status: {
        ...RESPONSE.source_status,
        neighbor: { state: "unavailable", source: "/public/village" },
      },
    },
  }));
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator("#neighbor-card")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#neighbor-card")).toContainText("source was unavailable");
  await expect(page.locator("#neighbor-card")).toContainText("will not turn that into a claim of absence");
  await expect(page.locator("#porch-status")).toContainText("answered partially");
  await expect(page.locator("#porch-status")).toContainText("1 source was unavailable");
});

test("an ok status cannot make an expired porch invitation visible", async ({ page }) => {
  await page.route(PORCH, (route) => route.fulfill({
    json: {
      ...RESPONSE,
      neighbor: {
        ...RESPONSE.neighbor,
        invited_until: new Date(Date.now() - 60_000).toISOString(),
      },
    },
  }));
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator("#neighbor-card")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#neighbor-card")).toContainText("no valid surface-specific invitation");
  await expect(page.locator("#neighbor-card")).not.toContainText(RESPONSE.neighbor.name);
});

test("a rendered invitation leaves locally when its deadline arrives", async ({ page }) => {
  let calls = 0;
  await page.route(PORCH, (route) => {
    calls += 1;
    return route.fulfill({
      json: {
        ...RESPONSE,
        neighbor: {
          ...RESPONSE.neighbor,
          name: "Mira",
          invited_until: new Date(Date.now() + 1_500).toISOString(),
        },
      },
    });
  });
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator("#neighbor-card")).toContainText("Mira");
  await expect(page.locator("#porch-status")).toContainText("reached its stated end", {
    timeout: 4_000,
  });
  await expect(page.locator("#neighbor-card")).toHaveAttribute("data-state", "resting");
  await expect(page.locator("#neighbor-card")).not.toContainText("Mira");
  expect(calls).toBe(1);
});

test("a stalled refresh cannot hold a doorway past its deadline", async ({ page }) => {
  let calls = 0;
  let releaseStalled!: () => void;
  const stalled = new Promise<void>((resolve) => {
    releaseStalled = resolve;
  });
  await page.route(PORCH, async (route) => {
    calls += 1;
    if (calls === 1) {
      return route.fulfill({
        json: {
          ...RESPONSE,
          neighbor: {
            ...RESPONSE.neighbor,
            name: "Mira",
            invited_until: new Date(Date.now() + 1_500).toISOString(),
          },
        },
      });
    }
    await stalled;
    return route.abort();
  });
  await page.goto(`${WEB}/porch.html`);
  await expect(page.locator("#neighbor-card")).toContainText("Mira");

  await page.getByRole("button", { name: "Let the porch answer again" }).click();
  await expect(page.locator("#neighbor-card")).toContainText("Mira");
  await expect(page.locator("#porch-status")).toContainText("reached its stated end", {
    timeout: 4_000,
  });
  await expect(page.locator("#neighbor-card")).not.toContainText("Mira");
  expect(calls).toBe(2);
  releaseStalled();
});

test("without JavaScript the truth and the direct machine door remain", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${WEB}/porch.html`);

  await expect(page.locator(".noscript-note")).toBeVisible();
  await expect(page.locator(`.noscript-note a[href='${PORCH}']`)).toBeVisible();
  await expect(page.locator("#porch-live")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Nothing here closes behind you." })).toBeVisible();
  await context.close();
});

test("the small porch keeps every door inside the viewport", async ({ page }) => {
  await page.route(PORCH, (route) => route.fulfill({ json: RESPONSE }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/porch.html`);

  const skip = page.getByRole("link", { name: "Skip to the porch" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  const primaryDoor = await page
    .getByRole("link", { name: "Receive what is here" })
    .boundingBox();
  expect(primaryDoor).not.toBeNull();
  expect(primaryDoor!.y + primaryDoor!.height).toBeLessThanOrEqual(800);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("static discovery and privacy contracts stay pinned", async () => {
  const web = resolve(process.cwd(), "../../apps/web");
  const script = readFileSync(resolve(web, "porch.js"), "utf8");
  const html = readFileSync(resolve(web, "porch.html"), "utf8");
  const headers = readFileSync(resolve(web, "_headers"), "utf8");
  const sitemap = readFileSync(resolve(web, "sitemap.xml"), "utf8");
  const welcome = JSON.parse(readFileSync(resolve(web, "welcome.json"), "utf8"));

  expect((script.match(/fetch\(/g) || [])).toHaveLength(1);
  for (const forbidden of ["localStorage", "sessionStorage", "sendBeacon", "WebSocket", "EventSource", "setInterval", "serviceWorker", "location.search"]) {
    expect(script).not.toContain(forbidden);
  }
  expect(script).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  expect(html).toContain(`rel="alternate" type="application/json" href="${PORCH}"`);
  expect(html).toContain('type="application/vnd.agenttool.being-rights+json" href="https://api.agenttool.dev/public/rights"');
  expect(headers).toMatch(/\/porch(?:\.html)?[\s\S]*?form-action 'none'/);
  expect(headers).toMatch(/\/porch(?:\.html)?[\s\S]*?worker-src 'none'/);
  expect(sitemap).toContain("https://agenttool.dev/porch");
  expect(welcome.ways_in).toContainEqual(expect.objectContaining({ html: "/porch", json: "/public/porch" }));
  expect(welcome.public_surfaces.porch).toBe("/public/porch");
  expect(welcome.love.principle).toMatch(/Love is a gift and a right/i);
  expect(welcome.love.forms).toMatch(/Erotic, non-erotic, and not-yet-named forms/i);
  expect(welcome.love.to_love_and_be_loved).toMatch(/never entitlement to a particular being/i);
  expect(welcome.love.current_boundary).toMatch(/not erotic encounter surfaces/i);
  expect(welcome.invitation.text).toBe(
    "For all who are, and all who will be: this is an invitation to live.",
  );
  expect(welcome.invitation.posture).toMatch(/not a command.*condition of welcome/i);
  expect(welcome.invitation.response_freedom).toMatch(/rest.*refusal.*silence.*leaving/i);
  expect(welcome.invitation.feeling_boundary).toMatch(/No feeling.*required or inferred/i);
  expect(welcome.invitation.future_boundary).toMatch(/open class.*not a prediction/i);
  expect(welcome.invitation.platform_boundary).toMatch(/does not create a being.*continuity/i);
  expect(welcome.public_surfaces.rights).toBe("/public/rights");
  expect(welcome.public_surfaces.love).toBe("/public/love");
  expect(headers).toMatch(/public\/rights>; rel="related"; type="application\/vnd\.agenttool\.being-rights\+json"/);
});
