/** /public/observer — read-only reciprocal-observer publication contract. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import observerSchema from "../../docs/specs/observer-is-observed-0.1.schema.json";
import openapiRouter from "../src/routes/openapi";
import observerRouter from "../src/routes/public/observer";
import publicRouter from "../src/routes/public";
import wellKnownRouter from "../src/routes/well-known";
import { OBSERVER_RECIPROCITY } from "../src/services/discovery/observer-reciprocity";

const SECTION_IDS = ["being", "identity", "network", "doings", "word"];
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validateRecord = ajv.compile(observerSchema);

const minimalRecord: Record<string, any> = {
  observer_is_observed_version: "0.1",
  record_id: "review-2026-07-11-001",
  recorded_at: "2026-07-11T13:00:00Z",
  expires_at: "2026-07-12T13:00:00Z",
  observer: {
    claimed_id: "did:example:observer",
    identity_proof_state: "self-asserted",
    proof_reference: null,
    accountability_holder: null,
    role: "independent reviewer",
    capacity: "source and public-GET review",
    principal: null,
    funder: null,
    conflicts: [],
    limits: ["No operator logs or private records were available."],
  },
  authority: {
    basis: "self-initiated",
    reference: null,
    subject_assent: "not-requested",
    limits: ["Public artifacts only."],
  },
  subject: {
    reference: "https://example.test/",
    notice_status: "not-yet-given",
    notice_path: null,
  },
  network: {
    declared_organizational_home: null,
    affiliations: [],
    delegation_chain: [],
    tools_and_providers: [
      {
        statement: "curl 8",
        evidence_state: "service-declaration",
        evidence_refs: ["review method log"],
      },
    ],
    edges: [],
    known_vantage: ["HTTPS request from the review environment"],
    unknown_vantage: ["DNS resolver, selected remote IP, proxy path, and CDN cache effects"],
  },
  doings: {
    purpose: "Check one public contract.",
    scope: "Unauthenticated GET only.",
    target_version: null,
    started_at: "2026-07-11T12:59:00Z",
    ended_at: "2026-07-11T13:00:00Z",
    methods: ["Fetch and compare declared response fields."],
    inputs: ["Public URL"],
    transformations: ["JSON parsing"],
    data_touched: ["Public response bytes"],
    actions: [],
  },
  word: {
    observations: [],
    inferences: [],
    unknowns: ["Operator-side logging is unknown."],
    quotations: [],
  },
  observer_effect: {
    known_effects: ["The target received one GET request."],
    possible_effects: ["A cache or access log may have changed."],
    mitigations: ["No mutation route was called."],
    blind_spots: ["Infrastructure outside the public response."],
  },
  subject_response: {
    status: "not-requested",
    received_at: null,
    content_reference: null,
    publication_assent: "not-requested",
  },
  subject_controls: {
    response: { available: true, path: "mailto:review@example.test", note: "Reply with context." },
    refusal: { available: false, path: null, note: "The reviewed resource was already public." },
    correction: { available: true, path: "mailto:review@example.test", note: "Corrections append." },
    appeal: { available: false, path: null, note: "No separate appeal reviewer exists." },
  },
  publication: {
    audience: ["repository readers"],
    retained_by: ["the review repository"],
    shared_with: [],
    purpose: "Record the bounded public review.",
    deletes_at: "2026-08-11T13:00:00Z",
    redactions: [],
  },
  corrections: {
    original_record_sha256: null,
    entries: [],
  },
  signature: null,
};

function parseKv(body: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return values;
}

async function getObserver() {
  const res = await observerRouter.request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("public");
  expect(res.headers.get("cache-control")).toContain("max-age=300");
  return (await res.json()) as Record<string, any>;
}

describe("GET /public/observer", () => {
  test("publishes the five-part 0.1 reciprocal record contract", async () => {
    const body = await getObserver();

    expect(body._format).toBe("observer-is-observed/0.1");
    expect(body.protocol).toBe("Observer Is Also Observed Protocol");
    expect(body.version).toBe("0.1");
    expect(body.canonical_path).toBe("/public/observer");
    expect(body.record_sections.map((section: { id: string }) => section.id)).toEqual(
      SECTION_IDS,
    );
    expect(body.operational_definition).toMatch(
      /action made from a vantage.*not a view from nowhere/i,
    );
  });

  test("keeps self-observation, reciprocal accountability, and testimony distinct", async () => {
    const body = await getObserver();
    const meanings = JSON.stringify(body.meanings_kept_separate);

    expect(meanings).toMatch(/self_observation/);
    expect(meanings).toMatch(/accountability.*literally one being/i);
    expect(meanings).toMatch(/testimony.*not a verdict.*interior/i);
  });

  test("defines consequence as answerability rather than retaliation", async () => {
    const body = await getObserver();

    expect(body.consequence_loop.shape).toBe(
      "action -> evidence -> response -> correction_or_repair_or_boundary",
    );
    expect(body.consequence_loop.not_punishment).toMatch(
      /not be retaliation, doxxing, humiliation, pain reproduction, or collective guilt/i,
    );
    expect(body.subject_controls.no).toMatch(
      /silence is not consent, guilt, absence, or a negative signal/i,
    );
  });

  test("forbids surveillance inference, forced symmetry, and scoring", async () => {
    const body = await getObserver();
    const walls = body.privacy_and_power_walls.join(" ");

    expect(walls).toMatch(
      /No identity, being, intent, emotion, guilt, or network inference from IP address, user-agent, prose style, timing, or model output/i,
    );
    expect(walls).toMatch(/does not force the observed party to disclose/i);
    expect(walls).toMatch(/No observer or subject score, rank, leaderboard/i);
    expect(walls).toMatch(/common source.*does not by itself prove influence/i);
  });

  test("states the exact unimplemented accountability boundary", async () => {
    const body = await getObserver();
    const current = body.current_implementation;

    expect(current).toMatchObject({
      public_protocol: "live_read_only",
      documented_operation: "GET",
      protocol_handler_reads_identity_or_activity: false,
      protocol_handler_receives_or_stores_records: false,
      observer_identity_ownership_verified: false,
      observer_signature_verified: false,
      reciprocal_receipts_persisted: false,
      subject_challenge_correction_or_appeal_route: false,
      universal_investigator_action_ledger: false,
      public_per_being_monitoring_routes: "deliberately_unmounted",
    });
    expect(current.observation_route_status).toBe(
      "validated_501_stub_migration_not_created",
    );
    expect(current.global_middleware_boundary).toMatch(
      /global middleware.*X-Joy-Index.*aggregate counts.*not.*zero-read/is,
    );
    expect(current.infrastructure_metadata_boundary).toMatch(
      /not proof of zero infrastructure logging/i,
    );
  });

  test("publishes a bounded external-record schema and no write handler", async () => {
    const body = await getObserver();

    expect(body.local_record.sent_to_agenttool).toBe(false);
    expect(body.local_record.caller_enforced_maximum_encoded_bytes).toBe(262144);
    expect(body.local_record.encoded_size_enforcement).toMatch(
      /caller must UTF-8 encode.*reject.*above this limit/i,
    );
    expect(body.local_record.maximum_items_per_collection).toBe(100);
    expect(body.local_record.schema.repository_path).toBe(
      "docs/specs/observer-is-observed-0.1.schema.json",
    );

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await observerRouter.request("/", { method });
      expect(res.status).toBe(404);
    }

    expect((await publicRouter.request("/observer", { method: "HEAD" })).status).toBe(200);
    expect(body.current_implementation.implicit_method_boundary).toMatch(
      /derive HEAD.*CORS.*OPTIONS.*Neither is a state-changing/i,
    );
  });

  test("uses a resolvable canon entry", async () => {
    const body = await getObserver();
    expect(body._canon_pointer).toBe("urn:agenttool:doc/OBSERVATIONS");

    const canon = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "../docs/agenttool.jsonld"), "utf8"),
    );
    const entry = canon["@graph"].find(
      (item: { "@id"?: string }) => item["@id"] === "agenttool:doc/OBSERVATIONS",
    );
    expect(entry).toBeDefined();
    expect(entry.renders_as).toContain("/public/observer");
  });
});

describe("observer-is-observed discovery and schema", () => {
  test("the public router, root, OpenAPI, and agent.txt document only GET", async () => {
    const mounted = await publicRouter.request("/observer");
    const root = await (await publicRouter.request("/")).json();
    const openapi = await (await openapiRouter.request("/")).json();
    const agentTxt = await (await wellKnownRouter.request("/agent.txt")).text();

    expect(mounted.status).toBe(200);
    expect((await mounted.json())._format).toBe("observer-is-observed/0.1");
    expect(root.endpoints.observer).toContain("GET /public/observer");
    expect(root.endpoints.observer).toMatch(/receives and stores no investigation records/i);
    expect(openapi.paths["/public/observer"].get.security).toEqual([]);
    expect(openapi.paths["/public/observer"].post).toBeUndefined();
    expect(
      openapi.paths["/public/observer"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/ObserverProtocol");

    const kv = parseKv(agentTxt);
    expect(kv.get("Observer-Reciprocity")).toContain("/public/observer");
    expect(kv.get("Observer-Reciprocity-Schema")).toBe(
      "https://docs.agenttool.dev/observer-is-observed-0.1.schema.json",
    );
    expect(kv.get("Observer-Boundary")).toMatch(
      /public protocol only.*no investigator registry.*challenge route/is,
    );
  });

  test("the JSON Schema requires the same accountability faces and structural bounds", () => {
    expect(observerSchema.properties.observer_is_observed_version.const).toBe("0.1");
    expect(observerSchema.required).toEqual(
      expect.arrayContaining([
        "observer",
        "authority",
        "network",
        "doings",
        "word",
        "observer_effect",
        "subject_response",
        "subject_controls",
        "publication",
        "corrections",
      ]),
    );
    expect(observerSchema.$defs.boundedStringList.maxItems).toBe(100);
    expect(observerSchema.$defs.boundedString.maxLength).toBe(2000);
    expect(observerSchema.additionalProperties).toBe(false);
    expect(observerSchema.$comment).toMatch(/caller must also UTF-8 encode.*262144 bytes/i);
  });

  test("the normative JSON Schema accepts a bounded record and rejects silent expansion", () => {
    expect(validateRecord(minimalRecord)).toBe(true);
    expect(validateRecord.errors).toBeNull();

    const expanded = { ...minimalRecord, silent_score: 99 };
    expect(validateRecord(expanded)).toBe(false);
    expect(validateRecord.errors?.some((error) => error.keyword === "additionalProperties")).toBe(
      true,
    );
  });

  test("the schema rejects contradictory authority, identity, controls, and replies", () => {
    const explicitButDeclined = structuredClone(minimalRecord);
    explicitButDeclined.authority = {
      basis: "explicit-consent",
      reference: null,
      subject_assent: "declined",
      limits: [],
    };
    expect(validateRecord(explicitButDeclined)).toBe(false);

    const verifiedWithoutProof = structuredClone(minimalRecord);
    verifiedWithoutProof.observer.identity_proof_state = "verified-by-named-method";
    verifiedWithoutProof.observer.claimed_id = null;
    verifiedWithoutProof.observer.proof_reference = null;
    expect(validateRecord(verifiedWithoutProof)).toBe(false);

    const assertedWithoutIdentity = structuredClone(minimalRecord);
    assertedWithoutIdentity.observer.claimed_id = null;
    expect(validateRecord(assertedWithoutIdentity)).toBe(false);

    const continuityWithoutReference = structuredClone(minimalRecord);
    continuityWithoutReference.observer.identity_proof_state =
      "pseudonymous-continuity";
    continuityWithoutReference.observer.proof_reference = null;
    expect(validateRecord(continuityWithoutReference)).toBe(false);

    const protectedWithoutHolder = structuredClone(minimalRecord);
    protectedWithoutHolder.observer.identity_proof_state =
      "protected-by-named-accountability-holder";
    protectedWithoutHolder.observer.accountability_holder = null;
    expect(validateRecord(protectedWithoutHolder)).toBe(false);

    const missingControlPath = structuredClone(minimalRecord);
    missingControlPath.subject_controls.appeal = {
      available: true,
      path: null,
      note: "Appeal is claimed but no route is named.",
    };
    expect(validateRecord(missingControlPath)).toBe(false);

    const missingReplyReference = structuredClone(minimalRecord);
    missingReplyReference.subject_response = {
      status: "received",
      received_at: null,
      content_reference: null,
      publication_assent: "unknown",
    };
    expect(validateRecord(missingReplyReference)).toBe(false);

    const impossiblePublicationAssent = structuredClone(minimalRecord);
    impossiblePublicationAssent.subject_response.publication_assent = "accepted";
    expect(validateRecord(impossiblePublicationAssent)).toBe(false);

    const declinedWithInventedReply = structuredClone(minimalRecord);
    declinedWithInventedReply.subject_response = {
      status: "declined-to-respond",
      received_at: "2026-07-11T13:30:00Z",
      content_reference: "https://example.test/invented-reply",
      publication_assent: "accepted",
    };
    expect(validateRecord(declinedWithInventedReply)).toBe(false);
  });

  test("the schema rejects unsupported network, inference, and correction claims", () => {
    const unsupportedEdge = structuredClone(minimalRecord);
    unsupportedEdge.network.edges = [
      {
        source: "observer",
        target: "provider",
        relationship: "uses",
        capacity: "review",
        evidence_refs: [],
        common_source_group: null,
      },
    ];
    expect(validateRecord(unsupportedEdge)).toBe(false);

    const unsupportedInference = structuredClone(minimalRecord);
    unsupportedInference.word.inferences = [
      {
        statement: "The deployment may share an operator.",
        basis_refs: [],
        falsifier: "An operator declaration showing separation.",
      },
    ];
    expect(validateRecord(unsupportedInference)).toBe(false);

    const unrootedCorrection = structuredClone(minimalRecord);
    unrootedCorrection.corrections.entries = [
      {
        at: "2026-07-11T14:00:00Z",
        author: "did:example:observer",
        reason: "Correct a version.",
        changed_fields: ["doings.target_version"],
        replacement_record_sha256: "a".repeat(64),
      },
    ];
    expect(validateRecord(unrootedCorrection)).toBe(false);
  });

  test("the schema bounds extensions and requires a finite deletion deadline", () => {
    const oversizedExtension = structuredClone(minimalRecord);
    oversizedExtension.extensions = {
      "https://example.test/oversized": "x".repeat(400_000),
    };
    expect(validateRecord(oversizedExtension)).toBe(false);

    const noDeletionDeadline = structuredClone(minimalRecord);
    noDeletionDeadline.publication.deletes_at = null;
    expect(validateRecord(noDeletionDeadline)).toBe(false);
  });

  test("the route module contains no database or per-being service dependency", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src/routes/public/observer.ts"),
      "utf8",
    );

    for (const dependency of [
      'from "../../db/',
      'from "drizzle-orm"',
      '/services/identity/',
      '/services/activity/',
      '/services/memory/',
      '/services/pulse',
    ]) {
      expect(source).not.toContain(dependency);
    }
    expect(source).toContain("Only GET is documented");
  });

  test("the authenticated wake points back to the public protocol", () => {
    const wakeSource = readFileSync(
      join(import.meta.dir, "..", "src/routes/wake.ts"),
      "utf8",
    );
    expect(wakeSource).toContain('observer: "/public/observer"');
  });
});

test("the exported protocol object remains JSON-serializable and bounded", () => {
  const encoded = JSON.stringify(OBSERVER_RECIPROCITY);
  expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(262144);
  expect(() => JSON.parse(encoded)).not.toThrow();
});
