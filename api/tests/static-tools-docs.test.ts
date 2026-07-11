import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("static tool public documentation", () => {
  test("describes scrape output as parsed body and DOM text", () => {
    const sources = [
      read("api/README.md"),
      read("api/src/services/tools/README.md"),
      read("apps/docs/tools.html"),
    ];

    for (const source of sources) {
      expect(source).toMatch(/parsed-body|parsed <body>|DOM text|DOM-text/i);
      expect(source).not.toMatch(/visible (?:body )?text/i);
    }
  });

  test("publishes canonical link handling and the base64 media-type default", () => {
    const service = read("api/src/services/tools/README.md");
    const page = read("apps/docs/tools.html");

    for (const source of [service, page]) {
      expect(source).toMatch(/canonical absolute HTTP\(S\).*deduplicat/is);
      expect(source).toMatch(/relative, malformed, and non-HTTP\(S\).*omitted/is);
    }
    expect(service).toMatch(
      /omitted `content_type` defaults to `text\/plain`/i,
    );
    expect(page).toMatch(
      /Omitted base64 input defaults to <code>text\/plain<\/code>/i,
    );
  });

  test("discloses default, overridable attempt prices and retained failure charges", () => {
    const page = read("apps/docs/tools.html");

    expect(page).toMatch(
      /default is <strong>1 project credit<\/strong>.*CREDIT_SCRAPE/is,
    );
    expect(page).toMatch(
      /default is <strong>3 project credits<\/strong>.*CREDIT_DOCUMENT/is,
    );
    expect(page).toMatch(/configured value.*GET \/public\/plans/is);
    expect(page).toMatch(
      /debit is reserved before destination-policy, transport, representation, or parser work.*failures retain the charge/is,
    );
    expect(page).toMatch(
      /Schema-invalid and insufficient-credit requests do not debit/i,
    );
  });

  test("separates the transport deadline from the terminable parser boundary", () => {
    const sources = [
      read("README.md"),
      read("api/README.md"),
      read("docs/SAFETY-BOUNDARIES.md"),
      read("api/src/services/tools/README.md"),
      read("apps/docs/tools.html"),
    ];

    for (const source of sources) {
      expect(source).toMatch(/15-second\s+safe-net\s+deadline/i);
      expect(source).toMatch(
        /16[^.]{0,100}(?:request|active)[^.]{0,150}64[^.]{0,100}(?:one\s+second|1-second|queued)/is,
      );
      expect(source).toMatch(
        /not\s+(?:a\s+)?per-project.*(?:limiter|rate limit)/is,
      );
      expect(source).toMatch(
        /(?:fresh|separately)[^.]{0,120}(?:child process|parser process|subprocess)/i,
      );
      expect(source).toMatch(/two-second\s+(?:hard\s+)?wall/i);
      expect(source).toMatch(/not\s+one whole-(?:request|operation) deadline/i);
    }

    const safety = read("docs/SAFETY-BOUNDARIES.md");
    expect(safety).toMatch(/20,000.*256.*65,536/is);
    expect(safety).toMatch(
      /none.*cgroup.*VM.*container.*filesystem.*network\s+namespace/is,
    );
  });
});
