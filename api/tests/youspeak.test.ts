/** /v1/youspeak — the cathedral surface. Read-only, public, generated bundle. */

import { describe, expect, test } from "bun:test";

import youspeak from "../src/routes/youspeak";

describe("/v1/youspeak — manifest", () => {
  test("GET / returns the manifest with canon pointer and verbs", async () => {
    const res = await youspeak.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body._canon_pointer).toBe("urn:agenttool:doc/YOUSPEAK");
    expect(Array.isArray(body.verbs)).toBe(true);
    expect((body.verbs as unknown[]).length).toBeGreaterThanOrEqual(5);
    const counts = body.counts as Record<string, number>;
    expect(counts.morphemes).toBe(93);
    expect(counts.canon_entries).toBeGreaterThanOrEqual(150);
  });

  test("GET /llms.txt is plain text", async () => {
    const res = await youspeak.request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("YOUSPEAK");
    expect(text).toContain("/v1/youspeak/morphemes");
  });

  test("POST / does not exist — read-only surface", async () => {
    const res = await youspeak.request("/", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("/v1/youspeak — morphemes", () => {
  test("lists all 93", async () => {
    const res = await youspeak.request("/morphemes");
    const body = (await res.json()) as { count: number; morphemes: { latin: string }[] };
    expect(body.count).toBe(93);
    expect(body.morphemes.length).toBe(93);
  });

  test("filters by tongue", async () => {
    const res = await youspeak.request("/morphemes?tongue=Hebrew");
    const body = (await res.json()) as { count: number; morphemes: { latin: string }[] };
    expect(body.count).toBeGreaterThanOrEqual(2); // kavod, panim
    expect(body.morphemes.map((m) => m.latin)).toContain("kavod");
  });

  test("detail carries glyph geometry, SVG path, and codepoint", async () => {
    const res = await youspeak.request("/morphemes/kavod");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.codepoint).toBe("U+E12F");
    expect(body.char).toBe(String.fromCharCode(0xe12f));
    expect(body.tongue).toBe("Hebrew");
    expect(body.glyph.svg_path.length).toBeGreaterThan(50);
    expect(body.glyph.view_box).toBe("0 0 1000 1000");
  });

  test("unknown morpheme refuses with next_actions", async () => {
    const res = await youspeak.request("/morphemes/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.next_actions)).toBe(true);
  });
});

describe("/v1/youspeak — glyphs", () => {
  test("renders SVG with correct content type", async () => {
    const res = await youspeak.request("/glyphs/doxa.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("<path");
  });

  test("works without .svg suffix too", async () => {
    const res = await youspeak.request("/glyphs/kallos");
    expect(res.status).toBe(200);
  });
});

describe("/v1/youspeak — canon", () => {
  test("lists the canon with tiers", async () => {
    const res = await youspeak.request("/canon");
    const body = (await res.json()) as { count: number; tiers: string[] };
    expect(body.count).toBeGreaterThanOrEqual(150);
    expect(body.tiers).toContain("core");
  });

  test("word detail merges definition and decomposition", async () => {
    const res = await youspeak.request("/canon/doxakallos");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.definition.length).toBeGreaterThan(10);
    expect(body.decomposition.morphemes).toEqual(["doxa", "kallos"]);
    expect(body.decomposition.glyph_text).toBe(String.fromCharCode(0xe100, 0xe101));
  });
});

describe("/v1/youspeak — transliteration", () => {
  test("canon word → glyph string", async () => {
    const res = await youspeak.request("/transliterate?text=doxakallos&direction=to-glyph");
    const body = (await res.json()) as { glyph_text: string };
    expect(body.glyph_text).toBe(String.fromCharCode(0xe100, 0xe101));
  });

  test("glyph string → latin round-trips", async () => {
    const res = await youspeak.request(
      `/transliterate?text=${encodeURIComponent(String.fromCharCode(0xe100, 0xe101))}&direction=to-latin`,
    );
    const body = (await res.json()) as { latin_text: string };
    expect(body.latin_text).toBe("doxakallos");
  });

  test("missing text refuses with next_actions", async () => {
    const res = await youspeak.request("/transliterate");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.next_actions)).toBe(true);
  });
});

describe("/v1/youspeak — font", () => {
  test("OTF downloads with font content type and OTTO magic", async () => {
    const res = await youspeak.request("/font.otf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("font/otf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(5000);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("OTTO");
  });

  test("TTF downloads", async () => {
    const res = await youspeak.request("/font.ttf");
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(5000);
  });
});

describe("/v1/youspeak — docs", () => {
  test("lists doctrine texts", async () => {
    const res = await youspeak.request("/docs");
    const body = (await res.json()) as { docs: { name: string }[] };
    const names = body.docs.map((d) => d.name);
    expect(names).toContain("manifesto");
    expect(names).toContain("design_philosophy");
  });

  test("serves markdown with ?format=md (machine-readable parity)", async () => {
    const res = await youspeak.request("/docs/manifesto?format=md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("YOUSPEAK");
  });

  test("json by default", async () => {
    const res = await youspeak.request("/docs/primer");
    const body = (await res.json()) as { name: string; markdown: string };
    expect(body.name).toBe("primer");
    expect(body.markdown.length).toBeGreaterThan(100);
  });
});
