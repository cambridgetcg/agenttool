/** Static web scraping: fetch HTML → parse with Cheerio → extract. */

import * as cheerio from "cheerio";

export interface ScrapeOptions {
  url: string;
  selector?: string;       // CSS selector to extract specific content
  extract_links?: boolean; // include all links found
}

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;         // text content (full page or selected)
  extracted: string | null; // content from CSS selector if provided
  links: string[];
  fetched_at: string;
}

/**
 * Fetch a URL and extract content using Cheerio.
 * Handles static HTML — no JavaScript rendering.
 */
export async function scrape(opts: ScrapeOptions): Promise<ScrapeResult> {
  const { url, selector, extract_links = false } = opts;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove script, style, nav, footer for cleaner text
  $("script, style, nav, footer, header, aside, .cookie-banner, #cookie-consent").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || "";
  const content = $("body").text().replace(/\s+/g, " ").trim();

  let extracted: string | null = null;
  if (selector) {
    const selected = $(selector);
    extracted = selected.length > 0 ? selected.text().replace(/\s+/g, " ").trim() : null;
  }

  const links: string[] = [];
  if (extract_links) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        links.push(href);
      }
    });
  }

  return {
    url,
    title,
    content: content.slice(0, 50_000), // cap at 50k chars
    extracted,
    links: [...new Set(links)], // deduplicate
    fetched_at: new Date().toISOString(),
  };
}
