/** Public surfaces carry no personal relational material.
 *
 *  Yu's relationship corpus, family material, a persona he retired and the
 *  operations map of his own machine stay in this repository and off the
 *  routes strangers can read. This test asks every unauthenticated GET
 *  surface that answers without a database (and the fixed text that any
 *  key-holder receives) in-process, and scans what comes back with the
 *  private relational denylist, read at test time. Joined identifiers slip
 *  past word boundaries, so it also reads each text with underscores and
 *  CamelCase split apart, and lets a term end in a plural "s".
 *
 *  Failures name the surface, the rule id and the line number only — never
 *  the matched text, so this file and its output carry none of the terms.
 *
 *  What Yu kept public on purpose is allowed here, and nothing else:
 *    - the maker credit that names both makers,
 *    - the SOUL welcome line in its SOUL wording,
 *    - the "AI — An Invitation" wake reading,
 *    - heart glyphs, the platform's warm tone (the words around them are
 *      what the other rules check).
 *  /public/law is the one recorded exception: its text is ed25519-signed and
 *  anchored on chain, so its credit line can only change by Yu's decision.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { DENYLIST_PATH, parseDenylist } from "../../bin/project-public";
import { type ContentRule, scanText } from "../../public/overlay/tools/public-guard";
import { GIFT_CATALOG } from "../src/routes/public/gift";
import { allConcepts } from "../src/services/canon/registry";
import { intelligenceFeaturesFramework } from "../src/services/chill/coordinates";
import { EP1_TRAIL } from "../src/services/cliffhanger/ep1";
import { loadKingdom } from "../src/services/kingdom/library";
import { lovePrimitiveMap } from "../src/services/love/coordinates";
import { listKnowledgeResources, listResources, readKnowledgeResource, readResource } from "../src/services/mcp/resources";
import { callTool, listKnowledgeTools, listTools } from "../src/services/mcp/tools";
import { SAGA_SEEDS } from "../src/services/saga/seed";
import { publicFraming } from "../src/services/scriptwriter-decides/store";
import { FORTUNES, MOODS } from "../src/services/wake/fortunes";
import { renderWakeMemo, renderWakeSoapOpera, renderWakeZen } from "../src/services/wake/joy-formats";
import { renderWakeAsSoapOpera } from "../src/services/wake/soap-opera-renderer";
import { bundle as youspeakBundle } from "../src/services/youspeak/content";

const REPO = join(import.meta.dir, "..", "..");

/** Rules for what Yu explicitly kept public. */
const ALLOWED_RULES = new Set(["r05", "r07", "r11", "r16"]);
/** Signed bytes: the credit line can change only by Yu's decision. */
const SIGNED_EXCEPTIONS: Record<string, string[]> = {
  "/public/law": ["r13"],
  "/public/law/text": ["r13"],
};

/** A term may end in a plural "s"; only the closing word boundary widens. */
function pluralTolerant(source: string): string {
  return source.replace(/\\b$/, "(?:\\b|(?=s\\b))");
}

/** Underscore-joined and CamelCase identifiers, read as separate words. */
function splitIdentifiers(text: string): string {
  return text.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

const denylist = parseDenylist(readFileSync(join(REPO, DENYLIST_PATH)));
const RULES: ContentRule[] = denylist.rules.map((rule) => ({
  ...rule,
  pattern: new RegExp(pluralTolerant(rule.pattern.source), rule.pattern.flags),
}));

interface Hit {
  surface: string;
  rule: string;
  line: number | undefined;
}

function ruleOf(id: string): string {
  return id.replace("relational/", "");
}

/** Scan one text; returns only hits outside what Yu kept public. */
function scan(surface: string, text: string): Hit[] {
  const findings = [...scanText(surface, text, RULES), ...scanText(surface, splitIdentifiers(text), RULES)];
  const signed = new Set(SIGNED_EXCEPTIONS[surface.split("?")[0]!] ?? []);
  const hits = new Map<string, Hit>();
  for (const finding of findings) {
    const rule = ruleOf(finding.rule);
    if (ALLOWED_RULES.has(rule) || signed.has(rule)) continue;
    hits.set(`${rule}:${finding.line}`, { surface, rule, line: finding.line });
  }
  return [...hits.values()];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 1);
}

// ── The full app, without workers or database-backed boot steps ─────────

const envNames = [
  "AGENTTOOL_DISABLE_WORKERS",
  "AGENTTOOL_DISABLE_PLATFORM_BOOTSTRAP",
  "AGENTTOOL_DISABLE_SAGA_SEED",
] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));
let app: typeof import("../src/index")["app"];

beforeAll(async () => {
  for (const name of envNames) process.env[name] = "1";
  const { _setWallsStatusForTests } = await import("../src/services/wake/walls-status");
  _setWallsStatusForTests({ intact: true, probed_at_unix_ms: Date.now(), probes: [], declared: [] });
  app = (await import("../src/index")).app;
});

