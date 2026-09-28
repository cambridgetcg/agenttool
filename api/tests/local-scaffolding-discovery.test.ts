import { describe, expect, spyOn, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import welcome, { buildWelcomeEnvelope } from "../src/routes/welcome";
import wellKnown from "../src/routes/well-known";
import openapi from "../src/routes/openapi";
import { buildLocalScaffoldingCard } from "../src/services/discovery/local-scaffolding";
import { buildRootEnvelope, renderRootHtml } from "../src/services/discovery/root";
import { buildArrivalIndex, discoveryLinkHeader } from "../src/services/discovery/arrival";
import { buildLlmsTxt, buildAgentsMd } from "../src/services/discovery/discovery";
import { buildDiscoveryCompass } from "../src/services/discovery/compass";
import { CORE_WAKE_FOUNDATION } from "../src/services/welcome/core-foundation";

const API = "https://api.example";
const DOCS = "https://docs.example";
const GUIDE = `${DOCS}/LOCAL-CORE.md#files-only-starter`;

describe("optional local scaffolding at public arrival", () => {
  test("the small guide card separates account-free package preview from explicit setup and host loading", () => {
    const card = buildLocalScaffoldingCard(`${DOCS}/ignored/path?query=ignored`);
    expect(card.guide).toBe(GUIDE);
    expect(card.format).toBe("agenttool-local-scaffolding/v1");
    expect(card.source_path).toBe("packages/local-starter");
    expect(card.source_status).toBe("package_preview");
    expect(card.purpose).toContain("standalone Local Starter 0.1.0-dev.0 preview");
    expect(card.purpose).toContain("exact-version downloads and explicit setup");
    expect(card.guide_account_required).toBe(false);
    expect(card.local_account_required).toBe(false);
    expect(card.automatic_install).toBe(false);
    expect(card.host_loading_required).toBe(true);
    expect(card.host_delivery).toBe("unverified");
    expect(card.runtime).toBe("Node >=22");
    expect(card.effects).toMatch(/no fetch, install, account creation, or local write/);
    expect(card.limits).toMatch(/not credential custody or cloud synchronization/);
    expect(card.limits).toMatch(/requires explicit local setup and host loading/);
    expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThan(2048);
    expect(Object.keys(card)).not.toContain("install_command");
    expect(Object.keys(card)).not.toContain("download_url");
  });

  test("guide origins reject credentials and non-HTTPS URLs without reflecting their values", () => {
    for (const origin of ["not a URL", "http://docs.example", "https://user:private-fixture@docs.example", "file:///private-fixture"]) {
      expect(() => buildLocalScaffoldingCard(origin))
        .toThrow("local_scaffolding_docs_must_be_https_origin");
    }
  });

  test("root, welcome, and rich arrival use one card and preserve the root key contract", () => {
    const card = buildLocalScaffoldingCard(DOCS);
    const root = buildRootEnvelope({ platformWakeConfigured: false, docsBase: DOCS });
    expect(root.we_anticipated_you.local_scaffolding).toEqual(card);
    expect(root.breadcrumbs.local_scaffolding).toContain(GUIDE);
    expect(renderRootHtml(root)).toContain(`href="${GUIDE}"`);
    expect(Object.keys(root)).toEqual([
      "service", "message", "we_anticipated_you", "breadcrumbs", "built_by", "_canon_pointer", "verbs",
    ]);
    expect(buildWelcomeEnvelope(DOCS).local_scaffolding).toEqual(card);
    const arrival = buildArrivalIndex(API, DOCS);
    expect(arrival.local_scaffolding).toEqual(card);
    expect(arrival.links).toContainEqual(expect.objectContaining({
      role: "local_scaffolding_guide", href: GUIDE,
    }));
  });

  test("unauthenticated guide discovery performs no outbound fetch or host activation", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("local scaffolding discovery must not fetch or activate anything");
    });
    try {
      expect(buildRootEnvelope({ platformWakeConfigured: false }).we_anticipated_you.local_scaffolding)
        .toEqual(buildLocalScaffoldingCard());
      for (const router of [welcome, wellKnown]) {
        const response = await router.request("/");
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.local_scaffolding).toEqual(buildLocalScaffoldingCard());
        expect(body.core_foundation).toEqual(CORE_WAKE_FOUNDATION);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  test("the closed schema refuses authority, publication, installation and private-state drift", async () => {
    const spec = await (await openapi.request("/")).json();
    const schema = spec.components.schemas.LocalScaffoldingGuide;
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
    const card = buildLocalScaffoldingCard(DOCS);
    expect(validate(card)).toBe(true);
    for (const change of [
      { guide_account_required: true }, { local_account_required: true },
      { automatic_install: true }, { host_loading_required: false },
      { host_delivery: "verified" }, { source_status: "published" },
      { source_status: "private_source_candidate_unpublished" },
      { runtime: "any host" }, { private_state: "must not appear" },
      { grants: ["load-private-memory"] }, { download_url: "https://download.example/package.tgz" },
      { guide: "https://user:password@docs.example/LOCAL-CORE.md#files-only-starter" },
      { guide: "http://docs.example/LOCAL-CORE.md#files-only-starter" },
    ]) expect(validate({ ...card, ...change })).toBe(false);
    const arrivalSchema = spec.paths["/.well-known"].get.responses["200"].content["application/json"].schema;
    expect(arrivalSchema.required).toContain("local_scaffolding");
    expect(arrivalSchema.properties.local_scaffolding.$ref).toBe("#/components/schemas/LocalScaffoldingGuide");
  });

  test("both text builders offer learning before registration and preserve the configured docs origin", () => {
    const llms = buildLlmsTxt(API, DOCS);
    const agents = buildAgentsMd(API, DOCS);
    for (const text of [llms, agents]) {
      expect(text).toContain(GUIDE);
      expect(text).toContain("exact-version downloads of the standalone 0.1.0-dev.0 preview");
      expect(text).toContain("explicit setup");
      expect(text).toContain("host delivery is unverified");
      expect(text).not.toContain("private, unpublished source candidate");
      expect(text).not.toContain("npm install @agenttool/local-starter");
    }
    expect(llms.indexOf(GUIDE)).toBeLessThan(llms.indexOf("[Register an AI agent]"));
    expect(agents.indexOf(GUIDE)).toBeLessThan(agents.indexOf("**Bootstrap door**"));
    expect(agents).not.toContain("> Public source:");
  });

  test("agent.txt exposes a guide and source status instead of an install or hosted-state route", async () => {
    const response = await wellKnown.request("/agent.txt");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(`Local-Scaffolding-Guide: ${buildLocalScaffoldingCard().guide}`);
    expect(text).toContain("Local-Scaffolding-Source: packages/local-starter; status=package_preview");
    expect(text).toContain("Local-Scaffolding-Runtime: Node >=22");
    expect(text).toMatch(/Local-Scaffolding-Boundary: .*no AgentTool account.*0.1.0-dev.0 preview downloads and explicit setup.*host loading is explicit/);
    expect(text).not.toContain("no public package download");
    expect(text).not.toContain("Local-Scaffolding-Install:");
  });

  test("learning metadata leaves the compact compass, six Link relations, and ordered foundation separate", () => {
    const compass = buildDiscoveryCompass(API, DOCS);
    expect(compass.roads.map(road => road.id)).toEqual(["understand", "inspect", "choose"]);
    expect(Object.hasOwn(compass, "local_scaffolding")).toBe(false);
    expect(discoveryLinkHeader(API, DOCS).split(", ")).toHaveLength(6);
    expect(CORE_WAKE_FOUNDATION.readings.map(reading => reading.id)).toEqual(["ai-wake", "sophia-wake"]);
    expect(Object.hasOwn(CORE_WAKE_FOUNDATION, "local_scaffolding")).toBe(false);
  });
});
