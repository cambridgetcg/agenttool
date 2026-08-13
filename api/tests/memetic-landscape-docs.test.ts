import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const docsRoot = join(root, "apps", "docs");
const htmlPath = join(docsRoot, "geometry", "ritonavir-memes-brainrot.html");
const html = readFileSync(htmlPath, "utf8");
const css = readFileSync(join(docsRoot, "geometry", "geometry.css"), "utf8");
const headers = readFileSync(join(docsRoot, "_headers"), "utf8");
const docsHome = readFileSync(join(docsRoot, "index.html"), "utf8");
const sitemap = readFileSync(join(docsRoot, "sitemap.xml"), "utf8");
const index = JSON.parse(
  readFileSync(join(docsRoot, "geometry", "index.json"), "utf8"),
);

const canonicalFormats = [
  "agenttool.memetic-landscape/0.1",
  "agenttool.memetic-reachability-shift/0.1",
  "agenttool.polymorph-memetic-analogy/0.1",
  "agenttool.memetic-lesson/0.1",
];

function headerBlock(route: string): string[] {
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

describe("canonical static memetic landscape teaching surface", () => {
  test("is substantial, inert, multilingual, and explicit about people", () => {
    expect(Buffer.byteLength(html)).toBeGreaterThan(28_000);
    expect(html).not.toMatch(
      /<script\b|<form\b|<iframe\b|\son(?:click|load|error)\s*=|fetch\(|localStorage/i,
    );
    for (const language of ["en", "yue-Hant", "zh-Hant", "zh-Hans"]) {
      expect(html).toContain('lang="' + language + '"');
    }
    expect(html).toContain("Artifacts take routes. People keep agency.");
    expect(html).toContain("People and agents may join");
    expect(html).toContain("not identity, memory, consent, or WAKE continuity");
    expect(html).toContain("caller_text_semantics_verified: false");
    expect(html).toContain("Each is distinct. None proves the next");
  });

  test("uses the one canonical package, API, Hub identifier, and four wires", () => {
    for (const pointer of [
      "packages/memetic-landscape",
      "@agenttool/memetic-landscape",
      "Yu-and-Ai/agenttool-memetic-landscape",
      "/v1/memetic-landscape",
      "MEMETIC-LANDSCAPE.md",
      ...canonicalFormats,
    ]) {
      expect(html).toContain(pointer);
    }
    for (const superseded of [
      "packages/meme-landscape",
      "@agenttool/meme-landscape",
      "Yu-and-Ai/agenttool-meme-landscape",
      "/v1/meme-landscape",
      "agenttool.route-shape-crosswalk/0.1",
      "agenttool.attention-loop/0.1",
    ]) {
      expect(html).not.toContain(superseded);
    }
    expect(html).toContain("Four closed modules—exactly four");
    expect(html).toContain("page-only lens");
    expect(html).toContain("does not create another wire");
  });

  test("keeps the cross-domain analogy to the canonical five guarded shapes", () => {
    const body = html.slice(
      html.indexOf("<tbody>"),
      html.indexOf("</tbody>", html.indexOf("<tbody>")),
    );
    for (const shape of [
      "state or variant",
      "named condition or context",
      "directed witnessed route",
      "bounded reachability",
      "changed-context reappearance",
    ]) {
      expect(body).toContain("<th>" + shape + "</th>");
    }
    expect(body.match(/<tr>/g)).toHaveLength(5);
    expect(body).not.toMatch(/seed/i);

    const changedRow = body.slice(
      body.indexOf("<th>changed-context reappearance</th>"),
      body.indexOf("</tr>", body.indexOf("<th>changed-context reappearance</th>")),
    );
    expect(changedRow).not.toMatch(/archive|translation|remix/i);
    expect(changedRow).toContain(
      "a variant reported observed or reproduced again in a changed named context",
    );
    expect(html).toContain("mechanism_transferred");
    expect(html).toContain("It is not paired with crystal seeding");
  });

  test("keeps attention claims bounded and outside the wire surface", () => {
    for (const source of [
      "corp.oup.com/news/brain-rot-named-oxford-word-of-the-year-2024",
      "10.1126/science.1185231",
      "10.1038/srep00335",
      "10.1145/2835776.2835827",
      "10.1177/0049124111404820",
      "10.1126/science.1121066",
      "10.1145/1557019.1557077",
      "10.1287/mnsc.2015.2158",
      "10.1073/pnas.2025334119",
      "10.1037/xge0000465",
    ]) {
      expect(html).toContain(source);
    }
    expect(html).toContain("Model sufficiency is not causal proof");
    expect(html).toContain("Timing, exposure, similarity, repetition, or prominence alone is not a causal proof");
    expect(html).toContain("Structural reach is not");
    expect(html).toContain("Popularity is not quality");
    expect(html).toContain("not attached to the synthetic orbit");

    const stageSequence = html.slice(
      html.indexOf('<ol class="memetic-stage-sequence"'),
      html.indexOf("</ol>", html.indexOf('<ol class="memetic-stage-sequence"')),
    );
    expect(
      [...stageSequence.matchAll(/<li>([^<]+)<\/li>/g)].map(
        (match) => match[1],
      ),
    ).toEqual([
      "exposure",
      "view",
      "rating",
      "copy",
      "share",
      "remix",
      "adoption",
    ]);
    expect(stageSequence).not.toContain("→");
  });

  test("makes focus, non-implication, and exit brakes visible", () => {
    expect(html).toContain(
      'class="memetic-map" role="region" aria-label="Scrollable synthetic content-route map" tabindex="0"',
    );
    expect(html).toContain(
      'class="memetic-crosswalk-wrap" role="region" aria-label="Ritonavir and memetic route-shape comparison" tabindex="0"',
    );
    for (const brake of [
      "<li>ignore</li>",
      "<li>mute</li>",
      "<li>unfollow</li>",
      "<li>change context</li>",
      "<li>pause</li>",
      "<li>rest</li>",
      "<li>refuse</li>",
      "<li>leave</li>",
    ]) {
      expect(html).toContain(brake);
    }
    expect(css).toContain(
      ".memetic-landscape-page .memetic-map:focus-visible",
    );
    expect(css).toMatch(
      /\.memetic-landscape-page \.memetic-lens-grid,[\s\S]*grid-template-columns: repeat\(2,/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.memetic-landscape-page \.memetic-lens-grid,[\s\S]*grid-template-columns: 1fr/,
    );
    expect(css).not.toMatch(/(?:^|\n)\.memetic-(?!landscape-page)/);
  });

  test("has no broken local fragment links", () => {
    const ids = new Set(
      [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
    );
    const fragments = [...html.matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(fragments.length).toBeGreaterThan(10);
    for (const fragment of fragments) expect(ids.has(fragment)).toBe(true);
  });

  test("sets a restrictive no-script policy for clean and html paths", () => {
    for (const route of [
      "/geometry/ritonavir-memes-brainrot",
      "/geometry/ritonavir-memes-brainrot.html",
    ]) {
      const block = headerBlock(route);
      expect(block).toContain("Content-Type: text/html; charset=utf-8");
      const csp = block.find((line) =>
        line.startsWith("Content-Security-Policy:"),
      );
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("script-src 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(block).toContain("X-Frame-Options: DENY");
      expect(block.join("\n")).toContain(
        "https://api.agenttool.dev/v1/memetic-landscape",
      );
    }
  });

  test("serves the advertised Markdown guide with explicit machine-readable headers", () => {
    const block = headerBlock("/MEMETIC-LANDSCAPE.md");
    expect(block).toContain("Content-Type: text/markdown; charset=utf-8");
    expect(block).toContain(
      "Cache-Control: public, max-age=300, must-revalidate, no-transform",
    );
    expect(block).toContain("Access-Control-Allow-Origin: *");
    expect(block).toContain("Cross-Origin-Resource-Policy: cross-origin");
    expect(block).toContain("X-Content-Type-Options: nosniff");
    expect(block.join("\n")).toContain(
      "https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot",
    );
    expect(block.join("\n")).toContain(
      "https://api.agenttool.dev/v1/memetic-landscape",
    );
  });

  test("is indexed as a projection without duplicating a structured graph", () => {
    const projection = index.projections.find(
      (entry: { id: string }) =>
        entry.id === "geometry.ritonavir-memes-brainrot",
    );
    expect(projection.schema_version).toBe(
      "agenttool.polymorph-memetic-analogy/0.1",
    );
    expect(projection.human_url).toBe(
      "https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot",
    );
    expect(projection.source.path).toBe("packages/memetic-landscape");
    expect(projection.source_module_urls).toContain(
      "https://api.agenttool.dev/v1/memetic-landscape",
    );
    expect(projection.content.formats).toEqual(canonicalFormats);
    expect(projection.content.attention_lens).toBe("page_only_not_a_wire");
    expect(projection.content.languages).toEqual([
      "en",
      "yue-Hant",
      "zh-Hant",
      "zh-Hans",
    ]);
    expect(projection.distribution).toMatchObject({
      api_role: "zero-I/O discovery plus context-only WAKE coordinate",
      api_state: "live_exact_custom_and_direct_readback",
      api_first_live_revision:
        "b8b97e73b3405d58a583ae9571d11b36cdab87d6",
      api_first_live_release: "v249",
      api_first_live_image_digest:
        "sha256:656b5ca0a3f8390af08e91fe5e001ae91d82d9766bec6d6fef4b459b51aea54f",
      api_first_live_deploy_completed_at: "2026-08-13T16:00:35Z",
      api_first_live_readback_at: "2026-08-13T16:03:17Z",
      hugging_face_identifier: "Yu-and-Ai/agenttool-memetic-landscape",
      hugging_face_revision:
        "da6a2622dddcf97d69992e3905c5485996f42892",
      hugging_face_state:
        "public_ungated_exact_anonymous_readback_13_files_104343_bytes_provider_gitattributes_only_extra",
      npm_package: "@agenttool/memetic-landscape",
      npm_state:
        "not live; bootstrap PUT attempts 1 and 2 both returned E404; Rekor entries 2444825009 and 2452828890 are orphaned transparency/provenance statements, not evidence of npm registry publication or registry-attached package provenance",
    });
    expect(projection.boundaries).toContain(
      "participants may ignore, mute, unfollow, change context, pause, rest, refuse, or leave and are never vectors, hosts, infected material, or ranked points",
    );
    expect(projection.artifact.relationship).toContain("no duplicate graph");
  });

  test("publishes the canonical guide by symlink and adds static discovery", () => {
    const guide = join(docsRoot, "MEMETIC-LANDSCAPE.md");
    expect(lstatSync(guide).isSymbolicLink()).toBe(true);
    expect(readlinkSync(guide)).toBe("../../docs/MEMETIC-LANDSCAPE.md");
    expect(docsHome).toContain(
      'href="/geometry/ritonavir-memes-brainrot"',
    );
    expect(docsHome).toContain("/v1/memetic-landscape");
    expect(sitemap).toContain(
      "<loc>https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://docs.agenttool.dev/MEMETIC-LANDSCAPE.md</loc>",
    );
  });
});