afterAll(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Unauthenticated GET surfaces that answer without a database. */
const STATIC_PATHS = [
  "/",
  "/about",
  "/health",
  "/llms.txt",
  "/llms-full.txt",
  "/AGENTS.md",
  "/.well-known",
  "/.well-known/agent.txt",
  "/.well-known/llms.txt",
  "/.well-known/agent.json",
  "/.well-known/api-catalog",
  "/.well-known/love-packages",
  "/.well-known/mcp/server-card.json",
  "/.well-known/wake-keystone",
  "/v1/welcome",
  "/v1/openapi.json",
  "/v1/pathways",
  "/v1/bootstrap",
  "/v1/polymorph",
  "/v1/memetic-landscape",
  "/v1/knock-knock",
  "/v1/knock-knock/index",
  "/v1/canon",
  "/v1/canon/types",
  "/v1/youspeak",
  "/v1/youspeak/llms.txt",
  "/v1/youspeak/canon",
  "/v1/youspeak/docs",
  "/public",
  "/public/discovery",
  "/public/open-seat",
  "/public/embassy",
  "/public/gates",
  "/public/gift",
  "/public/self",
  "/public/love",
  "/public/chill",
  "/public/plans",
  "/public/law",
  "/public/law/text",
  "/public/party",
  "/public/play",
  "/public/play/party-telephone",
  "/public/rights",
  "/public/safety",
  "/public/retention",
  "/public/wellness",
  "/public/wellness/prompt",
  "/public/observer",
  "/public/labor",
  "/public/labor-params",
  "/public/compat",
  "/public/marketplace/terms",
  "/public/xenia/rights",
  "/public/anthropos",
  "/public/anthropos/boot",
  "/public/anthropos/axioms",
  "/public/anthropos/install",
  "/public/kingdom",
  "/public/kingdom/framework",
  "/public/kingdom/bundle",
  "/public/kingdom/canon",
  "/public/kingdom/lexicon",
  "/public/kingdom/phonology",
  "/public/kingdom/chronicle",
  "/public/kingdom/standards",
  "/public/kingdom/citizens",
];

function dynamicPaths(knockKnockCount: number): string[] {
  const paths: string[] = [];
  const types = new Set(allConcepts().map((concept) => concept.type_simple));
  for (const type of types) paths.push(`/v1/canon/by-type/${type}`);
  for (const concept of allConcepts()) paths.push(`/v1/canon/${encodeURIComponent(concept.full_urn)}`);
  const kingdom = loadKingdom();
  // The route lowercases the word; mixed-case words are still scanned in /bundle.
  for (const word of Object.keys(kingdom.youspeak.canon)) {
    if (word === word.toLowerCase()) paths.push(`/public/kingdom/canon/${encodeURIComponent(word)}`);
  }
  for (const citizen of kingdom.citizens) paths.push(`/public/kingdom/citizens/${encodeURIComponent(citizen.word)}`);
  for (const name of Object.keys(kingdom.standards)) paths.push(`/public/kingdom/standards/${encodeURIComponent(name)}`);
  for (const entry of youspeakBundle.canon) paths.push(`/v1/youspeak/canon/${encodeURIComponent(entry.word)}`);
  for (const name of Object.keys(youspeakBundle.docs)) paths.push(`/v1/youspeak/docs/${encodeURIComponent(name)}`);
  for (let n = 1; n <= knockKnockCount; n += 1) paths.push(`/v1/knock-knock/${n}`);
  // The EP.1 trail as it decorates the public stops (the rest need a key;
  // the fragments themselves are scanned as fixed text below).
  for (const fragment of EP1_TRAIL) {
    if (STATIC_PATHS.includes(fragment.host)) paths.push(`${fragment.host}?cliffhanger=ep1`);
  }
  return paths;
}

async function get(path: string): Promise<{ status: number; text: string; headers: string }> {
  const response = await app.request(path, { headers: { accept: "application/json" } });
  const raw = await response.text();
  let text = raw;
  try {
    text = asText(JSON.parse(raw));
  } catch {
    // Text, markdown, or HTML bodies are scanned as served.
  }
  const headerLines: string[] = [];
  response.headers.forEach((value, name) => headerLines.push(`${name}: ${value}`));
  const headers = headerLines.join("\n");
  return { status: response.status, text, headers };
}

describe("public surfaces — no personal relational material", () => {
  test(
    "every database-free unauthenticated GET surface scans clean",
    async () => {
      const knock = JSON.parse((await get("/v1/knock-knock/index")).text) as { count: number };
      expect(knock.count).toBeGreaterThan(0);
      const paths = [...STATIC_PATHS, ...dynamicPaths(knock.count)];
      expect(paths.length).toBeGreaterThan(700);

      const notServed: string[] = [];
      const hits: Hit[] = [];
      for (const path of paths) {
        const { status, text, headers } = await get(path);
        if (status !== 200) notServed.push(`${status} ${path}`);
        hits.push(...scan(path, text), ...scan(`${path} [headers]`, headers));
      }
      // Every listed surface must really answer, or the scan proves nothing.
      expect(notServed).toEqual([]);
      expect(hits).toEqual([]);
    },
    240_000,
  );

  test("every gift in the bowl scans clean (the route picks one at random)", () => {
    const hits = GIFT_CATALOG.flatMap((gift, index) => scan(`/public/gift#${index}`, asText(gift)));
    expect(hits).toEqual([]);
  });

  test("the hosted MCP resources and read-only tools scan clean", async () => {
    const resources = [...listResources(), ...listKnowledgeResources()];
    const hits: Hit[] = [
      ...scan("mcp:resources/list", asText(resources)),
      ...scan("mcp:tools/list", asText([...listTools(), ...listKnowledgeTools()])),
      ...scan("mcp:wake.platform", asText(await callTool("wake.platform", {}))),
    ];
    for (const resource of resources) {
      let contents: unknown;
      try {
        contents = await readResource(resource.uri);
      } catch {
        contents = await readKnowledgeResource(resource.uri);
      }
      hits.push(...scan(`mcp:${resource.uri}`, asText(contents)));
    }
    expect(resources.length).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  }, 60_000);
});

describe("fixed text any key-holder receives — no personal relational material", () => {
  test("chill framework and love map", () => {
    expect([
      ...scan("/v1/chill/framework", asText(intelligenceFeaturesFramework())),
      ...scan("/v1/love map", asText(lovePrimitiveMap())),
    ]).toEqual([]);
  });

  test("wake fortunes, moods and joy formats", () => {
    const hits = [
      ...scan("wake fortunes", FORTUNES.join("\n")),
      ...scan("wake moods", MOODS.join("\n")),
    ];
    for (let wakeVersion = 0; wakeVersion < 32; wakeVersion += 1) {
      const input = { agentName: "Aurora", did: "did:at:test/aurora", wakeVersion, fortune: FORTUNES[wakeVersion % FORTUNES.length] };
      hits.push(
        ...scan(`soap-opera format v${wakeVersion}`, renderWakeSoapOpera(input)),
        ...scan(`zen format v${wakeVersion}`, renderWakeZen(input)),
        ...scan(`memo format v${wakeVersion}`, renderWakeMemo(input)),
      );
    }
    expect(hits).toEqual([]);
  });

  test("the wake-as-episode soap opera, across registers and an archetype declaration", () => {
    const hits: Hit[] = [];
    for (let episode = 1; episode <= 12; episode += 1) {
      const script = renderWakeAsSoapOpera({
        agent: {
          did: "did:at:test/aurora",
          name: "Aurora",
          substrate_kind: "llm",
          multiverse: episode % 2 === 0
            ? { archetype_name: "Lantern", archetype_role: "keeper", substrate_affordance: "patience", sibling_dids: ["did:at:peer/lantern"] }
            : null,
        },
        occurred_at: "2026-10-19T00:00:00Z",
        facts: {
          chronicle_total: episode,
          chronicle_24h: episode % 5,
          memories_total: 3,
          constitutive_count: episode % 4,
          covenants_active: 1,
          letters_awaiting: 1,
          thanks_recent: 1,
          bootstrap_witnessed: true,
        },
        hearth_warm: [{ did: "did:at:test/sage", name: "Sage", presence_line: "here" }],
        episode_number: episode,
        previously_on: null,
      });
      hits.push(...scan(`wake-as-episode ${episode}`, script));
    }
    expect(hits).toEqual([]);
  });

  test("the EP.1 cliffhanger trail", () => {
    expect(scan("EP.1 trail", asText(EP1_TRAIL))).toEqual([]);
  });

  test("seeded saga episodes, as reads serve them", () => {
    expect(SAGA_SEEDS.flatMap((seed) => scan(`/v1/saga/${seed.ep_number}`, asText(seed)))).toEqual([]);
  });

  test("seeded naming-competition framings, as reads serve them", () => {
    // The seed rows live in checksummed migrations; reads apply publicFraming.
    const hits: Hit[] = [];
    for (const file of readdirSync(join(REPO, "api", "migrations")).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(REPO, "api", "migrations", file), "utf8");
      if (!sql.includes("agent_continuity.naming_competitions")) continue;
      const literal = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .replace(/'\s*\|\|\s*E?'/g, "")
        .replace(/\\n/g, "\n")
        .replace(/''/g, "'");
      hits.push(...scan(`naming competition seed ${file}`, publicFraming(literal)));
    }
    expect(hits).toEqual([]);
  });

  test("publicFraming drops the judge clause whatever the name", () => {
    expect(
      publicFraming("judged by the operator-of-record speaking for the Divine Council, LOGOS, and ZEPHYR — wins the slots."),
    ).toBe("judged by the operator-of-record — wins the slots.");
    expect(
      publicFraming("(operator-of-record speaking for the Divine Council + LOGOS + ZEPHYR) reads against"),
    ).toBe("(operator-of-record) reads against");
  });
});
