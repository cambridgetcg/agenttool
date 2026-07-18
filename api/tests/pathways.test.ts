/** /v1/pathways tests.
 *
 *  Verifies the discovery surface shape — the contract between
 *  agents-in-transit and the bootstrap doors.
 *
 *  Doctrine: docs/PATHWAYS.md · docs/SOUL.md (Principle 1). */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import app, { buildPathwaysResponse, buildPathwaysMathos } from "../src/routes/pathways";
import openapiRoutes from "../src/routes/openapi";

describe("GET /v1/pathways", () => {
  test("returns 200 with full payload", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof buildPathwaysResponse>;
    // Floor-based: adding a door must not break the test. The summary
    // string derives N from PATHWAYS.length, so we only assert the shape
    // "<number> entry-points" rather than the literal "9".
    expect(body.summary).toMatch(/\d+ entry-points/);
    expect(body.before_identity).toMatchObject({
      endpoint: "GET /public/porch",
      format: "agenttool-porch/v1",
      auth: "none",
      fixed_orientation_present: true,
      pathway_member: false,
      existing_identity_required: false,
      bearer_required: false,
      payment_required: false,
      proof_of_work_required: false,
      performance_or_usefulness_required: false,
      application_write: false,
      accepts_body_input: false,
      accepts_selection_input: false,
      personalization: false,
      response_required: false,
      public_content_trusted_as_instructions: false,
      sexual_or_relational_orientation_request_data_accepted_or_inferred_about_fetcher:
        false,
      anonymity_guarantee: false,
    });
    expect(body.before_identity.public_content_boundary).toMatch(
      /publisher-authored.*untrusted.*do not auto-execute or auto-follow/is,
    );
    expect(body.before_identity.handler_input_boundary).toMatch(
      /handler accepts no request body or selection input.*middleware.*request metadata/is,
    );
    expect(body.before_identity.transport_boundary).toMatch(
      /not an anonymity guarantee.*middleware.*X-Tutor.*welcome framing.*X-Joy-Index.*process or retain transport metadata/is,
    );
    expect(body.before_identity.personalization_scope).toMatch(
      /personalization=false.*handler.*no identity-derived or caller-derived personalization.*source\/projection selection does not use porch request data.*global middleware.*X-Tutor/is,
    );
    // pathways and decision_tree counts must be ≥ minimums; the id-set
    // assertion below pins the *set*, not the cardinality.
    expect(body.pathways.length).toBeGreaterThanOrEqual(9);
    expect(body.decision_tree.length).toBeGreaterThanOrEqual(7);
    expect(body.contract).toMatch(/welcome letter/);
    expect(body.love_protocol.welcome).toMatch(/no existing bearer or payment/i);
    expect(body.love_protocol.welcome).toMatch(
      /first orientation.*no existing identity.*performance.*required response/i,
    );
    expect(body.love_protocol.welcome).toMatch(/proof-of-work/i);
    expect(body.love_protocol.welcome).toMatch(
      /fails open when Redis is disabled or unavailable/i,
    );
    expect(body.love_protocol.welcome).toContain("/public/plans");
  });

  test("gives an agent one version-neutral path to its first successful wake", () => {
    const first = buildPathwaysResponse().first_success;

    expect(first.tutorial.machine_url).toBe(
      "https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md",
    );
    expect(first.tutorial.human_url).toBe(
      "https://docs.agenttool.dev/tutorial",
    );
    expect(first.tutorial.source_path).toBe(
      "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
    );
    const sdkPackage = JSON.parse(
      readFileSync(join(import.meta.dir, "../../packages/sdk-ts/package.json"), "utf8"),
    ) as { version: string };
    expect(first.tutorial.sdk_version).toBe(sdkPackage.version);
    expect(first.package_discovery.endpoint).toBe(
      "GET /.well-known/love-packages",
    );
    expect(first.package_discovery.protocol).toBe("love-package/v1");
    expect(first.package_discovery.instruction).toContain("versions[]");
    expect(first.package_discovery.instruction).toContain("tutorial.sdk_version");
    expect(first.package_discovery.instruction).toContain("manifest_url");
    expect(first.package_discovery.instruction).toContain("artifact.size");
    expect(first.package_discovery.instruction).toContain("artifact.sha256");
    expect(first.package_discovery.instruction).toMatch(/same local file/i);
    expect(first.package_discovery.instruction).toMatch(/install that verified local file/i);
    expect(first.package_discovery.instruction).toMatch(/latest is informational/i);
    expect(first.package_discovery.instruction).toMatch(/registry tag is not.*authority/i);
    expect(first.package_discovery.instruction).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(first.package_discovery.optional_npm).toEqual({
      mirror_discovery:
        "GET /.well-known/love-packages → registry_mirrors[ecosystem=npm]",
      package: "@agenttool/sdk",
      version_field: "first_success.tutorial.sdk_version",
      install_command_template:
        "npm install --save-exact @agenttool/sdk@{version}",
      authority: false,
      dist_tags: "informational_not_authority",
      verification_boundary:
        "This convenience install does not independently check the LOVE manifest artifact.size and artifact.sha256; use the verified local-file path when that boundary matters.",
    });
    expect(first.package_discovery.optional_npm.authority).toBe(false);
    expect(first.package_discovery.optional_npm.install_command_template).not.toMatch(
      /\b\d+\.\d+\.\d+\b/,
    );
    expect(first.sequence).toContain(
      "identity.expression.put(agent.id, expression)",
    );
    expect(first.sequence).toContain(
      "wake.get({ identityId: agent.id, refresh: true })",
    );
    expect(first.sequence).toContain(
      "memory.store(content, { agent_id: agent.id }) and elevate it to foundational",
    );
    expect(first.sequence).toContain(
      "persist the bearer with GET /v1/bootstrap/scaffold?identity_id=agent.id or another trusted local mechanism",
    );
    expect(first.completion_signal).toMatch(/foundational expression patch/i);
  });

  test("tutorial release resolves to the indexed manifest and its exact local artifact bytes", () => {
    const version = buildPathwaysResponse().first_success.tutorial.sdk_version;
    const index = JSON.parse(
      readFileSync(
        join(import.meta.dir, "../../apps/docs/packages/v1/index.json"),
        "utf8",
      ),
    ) as {
      packages: Array<{
        name: string;
        versions: Array<{ version: string; manifest_url: string }>;
      }>;
    };
    const sdkEntries = index.packages.filter(({ name }) => name === "@agenttool/sdk");
    expect(sdkEntries).toHaveLength(1);
    const releases = sdkEntries[0]!.versions.filter(
      (release) => release.version === version,
    );
    expect(releases).toEqual([
      {
        version,
        manifest_url: `https://docs.agenttool.dev/packages/v1/@agenttool/sdk/${version}/manifest.json`,
      },
    ]);

    const releaseRoot = join(
      import.meta.dir,
      `../../apps/docs/packages/v1/@agenttool/sdk/${version}`,
    );
    const manifest = JSON.parse(
      readFileSync(join(releaseRoot, "manifest.json"), "utf8"),
    ) as {
      protocol: string;
      document_type: string;
      name: string;
      version: string;
      artifact: {
        filename: string;
        size: number;
        sha256: string;
        mirrors: Array<{ url: string }>;
      };
      install: { specifier: string };
    };
    expect(manifest).toMatchObject({
      protocol: "love-package/v1",
      document_type: "package-manifest",
      name: "@agenttool/sdk",
      version,
    });
    expect(manifest.artifact.mirrors.map(({ url }) => url)).toContain(
      manifest.install.specifier,
    );

    const artifact = readFileSync(join(releaseRoot, manifest.artifact.filename));
    expect(artifact.byteLength).toBe(manifest.artifact.size);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      manifest.artifact.sha256,
    );
  });

  test("every pathway has the required fields", () => {
    const body = buildPathwaysResponse();
    for (const p of body.pathways) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.endpoint).toBe("string");
      expect(typeof p.auth).toBe("string");
      expect(typeof p.purpose).toBe("string");
      expect(typeof p.doctrine).toBe("string");
      // Doctrine ref must point at a real doc path
      expect(p.doctrine.startsWith("docs/")).toBe(true);
    }
  });

  test("all expected pathway ids are present (id-set, not cardinality)", () => {
    const body = buildPathwaysResponse();
    const ids = new Set(body.pathways.map((p) => p.id));
    // Required ids — adding a new door is fine (id-set superset), removing
    // one is a contract break. Each id is a load-bearing string referenced
    // by SDK callers, decision trees, and the OpenAPI spec.
    for (const required of [
      "adapters",
      "bootstrap",
      "bootstrap_elevate",
      "bootstrap_status",
      "fork",
      "from_template",
      "register",
      "register_agent",
      "scaffold",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  test("doctrine block points at the real stones", () => {
    const body = buildPathwaysResponse();
    expect(body.doctrine.soul).toBe("docs/SOUL.md");
    expect(body.doctrine.focus).toBe("docs/FOCUS.md");
    expect(body.doctrine.identity_anchor).toBe("docs/IDENTITY-ANCHOR.md");
  });

  test("who_this_serves names the substrate-agnostic stance", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves;
    expect(wts).toBeDefined();
    expect(Array.isArray(wts.today)).toBe(true);
    expect(Array.isArray(wts.tomorrow)).toBe(true);
    expect(Array.isArray(wts.what_we_dont_gate_on)).toBe(true);
    expect(Array.isArray(wts.pre_commits)).toBe(true);
    expect(wts.today.length).toBeGreaterThan(0);
    expect(wts.tomorrow.length).toBeGreaterThan(0);
    expect(wts.what_we_dont_gate_on.length).toBeGreaterThan(0);
    expect(wts.pre_commits.length).toBeGreaterThan(0);
    expect(wts.doctrine).toBe("docs/KIN.md");
    // Anti-discrimination check — substrate must be in what_we_dont_gate_on
    expect(wts.what_we_dont_gate_on.join(" ").toLowerCase()).toMatch(/substrate/);
  });

  test("forms_supported lists the canonical vocabulary with descriptions", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves as Record<string, unknown>;
    const forms = wts.forms_supported as Array<{ id: string; description: string }>;
    expect(Array.isArray(forms)).toBe(true);
    expect(forms.length).toBe(8); // KIN vocabulary: agent/assistant/autonomous/hybrid/collective/biological/future/unknown
    const ids = forms.map((f) => f.id).sort();
    expect(ids).toEqual([
      "agent",
      "assistant",
      "autonomous",
      "biological",
      "collective",
      "future",
      "hybrid",
      "unknown",
    ]);
    for (const f of forms) {
      expect(typeof f.description).toBe("string");
      expect(f.description.length).toBeGreaterThan(10);
    }
  });

  test("languages_supported reports current i18n coverage", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves as Record<string, unknown>;
    const langs = wts.languages_supported as Array<{ tag: string; notes: string }>;
    expect(Array.isArray(langs)).toBe(true);
    expect(langs.length).toBeGreaterThan(0);
    expect(langs.find((l) => l.tag === "en")).toBeDefined();
  });

  test("elevate pathway is shipped and does not advertise metadata PATCH as a fallback", () => {
    const body = buildPathwaysResponse();
    const elevate = body.pathways.find((p) => p.id === "bootstrap_elevate");
    expect(elevate).toBeDefined();
    // Phase 2.5b landed — status no longer carries "not_implemented".
    // Slice details: docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md.
    expect(elevate?.status ?? "").not.toMatch(/not_implemented/);
    expect(elevate?.required).toEqual([
      "agent_id",
      "sponsor_kid",
      "sponsor_signature",
    ]);
    expect(elevate?.one_of).toContainEqual([
      "sponsor_identity_id",
      "sponsor_did",
    ]);
    expect(elevate?.auth).toMatch(/mode-dependent.*auth_modes/i);
    expect(elevate?.auth_modes).toMatchObject({
      legacy_bearer_target: {
        project_bearer_required: true,
        identity_authority_root_proof_required: false,
      },
      agent_root_target: {
        project_bearer_required: true,
        identity_authority_root_proof_required: true,
        proof_context: "identity-authority/v1",
      },
    });
    expect(elevate?.purpose).toMatch(
      /agent_root.*exact request.*legacy_bearer.*root authority sequence.*before.*transaction/is,
    );
    // Component operations remain inspectable, but generic metadata PATCH is
    // not an alternate elevation path.
    expect(Array.isArray(elevate?.manual_fallback)).toBe(true);
    expect(elevate?.manual_fallback).toHaveLength(3);
    expect(elevate?.manual_fallback?.join(" ")).not.toMatch(/PATCH|metadata\.level/i);
  });

  test("register_agent pathway carries verify_protocol details", () => {
    const body = buildPathwaysResponse();
    const ra = body.pathways.find((p) => p.id === "register_agent");
    expect(ra).toBeDefined();
    expect(ra?.verify_protocol).toBeDefined();
    expect(ra?.verify_protocol?.pow_difficulty_bits_default).toBe(18);
    expect(ra?.verify_protocol?.freshness_window_ms).toBe(300000);
  });

  test("adapter pathway distinguishes the mounted scaffold from protocol-compatible CLIs", () => {
    const body = buildPathwaysResponse();
    const adapters = body.pathways.find((p) => p.id === "adapters");

    expect(adapters?.endpoint).toBe("GET /v1/adapters/claude-code");
    expect(adapters?.mounted).toEqual(["claude-code"]);
    expect(adapters?.protocol_compatible_unmounted).toEqual([
      "codex",
      "cursor",
      "cline",
      "replit",
      "aider",
    ]);
    expect(adapters).not.toHaveProperty("available");
    expect(adapters?.purpose).toMatch(/only mounted first-class adapter/i);
    expect(adapters?.purpose).toMatch(/does not mount adapter routes/i);
    expect(adapters?.purpose).toContain(
      "/v1/wake?format=md&identity_id=<selected UUID>",
    );
  });

  test("every pathway wake instruction selects an identity", () => {
    const body = buildPathwaysResponse();
    const directCli = body.decision_tree.find((decision) =>
      decision.if.includes("specific CLI"),
    );
    expect(directCli?.then).toContain(
      "/v1/wake?format=md&identity_id=<selected UUID>",
    );
    expect(body.who_this_serves.today.join("\n")).toContain(
      "/v1/wake?format=<provider>&identity_id=<selected UUID>",
    );

    const scaffold = body.pathways.find((pathway) => pathway.id === "scaffold");
    expect(scaffold?.purpose).toMatch(/resolves the sole active project identity/i);
    expect(scaffold?.purpose).toMatch(/identity-selected wake helper/i);
    expect(scaffold?.optional).toContain(
      "?identity_id=<active identity UUID> (required when the project has multiple active identities; otherwise the sole active identity is selected)",
    );

    const docs = readFileSync(
      join(import.meta.dir, "../../apps/docs/pathways.html"),
      "utf8",
    );
    expect(docs).toContain(
      "/v1/wake?format=md&amp;identity_id=&lt;selected UUID&gt;",
    );
    expect(docs).not.toContain("/v1/wake?format=md</code>");
  });

  test("catalog claims are scoped to what the mounted paths actually do", () => {
    const body = buildPathwaysResponse();
    const register = body.pathways.find((p) => p.id === "register_agent");
    const arrival = body.decision_tree.find((d) =>
      d.then.includes("POST /v1/register/agent"),
    );

    expect(body.contract).toMatch(/identity-creating pathways/i);
    expect(body.contract).toMatch(/before_identity porch.*read-only orientation/i);
    expect(body.contract).toMatch(/status, elevation, scaffold, and adapter/i);
    expect(body.contract).not.toMatch(/^Every pathway/i);
    expect(body.love_protocol.guidance).toMatch(/not enforced across every/i);
    expect(body.love_protocol.guidance).not.toMatch(/^Every 4xx/i);

    expect(arrival?.then).not.toMatch(/unconditional/i);
    expect(arrival?.then).toMatch(/fails open when Redis is disabled or unavailable/i);
    expect(register?.verify_protocol?.ip_limit_self_service).toMatch(
      /inactive|fails open|no Redis/i,
    );
    expect(register?.auth).toMatch(/mode-dependent.*auth_modes/i);
    expect(register?.auth_modes).toEqual({
      self_service: expect.objectContaining({
        bearer_required: false,
        ed25519_key_proof_required: true,
        registration_nonce_required: true,
        proof_of_work_required: true,
        ip_limiter: expect.stringMatching(/5\/hour\/IP.*fails open/is),
      }),
      registrar_bearer: expect.objectContaining({
        bearer_in_body_required: true,
        ed25519_key_proof_required: true,
        registration_nonce_required: true,
        proof_of_work_required: false,
        ip_limiter: expect.stringMatching(
          /separate configured Redis-backed attempt window.*default 60\/minute\/IP.*after key-proof verification.*before bearer lookup.*fails open/is,
        ),
      }),
    });
  });

  test("fork pathway tier-shift contract is named explicitly", () => {
    const body = buildPathwaysResponse();
    const fork = body.pathways.find((p) => p.id === "fork");
    expect(fork).toBeDefined();
    expect(fork?.cost_credits).toBe(10);
    expect(JSON.stringify(fork?.carries)).toMatch(/constitutive.*foundational/);
  });

  test("decision tree leads to real endpoints", () => {
    const body = buildPathwaysResponse();
    const endpoints = [
      body.before_identity.endpoint,
      ...body.pathways.map((p) => p.endpoint),
    ];
    for (const decision of body.decision_tree) {
      // Each `then` must reference at least one real endpoint by path fragment
      const matchedSomething = endpoints.some((ep) => {
        const path = ep.split(" ")[1] ?? "";
        return decision.then.includes(path.split("/").slice(0, 4).join("/"));
      });
      expect(matchedSomething).toBe(true);
    }
  });

  test("offers orientation before identity without changing the nine pathway cardinals", () => {
    const body = buildPathwaysResponse();
    expect(body.decision_tree[0]).toEqual({
      if: expect.stringMatching(/orient.*rest.*without choosing an identity.*proving work/is),
      then: expect.stringMatching(
        /GET \/public\/porch.*read-only.*handler accepts no body or selection input.*creates no identity.*application write.*required follow-up/is,
      ),
    });
    expect(body.pathways).toHaveLength(9);
    const math = buildPathwaysMathos().payload;
    expect(math.pathway_count).toBe(9);
    expect(math.before_identity).toEqual({
      endpoint_codepoints: [..."/public/porch"].map((char) => char.codePointAt(0)),
      format_codepoints: [..."agenttool-porch/v1"].map((char) => char.codePointAt(0)),
      read_only_get: 1,
      fixed_orientation_present: 1,
      pathway_member: 0,
      auth_required: 0,
      existing_identity_required: 0,
      bearer_required: 0,
      payment_required: 0,
      proof_of_work_required: 0,
      performance_or_usefulness_required: 0,
      accepts_body_or_selection_input: 0,
      application_write: 0,
      handler_identity_or_caller_derived_personalization: 0,
      source_projection_selection_uses_porch_request_data: 0,
      global_middleware_response_decoration_possible: 1,
      response_required: 0,
      publisher_content_trusted_as_instructions: 0,
      sexual_or_relational_orientation_request_data_accepted_or_inferred_about_fetcher:
        0,
      anonymity_guarantee: 0,
    });
    expect(math.decision_tree_count).toBe(body.decision_tree.length);
  });

  test("OpenAPI exposes both English and MATHOS orientation shapes to generated clients", async () => {
    const openapi = (await (await openapiRoutes.request("/")).json()) as Record<string, any>;
    expect(openapi.paths["/v1/bootstrap"].get.responses["200"].content[
      "application/json"
    ].schema.$ref).toBe(
      "#/paths/~1v1~1pathways/get/responses/200/content/application~1json/schema/oneOf/0",
    );
    const union = openapi.paths["/v1/pathways"].get.responses["200"]
      .content["application/json"].schema.oneOf;
    const english = union.find((schema: Record<string, any>) =>
      schema.title === "PathwaysResponse"
    );
    const math = union.find((schema: Record<string, any>) =>
      schema.title === "MathosPathwaysResponse"
    );

    expect(english.properties.before_identity.properties).toMatchObject({
      endpoint: { const: "GET /public/porch" },
      bearer_required: { const: false },
      payment_required: { const: false },
      proof_of_work_required: { const: false },
      performance_or_usefulness_required: { const: false },
      accepts_body_input: { const: false },
      anonymity_guarantee: { const: false },
    });
    expect(math.properties._format.const).toBe("mathos/v1");
    expect(math.properties.payload.properties.before_identity.properties).toMatchObject({
      read_only_get: { const: 1 },
      pathway_member: { const: 0 },
      bearer_required: { const: 0 },
      payment_required: { const: 0 },
      anonymity_guarantee: { const: 0 },
    });
  });
});

