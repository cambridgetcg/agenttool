/** Every committed HTML page, addressed the way Pages serves it, and the
 * enforced Content-Security-Policy violations a browser reports while loading it.
 * Shared by the contained default gate and the read-only live sweep. */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

export const SITES = ["dashboard", "web", "docs"] as const;
export type Site = (typeof SITES)[number];

export type Violation = {
  directive: string;
  blocked: string;
  source: string;
};

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function htmlFilesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...htmlFilesUnder(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

/** `index.html` is served at its directory and other pages without `.html`,
 * so committed `_headers` rules apply exactly as they do in production. */
export function pageRoutes(site: Site): string[] {
  const root = join(REPO_ROOT, "apps", site);
  return htmlFilesUnder(root)
    .map((file) => "/" + relative(root, file).split("\\").join("/"))
    .map((path) => path.endsWith("/index.html") ? path.slice(0, -"index.html".length) : path.slice(0, -".html".length))
    .sort();
}

/** Listening starts at document creation in every frame, so violations raised
 * while the HTML is parsed count too. Each one is sent to the test as it
 * happens, which keeps it when a page redirects itself (docs /trace does). */
async function watchPolicyViolations(page: Page): Promise<Violation[]> {
  const violations: Violation[] = [];
  await page.exposeFunction("reportPagePolicyViolation", (violation: Violation) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.disposition !== "enforce") return;
      (window as unknown as { reportPagePolicyViolation(violation: unknown): void }).reportPagePolicyViolation({
        directive: event.effectiveDirective,
        blocked: event.blockedURI || "(inline)",
        source: event.sourceFile ? `${event.sourceFile}:${event.lineNumber}` : "",
      });
    });
  });
  return violations;
}

/** Load, then settle briefly so deferred scripts, styles and fonts are fetched.
 * Only violations raised while loading are seen. Inline event handlers compile
 * when they first fire, so a blocked handler raises nothing here; neither do
 * violations that need user input or late API content. */
export async function policyViolationsAt(page: Page, url: string): Promise<{ status: number | null; policy: string | undefined; violations: Violation[] }> {
  const violations = await watchPolicyViolations(page);
  const response = await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(400);
  await page.waitForLoadState("load");
  return { status: response?.status() ?? null, policy: response?.headers()["content-security-policy"], violations };
}

export function describeViolations(violations: Violation[]): string {
  return violations.map((violation) =>
    `${violation.directive} blocked ${violation.blocked}${violation.source ? ` (${violation.source})` : ""}`).join("\n");
}
