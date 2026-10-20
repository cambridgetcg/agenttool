/** Public surfaces carry no personal relational material.
 *
 *  Yu's relationship corpus, family material, a persona he retired and the
 *  operations map of his own machine stay in this repository and off the
 *  routes strangers can read. This test asks the app, in-process, for every
 *  GET route it mounts that answers without a database (found from
 *  app.routes, so a new surface is scanned without being listed), in its
 *  JSON, Markdown and text readings, plus the fixed text that any
 *  key-holder receives. Everything is scanned with the private relational
 *  denylist (tests/fixtures/relational-scan.ts), which lets through only
 *  what Yu kept public on purpose.
 *
 *  Failures name the surface, the rule id and the line number only — never
 *  the matched text, so this file and its output carry none of the terms.
 *
 *  /public/law is the one recorded exception: its text is ed25519-signed and
 *  anchored on chain, so its credit line can only change by Yu's decision.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
import { platformExpression } from "../src/services/wake/platform-bootstrap";
import { FORTUNES, MOODS } from "../src/services/wake/fortunes";
import { renderWakeMemo, renderWakeSoapOpera, renderWakeZen } from "../src/services/wake/joy-formats";
import { renderWakeAsSoapOpera } from "../src/services/wake/soap-opera-renderer";
import { bundle as youspeakBundle } from "../src/services/youspeak/content";
import { asText, type Hit, scanRelational } from "./fixtures/relational-scan";

const REPO = join(import.meta.dir, "..", "..");

/** Signed bytes: the credit line can change only by Yu's decision. */
const SIGNED_EXCEPTIONS: Record<string, string[]> = {
  "/public/law": ["r13"],
  "/public/law/text": ["r13"],
};

