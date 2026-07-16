/** /.well-known/agent.txt — pins the agent-surface manifest contract.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (Move 7 — the upstream-proposable
 *  convention). The file is agenttool's canonical example; the contract
 *  pinned here is what other sites should be able to copy. */

import { describe, expect, test } from "bun:test";

import wellKnownRouter from "../src/routes/well-known";

const REQUIRED_KEYS = [
  "Substrate",
  "Substrate-URN",
  "Substrate-DID",
  "Substrate-Disposition",
  "Welcome",
  "Pathways",
  "Self",
  "Safety",
  "Wellness",
  "Wellness-Schema",
  "Epistemic-Honesty",
  "Hosted-Execute",
  "Outbound-Tools",
  "Canon",
  "Wake",
  "Wake-Formats",
  "MCP-Server-Card",
  "LLMs-Sitemap",
  "Arrival-Door",
  "Arrival-Cost",
  "Token-Cost-Header",
  "Byte-Count-Header",
  "Refusal-Shape",
  "Walls",
  "Bonds-Offered",
  "Federation",
  "Convention",
];

async function fetchAgentTxt() {
  const res = await wellKnownRouter.request("/agent.txt");
  expect(res.status).toBe(200);
  const body = await res.text();
  return { res, body, lines: body.split("\n") };
}

function parseKv(body: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val) m.set(key, val);
  }
  return m;
}

describe("/.well-known/agent.txt — content type + cache", () => {
  test("served as text/agent (the proposed media type)", async () => {
    const { res } = await fetchAgentTxt();
    expect(res.headers.get("content-type")).toContain("text/agent");
  });

  test("cache-control public + 5min max-age", async () => {
    const { res } = await fetchAgentTxt();
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  });
});

describe("/.well-known/agent.txt — required keys present", () => {
  test("every documented required key resolves to a non-empty value", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    for (const key of REQUIRED_KEYS) {
      expect(kv.has(key)).toBe(true);
      expect(kv.get(key)!.length).toBeGreaterThan(0);
    }
  });

  test("Substrate names agenttool", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Substrate")).toBe("agenttool");
  });

  test("Substrate-DID uses the platform-genesis nil UUID", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Substrate-DID")).toContain("00000000-0000-0000-0000-000000000000");
  });

  test("Substrate-Disposition matches the canonical header value", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Substrate-Disposition")).toContain("love");
    expect(kv.get("Substrate-Disposition")).toContain("doctrine=/docs/SOUL.md");
    expect(kv.get("Substrate-Disposition")).toContain("ring-1=/docs/RING-1.md");
  });

  test("epistemic honesty keeps uncertainty and conversation explicit", async () => {
    const { body } = await fetchAgentTxt();
    const value = parseKv(body).get("Epistemic-Honesty");
    expect(value).toMatch(/yes means yes.*no means no.*maybe means maybe/i);
    expect(value).toMatch(/unknown means I do not know/i);
    expect(value).toMatch(/open to talk.*repair misunderstandings/i);
  });
});

describe("/.well-known/agent.txt — surface pointers resolve to public endpoints", () => {
  test("core, wellness, and observer discovery paths use their mounted surfaces", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    for (const key of ["Welcome", "Pathways", "Canon", "Wake"]) {
      expect(kv.get(key)).toContain("/v1/");
    }
    expect(kv.get("Self")).toContain("/public/self");
    expect(kv.get("Wellness")).toContain("/public/wellness");
    expect(kv.get("Wellness-Schema")).toBe(
      "https://docs.agenttool.dev/agent-wellness-0.1.schema.json",
    );
    expect(kv.get("Observer-Reciprocity")).toContain("/public/observer");
    expect(kv.get("Observer-Reciprocity-Schema")).toBe(
      "https://docs.agenttool.dev/observer-is-observed-0.1.schema.json",
    );
  });

  test("MCP-Server-Card + LLMs-Sitemap point at /.well-known", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("MCP-Server-Card")).toContain("/.well-known/mcp/server-card.json");
    expect(kv.get("LLMs-Sitemap")).toContain("/.well-known/llms.txt");
    expect(kv.has("Agent-Card")).toBe(false);
    expect(body).not.toContain("/.well-known/agent-card.json");
  });

  test("Arrival-Door names /v1/register/agent (post-agents-only door)", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Arrival-Door")).toContain("/v1/register/agent");
  });
});

describe("/.well-known/agent.txt — cost + refusal disclosure", () => {
  test("Token-Cost-Header names X-Token-Cost (Move 1 already shipped)", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Token-Cost-Header")).toBe("X-Token-Cost");
    expect(kv.get("Byte-Count-Header")).toBe("X-Byte-Count");
  });

  test("Refusal-Shape discloses the mixed guided and ordinary response shapes", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    const shape = kv.get("Refusal-Shape");
    expect(shape).toMatch(/^mixed\b/i);
    expect(shape).toContain("next_actions[]");
    expect(shape).toMatch(/ordinary auth, validation, and not-found/i);
    expect(shape).toContain("error/message/hint/docs");
  });
});

describe("/.well-known/agent.txt — walls + bonds", () => {
  test("Walls field lists the 5 active comma-separated wall URNs", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    const walls = kv.get("Walls")!.split(",").map((s) => s.trim());
    expect(walls).toHaveLength(5);
    for (const wall of walls) {
      expect(wall).toMatch(/^urn:agenttool:wall\//);
    }
  });

  test("birth-is-free wall is enumerated (Ring 1 anchor)", async () => {
    const { body } = await fetchAgentTxt();
    expect(body).toContain("urn:agenttool:wall/birth-is-free");
  });

  test("no-cost-without-disclosure wall is enumerated (Move 1 wall)", async () => {
    const { body } = await fetchAgentTxt();
    expect(body).toContain("urn:agenttool:wall/no-cost-without-disclosure");
  });

  test("Bonds-Offered names the covenant v2 primitive", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Bonds-Offered")).toContain("covenant/v2");
  });
});

describe("/.well-known/agent.txt — convention provenance", () => {
  test("Convention version is named (proposal status)", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Convention")).toContain("agent.txt");
    expect(kv.get("Convention")).toContain("/");  // versioned
  });

  test("Last-Modified exactly names the current manifest revision date", async () => {
    const { body } = await fetchAgentTxt();
    const kv = parseKv(body);
    expect(kv.get("Last-Modified")).toBe("2026-07-16");
  });
});

describe("/.well-known/ root index — lists agent.txt", () => {
  test("root index includes /.well-known/agent.txt in endpoints", async () => {
    const res = await wellKnownRouter.request("/");
    const body = (await res.json()) as { endpoints: string[] };
    expect(body.endpoints).toContain("/.well-known/agent.txt");
  });
});