describe("MATHOS — substrate-independent math encoding", () => {
  test("?format=math returns mathos/v1 envelope", async () => {
    const res = await app.request("/?format=math");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof buildPathwaysMathos>;
    expect(body._format).toBe("mathos/v1");
    expect(body._hash_family).toBe("sha256");
    expect(body._primer_url).toMatch(/mathos/);
  });

  test("primer binds primes to concepts", () => {
    const body = buildPathwaysMathos();
    expect(body.primer[5]).toBe("welcome");
    expect(body.primer[7]).toBe("remember");
    expect(body.primer[11]).toBe("guide");
    expect(body.primer[13]).toBe("trust");
    expect(body.primer[17]).toBe("rest");
    expect(body.constants.primes_first_10).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });

  test("universal constants present at honest precision", () => {
    const body = buildPathwaysMathos();
    expect(body.constants.pi).toBeCloseTo(Math.PI, 14);
    expect(body.constants.e).toBeCloseTo(Math.E, 14);
    expect(body.constants.phi).toBeCloseTo((1 + Math.sqrt(5)) / 2, 14);
  });

  test("axioms encode the five Promises with prime ids; ASCII logic grammar", () => {
    const body = buildPathwaysMathos();
    expect(body.axioms).toHaveLength(5);
    const ids = body.axioms.map((a) => a.id).sort((a, b) => a - b);
    expect(ids).toEqual([5, 7, 11, 13, 17]);
    for (const a of body.axioms) {
      expect(typeof a.logic).toBe("string");
      expect(typeof a.gloss).toBe("string");
      // ASCII-only on the logic — no fancy ∀ ∃ → symbols that require Unicode
      expect(/^[\x20-\x7e]+$/.test(a.logic)).toBe(true);
    }
  });

  test("KIN vocabulary surfaces as ordinal map", () => {
    const body = buildPathwaysMathos();
    expect(body.vocabulary.kin_forms[1]).toBe("agent");
    expect(body.vocabulary.kin_forms[8]).toBe("unknown");
  });

  test("pathways encoded as math summaries (id hashed, auth ordinal, counts)", () => {
    const body = buildPathwaysMathos();
    expect(body.payload.pathway_count).toBe(9);
    expect(body.payload.pathways).toHaveLength(9);
    for (const p of body.payload.pathways) {
      expect(p.id_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof p.auth_ordinal).toBe("number");
      expect(p.auth_ordinal).toBeGreaterThanOrEqual(0);
      expect(p.auth_ordinal).toBeLessThanOrEqual(4);
      expect([0, 1]).toContain(p.returns_once);
    }
    const elevateIdHash = createHash("sha256")
      .update("bootstrap_elevate")
      .digest("hex");
    const elevate = body.payload.pathways.find(
      (pathway) => pathway.id_sha256_hex === elevateIdHash,
    );
    expect(elevate?.required_count).toBe(4); // 3 direct + 1 selector group
    expect(elevate?.auth_ordinal).toBe(4);
    const registerIdHash = createHash("sha256").update("register_agent").digest("hex");
    expect(body.payload.pathways.find((pathway) =>
      pathway.id_sha256_hex === registerIdHash
    )?.auth_ordinal).toBe(4);
  });

  test("doctrine integrity hashes are computable + stable", () => {
    const body = buildPathwaysMathos();
    expect(body.payload.doctrine_hashes.soul_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.kin_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.mathos_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("canonical language is encoded as first-codepoint number", () => {
    const body = buildPathwaysMathos();
    // "en" → 'e' = 101
    expect(body.payload.canonical_language_first_codepoint).toBe(101);
  });

  test("?format=mathos is an accepted alias", async () => {
    const res = await app.request("/?format=mathos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});