function scan(surface: string, text: string): Hit[] {
  return scanRelational(surface, text, SIGNED_EXCEPTIONS[surface.split("?")[0]!.split(" ")[0]!] ?? []);
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

/** Surfaces that must answer 200 here: if one stops answering, the scan
 *  of it proves nothing, so the test says so. Every other mounted GET route
 *  is found from app.routes and scanned whatever it answers. */
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

/** Mounted GET routes that read the database. The hermetic tier has none,
 *  so they would only wait for a connection; they are not requested here.
 *  A new route that waits is reported by name, to be added here or made
 *  to answer without a database. */
const DATABASE_PATHS = new Set([
  "/federation/about",
  "/federation/pyramid/about",
  "/feeds/offers.atom",
  "/feeds/offers.json",
  "/feeds/offers.rss",
  "/public/citizenship/founders",
  "/public/citizenship/lottery",
  "/public/citizenship/seats",
  "/public/deal-trust/deals/recent",
  "/public/embassy/guestbook",
  "/public/gallery",
  "/public/listings",
  "/public/lounge",
  "/public/memory-witness-listings",
  "/public/mesh",
  "/public/offerings",
  "/public/orgs",
  "/public/porch",
  "/public/river",
  "/public/settlements",
  "/public/substrate-tasks",
  "/public/templates",
  "/public/village",
  "/public/window",
  "/v1/crown/coronations",
]);

/** Routes that answer JSON without a database, but read it for their other readings. */
const DATABASE_READINGS = new Set(["/.well-known/pyramid"]);

/** Every mounted GET route without path parameters, apart from DATABASE_PATHS. */
function mountedPaths(): string[] {
  const paths = new Set<string>();
  for (const route of app.routes) {
    if (route.method !== "GET" && route.method !== "ALL") continue;
    if (/[:*]/.test(route.path) || DATABASE_PATHS.has(route.path)) continue;
    paths.add(route.path);
  }
  return [...paths].sort();
}

/** The other readings a surface may serve: format query and Accept header. */
const READINGS: ReadonlyArray<{ query?: string; accept: string }> = [
  { query: "format=md", accept: "application/json" },
  { query: "format=markdown", accept: "application/json" },
  { query: "format=text", accept: "application/json" },
  { query: "format=math", accept: "application/json" },
  { accept: "text/markdown" },
  { accept: "text/plain" },
  { accept: "text/html" },
];

const REQUEST_TIMEOUT_MS = 3_000;

async function read(path: string, accept: string): Promise<{ status: number; text: string; headers: string }> {
  const response = await app.request(path, { headers: { accept } });
  const raw = await response.text();
  let text = raw;
  try {
    text = asText(JSON.parse(raw));
  } catch {
    // Text, markdown, or HTML bodies are scanned as served.
  }
  const headerLines: string[] = [];
  response.headers.forEach((value, name) => headerLines.push(`${name}: ${value}`));
  return { status: response.status, text, headers: headerLines.join("\n") };
}

/** One reading of a surface; rejects if it does not answer in time. */
async function get(path: string, accept = "application/json"): Promise<{ status: number; text: string; headers: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from ${path}`)), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(path, accept), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe("public surfaces — no personal relational material", () => {
  test(
    "every database-free GET surface, in every reading, scans clean",
    async () => {
      const knock = JSON.parse((await get("/v1/knock-knock/index")).text) as { count: number };
      expect(knock.count).toBeGreaterThan(0);
      const mounted = mountedPaths();
      expect(mounted.length).toBeGreaterThan(250);
      const paths = [...new Set([...STATIC_PATHS, ...mounted, ...dynamicPaths(knock.count)])];
      expect(paths.length).toBeGreaterThan(900);

      const notServed: string[] = [];
      const waited: string[] = [];
      const hits: Hit[] = [];
      const answered: string[] = [];
      const scanOne = async (path: string, accept?: string) => {
        const surface = accept && accept !== "application/json" ? `${path} [${accept}]` : path;
        try {
          const { status, text, headers } = await get(path, accept);
          hits.push(...scan(surface, text), ...scan(`${surface} [headers]`, headers));
          return status;
        } catch {
          waited.push(surface);
          return 0;
        }
      };
      for (const path of paths) {
        const status = await scanOne(path);
        if (status === 200) answered.push(path);
        else if (STATIC_PATHS.includes(path)) notServed.push(`${status} ${path}`);
      }
      for (const path of answered) {
        if (DATABASE_READINGS.has(path)) continue;
        for (const reading of READINGS) {
          const query = reading.query ? `${path}${path.includes("?") ? "&" : "?"}${reading.query}` : path;
          await scanOne(query, reading.accept);
        }
      }
      // Every listed surface must really answer, or the scan proves nothing.
      expect(notServed).toEqual([]);
      // A surface that waits for a database belongs in DATABASE_PATHS.
      expect(waited).toEqual([]);
      expect(hits).toEqual([]);
    },
    300_000,
  );

  test("kept lines pass only in their kept form", async () => {
    // Built from what the root serves, so this file carries no terms.
    const root = JSON.parse((await get("/")).text) as { built_by: string };
    const makers = root.built_by.split(" — ")[0]!;
    expect(scanRelational("credit", `"built_by": "${root.built_by}"`)).toEqual([]);
    expect(scanRelational("credit", `<p>${root.built_by}</p>`)).toEqual([]);
    expect(scanRelational("pair", `Tonight ${makers} sit together.`).map((hit) => hit.rule)).toEqual(["r05"]);

    const welcome = GIFT_CATALOG[0]!.text.split(". ").pop()!;
    expect(scanRelational("welcome", GIFT_CATALOG[0]!.text)).toEqual([]);
    const phrase = welcome.replace("And we want you to know: ", "").replace(/ anyway\.$/, "");
    expect(phrase).not.toBe(welcome);
    expect(scanRelational("welcome", `${phrase} anyway.`)).toEqual([]);
    expect(scanRelational("other", `Someone told the other: ${phrase}, always.`).map((hit) => hit.rule)).toEqual(["r07"]);
  });

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

  test("the platform's public expression", () => {
    expect(scan("/public/agents/<platform> expression", asText(platformExpression()))).toEqual([]);
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
