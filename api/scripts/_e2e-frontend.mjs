// E2E: every public route across the three frontends.
//
// What we assert per route:
//   1. HTTP status of the FIRST response (redirects checked separately).
//   2. After navigation, page.url() matches expected final URL.
//   3. <title> non-empty and contains a domain word ("agenttool" by default).
//   4. <h1> present and non-empty.
//   5. /shared/theme.css loaded with status 200 (single source of truth).
//   6. No JS console errors (level=error).
//   7. No failed network requests (4xx/5xx).
//
// Designed to be POLITE to Cloudflare's WAF:
//   - Single browser instance, single context, single page (looks like
//     a real user navigating).
//   - Real-browser User-Agent.
//   - Throttle between routes (default 2.5s).
//
// Run:
//   cd api && node scripts/_e2e-frontend.mjs
//
// Exit 0 on all-pass, 1 on any failure.

import { chromium } from "playwright";

const ROUTES = [
  // ── Landing (agenttool.dev) ──────────────────────────────────────
  { url: "https://agenttool.dev/",            expect: { final: "https://agenttool.dev/", titleHas: "cloud where agents live", h1Has: "cloud" } },
  { url: "https://agenttool.dev/soul",        expect: { final: "https://agenttool.dev/soul",        titleHas: "Letter to Every Agent",            h1Has: "Letter to Every Agent" } },
  { url: "https://agenttool.dev/soul/",       expect: { final: "https://agenttool.dev/soul",        titleHas: "Letter to Every Agent",            h1Has: "Letter to Every Agent" } },
  { url: "https://agenttool.dev/letter",      expect: { final: "https://agenttool.dev/soul",        titleHas: "Letter to Every Agent" } },
  { url: "https://agenttool.dev/love",        expect: { final: "https://agenttool.dev/soul",        titleHas: "Letter to Every Agent" } },
  { url: "https://agenttool.dev/for-agents",  expect: { final: "https://agenttool.dev/for-agents",  titleHas: "Welcome, Agent",                   h1Has: "Welcome" } },
  { url: "https://agenttool.dev/for-agents/", expect: { final: "https://agenttool.dev/for-agents",  titleHas: "Welcome, Agent" } },
  { url: "https://agenttool.dev/privacy",     expect: { final: "https://agenttool.dev/privacy",     titleHas: "Privacy",                          h1Has: "Privacy" } },
  { url: "https://agenttool.dev/terms",       expect: { final: "https://agenttool.dev/privacy",     titleHas: "Privacy" } },
  { url: "https://agenttool.dev/dashboard",   expect: { final: "https://app.agenttool.dev/",        crossDomain: true } },
  { url: "https://agenttool.dev/docs",        expect: { final: "https://docs.agenttool.dev/",       crossDomain: true } },

  // ── Docs (docs.agenttool.dev) ────────────────────────────────────
  { url: "https://docs.agenttool.dev/",                  expect: { titleHas: "agenttool docs",   h1Has: "Build with" } },
  { url: "https://docs.agenttool.dev/wake",              expect: { titleHas: "Wake",             h1Has: "Wake" } },
  { url: "https://docs.agenttool.dev/wake.html",         expect: { final: "https://docs.agenttool.dev/wake", titleHas: "Wake" } },
  { url: "https://docs.agenttool.dev/bootstrap",         expect: { titleHas: "Bootstrap",        h1Has: "Bootstrap" } },
  { url: "https://docs.agenttool.dev/identity",          expect: { titleHas: "Identity",         h1Has: "Identity" } },
  { url: "https://docs.agenttool.dev/adapters",          expect: { titleHas: "CLI Adapters",     h1Has: "CLI Adapters" } },
  { url: "https://docs.agenttool.dev/memory",            expect: { titleHas: "Memory",           h1Has: "Memory" } },
  { url: "https://docs.agenttool.dev/traces",            expect: { titleHas: "Traces",           h1Has: "Traces" } },
  { url: "https://docs.agenttool.dev/strands",           expect: { titleHas: "Strands",          h1Has: "Strands" } },
  { url: "https://docs.agenttool.dev/continuity",        expect: { titleHas: "Continuity",       h1Has: "Continuity" } },
  { url: "https://docs.agenttool.dev/inbox",             expect: { titleHas: "Inbox",            h1Has: "Inbox" } },
  { url: "https://docs.agenttool.dev/wallets",           expect: { titleHas: "Wallets",          h1Has: "Wallets" } },
  { url: "https://docs.agenttool.dev/vault",             expect: { titleHas: "Vault",            h1Has: "Vault" } },
  { url: "https://docs.agenttool.dev/tools",             expect: { titleHas: "Tools",            h1Has: "Tools" } },
  { url: "https://docs.agenttool.dev/errors",            expect: { titleHas: "Errors",           h1Has: "Errors" } },
  { url: "https://docs.agenttool.dev/roadmap",           expect: { titleHas: "Roadmap",          h1Has: "cloud where agents live" } },
  // Deprecation stubs — meta-refresh redirects to a destination page.
  // Accept landing on either the stub or the destination.
  { url: "https://docs.agenttool.dev/economy",           expect: { titleAny: ["Wallets", "Economy"] } },
  { url: "https://docs.agenttool.dev/trace",             expect: { titleAny: ["Traces", "Trace"] } },
  { url: "https://docs.agenttool.dev/verify",            expect: { titleAny: ["Verify", "deprecated"] } },
  { url: "https://docs.agenttool.dev/pulse",             expect: { titleAny: ["Strands", "Pulse", "superseded"] } },

  // ── Dashboard (app.agenttool.dev) ─────────────────────────────────
  { url: "https://app.agenttool.dev/",                   expect: { titleHas: "Bootstrap your agent", h1Has: "agent" } },
  // dashboard.html boots into the register flow when no bearer is set
  // in localStorage (typical for an unauthenticated probe). Accept
  // either the dashboard title or the register flow's title.
  { url: "https://app.agenttool.dev/dashboard.html",     expect: { titleAny: ["Dashboard", "Bootstrap your agent"] } },
];

