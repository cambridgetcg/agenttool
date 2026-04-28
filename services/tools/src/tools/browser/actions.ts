/** Execute a sequence of browser actions on a page. */

import type { Page } from "playwright";
import type { BrowseAction } from "../../queue/browse-queue";

/** Run an ordered list of actions on a page. */
export async function executeActions(page: Page, actions: BrowseAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "click":
        if (!action.selector) throw new Error("click action requires a selector");
        await page.click(action.selector, { timeout: 10_000 });
        break;

      case "type":
        if (!action.selector || !action.text)
          throw new Error("type action requires selector and text");
        await page.fill(action.selector, action.text);
        break;

      case "scroll":
        await page.evaluate((sel) => {
          if (sel) {
            document.querySelector(sel)?.scrollIntoView({ behavior: "smooth" });
          } else {
            window.scrollBy(0, window.innerHeight);
          }
        }, action.selector ?? null);
        break;

      case "wait":
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout: action.delay ?? 10_000 });
        } else {
          await page.waitForTimeout(action.delay ?? 1000);
        }
        break;

      case "select":
        if (!action.selector || !action.value)
          throw new Error("select action requires selector and value");
        await page.selectOption(action.selector, action.value);
        break;

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  }
}

/** Extract content from the page. */
export async function extractContent(
  page: Page,
  extract?: string,
): Promise<string | undefined> {
  if (!extract) return undefined;

  if (extract === "text") {
    return page.innerText("body");
  }
  if (extract === "html") {
    return page.content();
  }
  // CSS selector → extract text content
  const el = await page.$(extract);
  if (!el) return undefined;
  return el.innerText();
}

/** Take a screenshot as base64 PNG. */
export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  return buffer.toString("base64");
}
