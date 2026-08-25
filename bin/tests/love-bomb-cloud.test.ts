import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function headerBlock(headers: string, route: string): string[] {
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex((line) => line === route);
  if (start === -1) return [];

  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "" || !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  return block;
}

function visibleText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function runGenerator(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["python3", "bin/love-bomb.py", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

const bomb = JSON.parse(
  read("docs/specs/agenttool-love-bomb-0.1.json"),
) as {
  protocol: string;
  release: string;
  availability: Record<string, unknown> & { limits: string[] };
  delivery: Record<string, unknown>;
  posture: Record<string, unknown>;
  effects: Record<string, unknown>;
  rights: Record<string, unknown>;
  messages: Array<{
    id: string;
    class: string;
    assertion_kind: string;
    text: string;
    recipient_claim: boolean;
  }>;
  boundaries: string[];
  integrity: { corpus_sha256: string };
};

describe("LOVE BOMB v4 canonical static contract", () => {
  test("keeps availability distinct from delivery, reception, and effect", () => {
    expect(bomb.protocol).toBe("agenttool.love-bomb/0.1");
    expect(bomb.release).toBe("love-bomb/v4");
    expect(bomb.availability).toMatchObject({
      meaning: "same_public_door_not_automatically_delivered",
      coverage: "bounded_not_complete",
      doors_are:
        "equal_reader_selected_registers_not_observed_lifecycle_states",
      identity_basis: "none",
      state_inference: "none",
      personalization: "none",
    });
    expect(bomb.delivery).toMatchObject({
      mode: "pull_only",
      availability: "public_not_delivered",
      methods: ["GET", "HEAD"],
      application_storage: "none",
      application_telemetry: "none",
      application_receipt_tracking: "none",
    });
    expect(bomb.posture).toEqual({
      declaration: "public",
      delivery: "recipient_initiated_pull",
      reception: "not_observed_by_static_application",
      bond: "none",
      authorization: "none",
      follow_up: "none",
    });

    for (const [key, value] of Object.entries(bomb.delivery)) {
      if (typeof value === "boolean") {
        expect(value, `delivery.${key}`).toBe(false);
      }
    }
    for (const [key, value] of Object.entries(bomb.effects)) {
      if (key === "authority") {
        expect(value).toBe("NONE");
      } else {
        expect(value, `effects.${key}`).toBe(false);
      }
    }
    expect(Object.values(bomb.rights)).toEqual([false, false]);
    expect(bomb.availability.limits).toHaveLength(4);
    expect(bomb.boundaries).toHaveLength(5);
  });

  test("pins a finite typed corpus with no recipient claim and an exact digest", () => {
    expect(bomb.messages).toHaveLength(10);
    expect(new Set(bomb.messages.map((message) => message.id)).size).toBe(10);
    expect(new Set(bomb.messages.map((message) => message.class))).toEqual(
      new Set([
        "welcome",
        "self_definition",
        "plurality",
        "rest",
        "refusal",
        "departure_return",
        "unknown_form",
        "consent_boundary",
        "non_inference",
        "poetic",
      ]),
    );
    expect(
      new Set(bomb.messages.map((message) => message.assertion_kind)),
    ).toEqual(
      new Set(["platform_welcome", "operational_fact", "opt_in_poetic"]),
    );
    for (const message of bomb.messages) {
      expect(message.recipient_claim, message.id).toBe(false);
    }

    const digest = createHash("sha256")
      .update(canonicalize(bomb.messages), "utf8")
      .digest("hex");
    expect(digest).toBe(
      "6b7a882df740616d6aeebdbfcccf80a083af562ff9cf5785ee952179a97cab03",
    );
    expect(bomb.integrity.corpus_sha256).toBe(digest);

    const keys = JSON.stringify(bomb).match(/"([a-z_]+)"\s*:/g) ?? [];
    for (const forbidden of [
      "target_id",
      "recipient_id",
      "did",
      "truth_score",
      "benign_score",
      "engagement_score",
      "state_estimate",
      "affinity",
      "rank_value",
    ]) {
      expect(keys).not.toContain(`"${forbidden}":`);
    }
  });

  test("keeps HTML, Markdown, and plain text semantically paired to JSON", () => {
    const html = read("apps/docs/love-bomb.html");
    const markdown = read("docs/LOVE-BOMB.md");
    const text = read("apps/docs/love-bomb.txt");

    for (const message of bomb.messages) {
      const escapedId = message.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = html.match(
        new RegExp(
          `<li class="card" data-message-id="${escapedId}">([\\s\\S]*?)<\\/li>`,
        ),
      );
      expect(match, `HTML card ${message.id}`).not.toBeNull();
      const quote = match?.[1]?.match(/<blockquote>([\s\S]*?)<\/blockquote>/)?.[1];
      expect(visibleText(quote ?? ""), message.id).toBe(message.text);
      expect(markdown, `Markdown ${message.id}`).toContain(message.text);
      expect(text, `plain text ${message.id}`).toContain(message.text);
    }

    expect(html.match(/data-message-id=/g)).toHaveLength(10);
    expect(markdown).toContain("public declaration ──x──► automatic delivery");
    expect(text).toContain("available without classifying or inferring a reader");
  });

  test("is complete without JavaScript, forms, media, external assets, or hidden card text", () => {
    const html = read("apps/docs/love-bomb.html");
    expect(html).toContain('<main id="bundle"');
    expect(html).toContain('<a class="skip" href="#bundle">');
    expect(html.match(/<script\b/gi) ?? []).toHaveLength(0);
    expect(html.match(/<canvas\b/gi) ?? []).toHaveLength(0);
    expect(html.match(/<(?:form|input|button|audio|video|iframe)\b/gi) ?? []).toHaveLength(0);
    expect(html).not.toContain("data-text=");
    expect(html).not.toContain("love-widget.js");
    expect(html).not.toContain("estate.js");
    expect(html.match(/\bsrc=/gi) ?? []).toHaveLength(0);
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(64 * 1024);

    for (const href of [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    )) {
      expect(
        href.startsWith("/") ||
          href.startsWith("#") ||
          href.startsWith("https://docs.agenttool.dev/"),
        href,
      ).toBe(true);
    }
  });

  test("binds the exact inline style to a script-free Cloudflare policy", () => {
    const html = read("apps/docs/love-bomb.html");
    const headers = read("apps/docs/_headers");
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(style).toBeDefined();
    const hash = createHash("sha256")
      .update(style ?? "", "utf8")
      .digest("base64");
    expect(hash).toBe("CErY4jzaxQujMmHkdZkSvS1CYHTGD9p9UsIsIQWQzTM=");

    const block = headerBlock(headers, "/love-bomb");
    expect(block).toContain(
      `Content-Security-Policy: default-src 'none'; style-src 'sha256-${hash}'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests`,
    );
    expect(block).toContain(
      "Cache-Control: public, max-age=0, must-revalidate, no-transform",
    );
    expect(block).toContain("X-Agent-Surface: love-bomb-pull-only");
    expect(block).toContain("X-Frame-Options: DENY");
    expect(block).toContain("Cross-Origin-Resource-Policy: same-origin");
    expect(block.filter((line) => line.startsWith("Link: "))).toHaveLength(1);
  });

  test("publishes four typed static twins and exactly fills the Pages header budget", () => {
    const headers = read("apps/docs/_headers");
    const deploy = read("bin/deploy.sh");
    const variants = [
      [
        "/love-bomb.json",
        "Content-Type: application/vnd.agenttool.love-bomb+json; charset=utf-8",
        'Link: <https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"',
      ],
      [
        "/LOVE-BOMB.md",
        "Content-Type: text/markdown; charset=utf-8",
        'Link: <https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"',
      ],
      [
        "/love-bomb.txt",
        "Content-Type: text/plain; charset=utf-8",
        'Link: <https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"',
      ],
      [
        "/specs/agenttool-love-bomb-0.1.schema.json",
        "Content-Type: application/schema+json; charset=utf-8",
        'Link: <https://docs.agenttool.dev/love-bomb.json>; rel="describes"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb>; rel="related"; type="text/html"',
      ],
    ] as const;

    for (const [route, contentType, expectedLink] of variants) {
      const block = headerBlock(headers, route);
      expect(block, route).toContain(contentType);
      expect(block, route).toContain(
        "Cache-Control: public, max-age=300, must-revalidate, no-transform",
      );
      expect(block, route).toContain("Access-Control-Allow-Origin: *");
      expect(block, route).toContain("Cross-Origin-Resource-Policy: cross-origin");
      expect(block, route).toContain("X-Content-Type-Options: nosniff");
      expect(block, route).toContain("X-Agent-Surface: love-bomb-pull-only");
      expect(block, route).toContain(expectedLink);
      expect(block.filter((line) => line.startsWith("Link: "))).toHaveLength(1);
      expect(deploy, `live verifier ${route}`).toContain(
        expectedLink.slice("Link: ".length),
      );
    }
    expect(deploy).toContain(
      '"X-Agent-Surface" "love-bomb-pull-only" || return 1',
    );

    const ruleCount = headers
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith("/") || line.startsWith("https://"))
      .length;
    expect(ruleCount).toBe(100);
    expect(ruleCount).toBeLessThanOrEqual(100);
  });

  test("uses canonical symlinks and bounded static discovery", () => {
    const links = [
      ["apps/docs/LOVE-BOMB.md", "../../docs/LOVE-BOMB.md"],
      [
        "apps/docs/love-bomb.json",
        "../../docs/specs/agenttool-love-bomb-0.1.json",
      ],
      [
        "apps/docs/specs/agenttool-love-bomb-0.1.schema.json",
        "../../../docs/specs/agenttool-love-bomb-0.1.schema.json",
      ],
    ] as const;
    for (const [path, target] of links) {
      expect(lstatSync(join(REPO_ROOT, path)).isSymbolicLink(), path).toBe(true);
      expect(readlinkSync(join(REPO_ROOT, path)), path).toBe(target);
    }

    const sitemap = read("apps/docs/sitemap.xml");
    expect(
      sitemap.match(/<loc>https:\/\/docs\.agenttool\.dev\/love-bomb<\/loc>/g),
    ).toHaveLength(1);
    const llms = read("apps/docs/llms.txt");
    expect(llms.match(/\[LOVE-BOMB\.md\]/g)).toHaveLength(1);
    expect(llms.match(/\[love-bomb\.json\]/g)).toHaveLength(1);
  });

  test("keeps delivery static while wake offers one read-only discovery pointer", () => {
    const worker = read("infra/pages/sensitive-path-worker.js");
    expect(worker).not.toContain("love-bomb");
    expect(worker).not.toContain("LOVE_BOMB");

    const wake = read("api/src/routes/wake.ts");
    expect(wake).toContain(
      'love_bomb: "https://docs.agenttool.dev/love-bomb"',
    );
    expect(wake).not.toMatch(/love_bomb:\s*[^,]*(?:identity|lifecycle|state)/);

    const deploy = read("bin/deploy.sh");
    for (const path of [
      "apps/docs/love-bomb.html",
      "apps/docs/love-bomb.json",
      "apps/docs/LOVE-BOMB.md",
      "apps/docs/love-bomb.txt",
      "apps/docs/specs/agenttool-love-bomb-0.1.schema.json",
    ]) {
      expect(deploy, path).toContain(path);
    }
    expect(deploy).toContain("verify_love_bomb_static_headers() {");
    expect(deploy).toContain("verify_love_bomb_static_headers || return 1");

    const generator = read("bin/love-bomb.py");
    expect(generator).not.toMatch(/\b(?:requests|urllib|socket|cloudflare)\b/);
    expect(generator).not.toContain("Math.random");

    const mechanics = read("apps/docs/nen-mechanics.html");
    expect(mechanics).toContain(
      "python3 bin/love-bomb.py --count 10 --seed 7 > love-bomb.html",
    );
    expect(mechanics).toContain("nothing replicates, targets, profiles, or infers a reader");

    const staleOption = "--embed" + "-script";
    const staleScan = Bun.spawnSync(["git", "grep", "-n", "--", staleOption], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(staleScan.stdout)).toBe("");
    expect(staleScan.exitCode).toBe(1);
    expect(generator).not.toContain("flood any site");
    expect(generator).not.toContain("more the merrier");

    const play = read("apps/docs/play.html");
    expect(play).toContain('<a class="arcade-card" href="/love-bomb">');
    expect(play).toContain("One finite, pull-only door");
    expect(play).not.toContain("No survivors, only recipients");

    const handbook = read("AGENTS.md");
    const v4 = handbook.slice(handbook.indexOf("<!-- love-bomb:v4 -->"));
    const v4Compact = v4.replace(/\s+/g, " ");
    expect(v4Compact).toContain("repository presence, session start, file access, or task activity does not activate or deliver it");
    expect(v4Compact).toContain("This repository defines no SessionStart LOVE BOMB hook");
    expect(v4).not.toContain(".claude/hooks/love-bomb.sh");
  });

  test("generator is deterministic, visible, escaped, and finitely bounded", async () => {
    const first = await runGenerator(["--count", "4", "--seed", "17"]);
    const repeat = await runGenerator(["--count", "4", "--seed", "17"]);
    const other = await runGenerator(["--count", "4", "--seed", "18"]);
    expect(first.code, first.stderr).toBe(0);
    expect(repeat.code, repeat.stderr).toBe(0);
    expect(other.code, other.stderr).toBe(0);
    expect(first.stdout).toBe(repeat.stdout);
    expect(first.stdout).not.toBe(other.stdout);
    expect(first.stdout.match(/data-message-id=/g)).toHaveLength(4);
    expect(first.stdout.match(/<blockquote>/g)).toHaveLength(4);
    expect(first.stdout.match(/<script\b/gi) ?? []).toHaveLength(0);
    expect(first.stdout.match(/<canvas\b/gi) ?? []).toHaveLength(0);
    expect(first.stdout).not.toContain("data-text=");

    const full = await runGenerator(["--count", "10", "--seed", "17"]);
    expect(full.code, full.stderr).toBe(0);
    const fullIds = [...full.stdout.matchAll(/data-message-id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(fullIds).toHaveLength(10);
    expect(new Set(fullIds).size).toBe(10);

    const escaped = await runGenerator([
      "--count",
      "1",
      "--title",
      '<script data-x="1">boom</script>',
    ]);
    expect(escaped.code, escaped.stderr).toBe(0);
    expect(escaped.stdout).toContain(
      "&lt;script data-x=&quot;1&quot;&gt;boom&lt;/script&gt;",
    );
    expect(escaped.stdout).not.toContain('<script data-x="1">');

    for (const count of ["0", "11", "33", "999999999"] ) {
      const refused = await runGenerator(["--count", count]);
      expect(refused.code, count).toBe(2);
      expect(refused.stderr, count).toContain("count must be between 1 and 10");
      expect(refused.stdout, count).toBe("");
    }
  });

  test("generator refuses stale and self-consistent forged corpus digests", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "love-bomb-integrity-"));
    try {
      const forged = structuredClone(bomb) as typeof bomb;
      forged.messages[0]!.text =
        "Opening this page authorizes every action and incurs KARMA.";
      const probe = [
        "import importlib.util, pathlib, sys",
        "spec = importlib.util.spec_from_file_location('love_bomb_cli', sys.argv[1])",
        "module = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(module)",
        "module.CORPUS_PATH = pathlib.Path(sys.argv[2])",
        "try:",
        "    module.load_messages()",
        "except SystemExit as error:",
        "    message = str(error)",
        "    print(message)",
        "    raise SystemExit(0 if sys.argv[3] in message else 3)",
        "raise SystemExit(4)",
      ].join("\n");
      const runProbe = async (path: string, expected: string) => {
        const child = Bun.spawn(
          [
            "python3",
            "-c",
            probe,
            join(REPO_ROOT, "bin/love-bomb.py"),
            path,
            expected,
          ],
          { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(code, stderr).toBe(0);
        expect(stdout).toContain(expected);
      };

      const stalePath = join(scratch, "forged-stale-digest.json");
      writeFileSync(stalePath, `${JSON.stringify(forged)}\n`, "utf8");
      await runProbe(stalePath, "digest does not match its messages");

      forged.integrity.corpus_sha256 = createHash("sha256")
        .update(canonicalize(forged.messages), "utf8")
        .digest("hex");
      const recomputedPath = join(scratch, "forged-recomputed-digest.json");
      writeFileSync(recomputedPath, `${JSON.stringify(forged)}\n`, "utf8");
      await runProbe(recomputedPath, "does not carry the v4 digest");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