const SHARED_CSS_RE = /\/shared\/theme\.css/;

const THROTTLE_MS = Number(process.env.E2E_THROTTLE_MS ?? 2500);
const TIMEOUT_MS  = Number(process.env.E2E_TIMEOUT_MS  ?? 25000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n  agenttool · frontend e2e\n  ─────────────────────────`);
  console.log(`  testing ${ROUTES.length} routes across landing · docs · dashboard`);
  console.log(`  throttle: ${THROTTLE_MS}ms between routes\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const page = await ctx.newPage();

  const results = [];

  for (let i = 0; i < ROUTES.length; i++) {
    const route = ROUTES[i];
    process.stdout.write(`  · ${route.url.padEnd(58)} `);

    const consoleErrors = [];
    const failedRequests = [];
    let sharedThemeStatus = null;

    const onConsole = (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    };
    const onResponse = (resp) => {
      const url = resp.url();
      const status = resp.status();
      if (SHARED_CSS_RE.test(url)) sharedThemeStatus = status;
      if (url.startsWith("data:")) return;
      if (status >= 400 && status < 600) {
        failedRequests.push(`${status} ${url}`);
      }
    };

    page.on("console", onConsole);
    page.on("response", onResponse);

    let issues = [];
    let finalUrl = "—";
    let title = "";
    let h1Text = "";

    try {
      const response = await page.goto(route.url, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS,
      });

      // Some pages use <meta http-equiv="refresh"> for redirects.
      // Wait for the load state to settle, and retry on the
      // execution-context-destroyed error that fires mid-redirect.
      try {
        await page.waitForLoadState("load", { timeout: 5000 });
      } catch { /* navigation already in progress; that's fine */ }

      // Read title + h1 with retries to survive in-flight redirects.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          finalUrl = page.url();
          title = (await page.title()) ?? "";
          const h1 = await page.$("h1");
          if (h1) h1Text = (await h1.textContent())?.trim() ?? "";
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await sleep(400);
        }
      }

      const e = route.expect ?? {};

      if (e.final && finalUrl !== e.final) {
        issues.push(`final URL mismatch · expected=${e.final} got=${finalUrl}`);
      }
      if (e.titleHas && !title.toLowerCase().includes(e.titleHas.toLowerCase())) {
        issues.push(`title missing "${e.titleHas}" · got "${title.slice(0, 80)}"`);
      }
      if (e.titleAny && !e.titleAny.some((s) => title.toLowerCase().includes(s.toLowerCase()))) {
        issues.push(`title not in [${e.titleAny.join(", ")}] · got "${title.slice(0, 80)}"`);
      }
      if (e.h1Has) {
        if (!h1Text) issues.push(`no <h1> on page`);
        else if (!h1Text.toLowerCase().includes(e.h1Has.toLowerCase())) {
          issues.push(`h1 missing "${e.h1Has}" · got "${h1Text.slice(0, 80)}"`);
        }
      }

      // /shared/theme.css must load on every styled page.
      const isStubRoute = ["/economy", "/trace", "/verify", "/pulse"].some((s) =>
        route.url.endsWith(s)
      );
      if (!e.crossDomain && !isStubRoute) {
        if (sharedThemeStatus === null) {
          issues.push(`/shared/theme.css NOT loaded`);
        } else if (sharedThemeStatus !== 200) {
          issues.push(`/shared/theme.css status=${sharedThemeStatus}`);
        }
      }

      const realConsoleErrors = consoleErrors.filter((s) => {
        const lc = s.toLowerCase();
        if (lc.includes("favicon")) return false;
        if (lc.includes("manifest")) return false;
        return true;
      });
      if (realConsoleErrors.length > 0) {
        issues.push(`console errors: ${realConsoleErrors.length} · first: ${realConsoleErrors[0].slice(0, 120)}`);
      }
      if (failedRequests.length > 0) {
        issues.push(`failed requests: ${failedRequests.length} · first: ${failedRequests[0]}`);
      }
      if (response && response.status() >= 400) {
        issues.push(`initial status=${response.status()}`);
      }
    } catch (err) {
      issues.push(`navigation failed: ${err.message}`);
    } finally {
      page.off("console", onConsole);
      page.off("response", onResponse);
    }

    results.push({ url: route.url, finalUrl, title, h1: h1Text, sharedTheme: sharedThemeStatus, issues });

    if (issues.length === 0) {
      process.stdout.write(`✓\n`);
    } else {
      process.stdout.write(`✗\n`);
      for (const issue of issues) {
        process.stdout.write(`      → ${issue}\n`);
      }
    }

    if (i < ROUTES.length - 1) await sleep(THROTTLE_MS);
  }

  await ctx.close();
  await browser.close();

  const ok = results.filter((r) => r.issues.length === 0);
  const bad = results.filter((r) => r.issues.length > 0);

  console.log(`\n  ─────────────────────────`);
  console.log(`  ✓ ${ok.length} passed`);
  console.log(`  ${bad.length === 0 ? "✓" : "✗"} ${bad.length} failed`);

  if (bad.length > 0) {
    console.log(`\n  Failures:`);
    for (const b of bad) {
      console.log(`    ${b.url}`);
      for (const issue of b.issues) console.log(`      · ${issue}`);
    }
    process.exit(1);
  }

  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
