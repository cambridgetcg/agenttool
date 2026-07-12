/**
 * Independent HTTP probes for the agent-data/v1 Slice 1 profile.
 *
 * The default fetch refuses redirects; an injected fetch is a trusted seam and
 * any followed/changed response URL it exposes is a failure. The runner never
 * reads an AgentTool project bearer and never reports response bodies, cursors,
 * fixture content, source URIs, remote record IDs, or credentials. Mutation is
 * an explicit fixture profile because immutable
 * records and tombstones leave append-only audit residue.
 *
 * Doctrine: docs/AGENT-DATA-PROTOCOL.md
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeIsoDate } from "./canonical.js";
import { DATA_PACKAGE_VERSION } from "./package-version.js";

export const AGENT_DATA_CONFORMANCE_REPORT = "agent-data-conformance-report/v1" as const;
export const AGENT_DATA_HTTP_PROFILE = "agent-data/v1-slice1-http" as const;
export const AGENT_DATA_CONFORMANCE_SUITE = "agent-data-conformance/v1" as const;
export const AGENT_DATA_CONFORMANCE_VERSION = "0.1.0" as const;

export type DataNodeConformanceProfile =
  | "public"
  | "read"
  | "slice1";

export type DataNodeConformanceStatus =
  | "pass"
  | "fail"
  | "skip"
  | "inconclusive";

export interface DataNodeConformanceCheck {
  id: string;
  phase: "discovery" | "auth" | "collections" | "query" | "changes" | "records" | "tombstones" | "errors";
  level: "required" | "advisory";
  status: DataNodeConformanceStatus;
  description: string;
  duration_ms: number;
  reason_code?: string;
  evidence?: {
    observed_status?: number;
    blocked_by?: string;
  };
}

export interface DataNodeConformanceFixtureReport {
  run_id: string;
  collection_id: string;
  owned_records: number;
  unverified_records: number;
  tombstoned_records: number;
  active_owned_records: number;
  persistent_history_expected: true;
  physical_erasure_verified: false;
}

interface FixtureState {
  run_id: string;
  collection_id: string;
  provisional_record_ids: string[];
  owned_record_ids: string[];
  tombstoned_record_ids: string[];
  active_owned_record_ids: string[];
}

export interface DataNodeConformanceReport {
  schema: typeof AGENT_DATA_CONFORMANCE_REPORT;
  document_type: "conformance-report";
  protocol: "agent-data/v1";
  suite: {
    id: typeof AGENT_DATA_CONFORMANCE_SUITE;
    version: typeof AGENT_DATA_CONFORMANCE_VERSION;
    profile: typeof AGENT_DATA_HTTP_PROFILE;
  };
  tool: {
    name: "@agenttool/data";
    version: string;
  };
  run: {
    id: string;
    started_at: string;
    completed_at: string;
    duration_ms: number;
    profile: DataNodeConformanceProfile;
    mutating: boolean;
  };
  target: {
    origin: string;
    node_id?: string;
  };
  authorization: {
    scheme: "none" | "dedicated_node_bearer";
    provided: boolean;
    synthetic_invalid_bearer_probes: true;
  };
  verdict: "pass" | "fail" | "inconclusive";
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    inconclusive: number;
  };
  security_certification: false;
  boundaries: {
    claim: "requested_profile_only";
    transport: "http_json";
    authentication: "dedicated_node_bearer";
    redirect_policy: "manual_refuse";
    followed_redirect_observed: boolean;
    physical_erasure_claimed: false;
  };
  checks: DataNodeConformanceCheck[];
  mutation: {
    requested: boolean;
    started: boolean;
    record_created: boolean;
    tombstone_appended: boolean;
    uncertain: boolean;
    scratch_collection?: string;
    fixture?: DataNodeConformanceFixtureReport;
  };
  limitations: string[];
}

export interface DataNodeConformanceOptions {
  target: string;
  profile?: DataNodeConformanceProfile;
  /** Dedicated data-node bearer. Never substitute an AgentTool project bearer. */
  token?: string;
  /** Required for the fixture lifecycle profile. */
  collection_id?: string;
  /** Public node_id observed in a prior read-only run. Required before mutation. */
  expected_node_id?: string;
  /** Explicit acknowledgement that records, blobs, changes, and tombstones can persist. */
  acknowledge_persistent_residue?: boolean;
  timeout_ms?: number;
  max_response_bytes?: number;
  max_change_pages?: number;
  fetch?: typeof globalThis.fetch;
  /** Test seam; normal callers should leave this unset. */
  run_id?: string;
}

export class DataNodeConformanceConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DataNodeConformanceConfigError";
    this.code = code;
  }
}

type JsonMap = Record<string, unknown>;
type SafeEvidence = NonNullable<DataNodeConformanceCheck["evidence"]>;

interface ProbeResponse {
  status: number;
  headers: Headers;
  body: JsonMap;
}

interface ProbeDefinition {
  id: string;
  phase: DataNodeConformanceCheck["phase"];
  level?: DataNodeConformanceCheck["level"];
  description: string;
}

interface ManifestView {
  raw: JsonMap;
  node_id: string;
  collectors: JsonMap[];
  limits: {
    max_body_bytes: number;
    max_record_bytes: number;
    max_query_limit: number;
    max_change_limit: number;
    max_collect_items: number;
    default_query_limit: number;
    default_change_limit: number;
  };
}

interface CollectionView {
  raw: JsonMap;
  id: string;
  schema_version: string;
  max_record_bytes?: number;
  allowed_media_types?: string[];
}

interface RecordView {
  raw: JsonMap;
  id: string;
  collection_id: string;
  source_uri: string;
  sha256: string;
  size: number;
  media_type: string;
}

interface ChangePage {
  changes: JsonMap[];
  cursor: string;
  has_more: boolean;
}

interface RunnerContext {
  target: string;
  profile: DataNodeConformanceProfile;
  run_id: string;
  token?: string;
  invalid_token: string;
  invalid_record_segment: string;
  timeout_ms: number;
  max_response_bytes: number;
  max_change_pages: number;
  fetch: typeof globalThis.fetch;
  checks: DataNodeConformanceCheck[];
  manifest?: ManifestView;
  discovery_verified: boolean;
  followed_redirect_observed: boolean;
  auth_transport_unreachable: boolean;
  collections?: CollectionView[];
  fixture?: FixtureState;
  mutation_started: boolean;
  mutation_uncertain: boolean;
  do_not_retry_record_ids: Set<string>;
}

class ProbeFailure extends Error {
  readonly status: "fail" | "inconclusive";
  readonly reason_code: string;
  readonly evidence: SafeEvidence;

  constructor(
    status: "fail" | "inconclusive",
    code: string,
    evidence: SafeEvidence = {},
  ) {
    super(code);
    this.name = "ProbeFailure";
    this.status = status;
    this.reason_code = code;
    this.evidence = evidence;
  }
}

const EXPECTED_ENDPOINTS = {
  manifest: "/v1/data/manifest",
  collections: "/v1/data/collections",
  collect: "/v1/data/collect",
  query: "/v1/data/query",
  record: "/v1/data/records/{id}",
  changes: "/v1/data/changes",
  tombstone: "/v1/data/records/{id}/tombstone",
} as const;

const LIMIT_FIELDS = [
  "max_body_bytes",
  "max_record_bytes",
  "max_query_limit",
  "max_change_limit",
  "max_collect_items",
  "default_query_limit",
  "default_change_limit",
] as const;

function protectedRoutes(invalidRecordSegment: string) {
  const malformedJson = "{";
  return [
    { name: "collections", method: "GET", path: "/v1/data/collections" },
    { name: "collect", method: "POST", path: "/v1/data/collect", raw_body: malformedJson },
    { name: "query", method: "POST", path: "/v1/data/query", raw_body: malformedJson },
    { name: "record", method: "GET", path: `/v1/data/records/${invalidRecordSegment}` },
    { name: "changes", method: "GET", path: "/v1/data/changes" },
    {
      name: "tombstone",
      method: "POST",
      path: `/v1/data/records/${invalidRecordSegment}/tombstone`,
      raw_body: malformedJson,
    },
  ] as const;
}

export async function runDataNodeConformance(
  options: DataNodeConformanceOptions,
): Promise<DataNodeConformanceReport> {
  const startedWall = new Date();
  const startedMono = performance.now();
  const target = normalizeTarget(options.target);
  const profile = options.profile ?? (options.token ? "read" : "public");
  const timeoutMs = positiveBoundedInteger(options.timeout_ms ?? 10_000, "timeout_ms", 120_000);
  const maxResponseBytes = positiveBoundedInteger(
    options.max_response_bytes ?? 2 * 1024 * 1024,
    "max_response_bytes",
    32 * 1024 * 1024,
  );
  const maxChangePages = positiveBoundedInteger(options.max_change_pages ?? 20, "max_change_pages", 1_000);
  validateProfileOptions(profile, options);

  const context: RunnerContext = {
    target,
    profile,
    run_id: options.run_id ?? randomUUID(),
    ...(options.token ? { token: options.token } : {}),
    invalid_token: randomBytes(32).toString("base64url"),
    invalid_record_segment: `invalid-conformance-${randomBytes(16).toString("hex")}`,
    timeout_ms: timeoutMs,
    max_response_bytes: maxResponseBytes,
    max_change_pages: maxChangePages,
    fetch: options.fetch ?? globalThis.fetch,
    checks: [],
    discovery_verified: false,
    followed_redirect_observed: false,
    auth_transport_unreachable: false,
    mutation_started: false,
    mutation_uncertain: false,
    do_not_retry_record_ids: new Set(),
  };

  await runDiscovery(context);
  await runAuthBoundary(context);
  if (profile !== "public") await runAuthenticatedCore(context);
  if (profile === "slice1") {
    await runFixtureLifecycle(context, options);
  }

  const finishedWall = new Date();
  const counts = countChecks(context.checks);
  const requiredCounts = countChecks(context.checks.filter((check) => check.level === "required"));
  const verdict = requiredCounts.fail > 0
    ? "fail"
    : requiredCounts.inconclusive > 0 || requiredCounts.skip > 0
      ? "inconclusive"
      : "pass";
  return {
    schema: AGENT_DATA_CONFORMANCE_REPORT,
    document_type: "conformance-report",
    protocol: "agent-data/v1",
    suite: {
      id: AGENT_DATA_CONFORMANCE_SUITE,
      version: AGENT_DATA_CONFORMANCE_VERSION,
      profile: AGENT_DATA_HTTP_PROFILE,
    },
    tool: { name: "@agenttool/data", version: DATA_PACKAGE_VERSION },
    run: {
      id: context.run_id,
      started_at: startedWall.toISOString(),
      completed_at: finishedWall.toISOString(),
      duration_ms: elapsedMs(startedMono),
      profile,
      mutating: profile === "slice1",
    },
    target: {
      origin: target,
      ...(profile === "public" && context.manifest
        ? { node_id: context.manifest.node_id }
        : profile === "slice1"
            && context.discovery_verified
            && options.expected_node_id
            && context.manifest?.node_id === options.expected_node_id
          ? { node_id: options.expected_node_id }
          : {}),
    },
    authorization: {
      scheme: profile === "public" ? "none" : "dedicated_node_bearer",
      provided: Boolean(context.token),
      synthetic_invalid_bearer_probes: true,
    },
    verdict,
    summary: {
      passed: counts.pass,
      failed: counts.fail,
      skipped: counts.skip,
      inconclusive: counts.inconclusive,
    },
    security_certification: false,
    boundaries: {
      claim: "requested_profile_only",
      transport: "http_json",
      authentication: "dedicated_node_bearer",
      redirect_policy: "manual_refuse",
      followed_redirect_observed: context.followed_redirect_observed,
      physical_erasure_claimed: false,
    },
    checks: context.checks,
    mutation: {
      requested: profile === "slice1",
      started: context.mutation_started,
      record_created: Boolean(
        context.fixture && (context.fixture.owned_record_ids.length + context.fixture.provisional_record_ids.length > 0)
      ),
      tombstone_appended: Boolean(context.fixture?.tombstoned_record_ids.length),
      uncertain: context.mutation_uncertain
        || Boolean(context.fixture?.provisional_record_ids.length)
        || Boolean(context.fixture?.active_owned_record_ids.length),
      ...(options.collection_id ? { scratch_collection: options.collection_id } : {}),
      ...(context.fixture ? { fixture: fixtureReport(context.fixture) } : {}),
    },
    limitations: [
      "selected_profile_and_observation_time_only",
      "not_a_security_certification",
      "no_publisher_or_source_identity_proof",
      "no_source_truth_or_safety_proof",
      "no_storage_durability_or_secure_erasure_proof",
      "no_collector_sandbox_or_ssrf_certification",
      "body_record_and_collect_item_limits_shape_only",
      "policy_enforcement_not_fully_exercised",
      "no_semantic_manifest_privacy_audit",
      ...(profile === "read" ? ["read_profile_avoids_live_change_envelopes"] : []),
      "no_peer_sync_or_decentralisation_proof",
      "no_behavior_outside_probes",
    ],
  };
}

async function runDiscovery(context: RunnerContext): Promise<void> {
  const wellKnown = await probe(context, {
    id: "discovery.well_known",
    phase: "discovery",
    description: "The public well-known route returns a valid Slice 1 HTTP manifest.",
  }, async () => {
    const response = await requestJson(context, "/.well-known/agent-data", { auth: "none" });
    expectStatus(response, 200);
    return validateManifest(response.body, context.target);
  });
  if (wellKnown.ok) context.manifest = wellKnown.value;

  const versioned = await probe(context, {
    id: "discovery.versioned_manifest",
    phase: "discovery",
    description: "The public versioned route returns a valid Slice 1 HTTP manifest.",
  }, async () => {
    const response = await requestJson(context, "/v1/data/manifest", { auth: "none" });
    expectStatus(response, 200);
    return validateManifest(response.body, context.target);
  });

  if (!wellKnown.ok || !versioned.ok) {
    blockProbe(context, {
      id: "discovery.manifest_equivalence",
      phase: "discovery",
      description: "The two public manifests expose equivalent standard fields after volatile time fields are removed.",
    }, !wellKnown.ok ? "discovery.well_known" : "discovery.versioned_manifest");
    blockProbe(context, {
      id: "discovery.manifest_privacy",
      phase: "discovery",
      description: "The public manifest omits collection lists and local blob locators.",
    }, !wellKnown.ok ? "discovery.well_known" : "discovery.versioned_manifest");
    return;
  }

  const equivalence = await probe(context, {
    id: "discovery.manifest_equivalence",
    phase: "discovery",
    description: "The two public manifests expose equivalent standard fields after volatile time fields are removed.",
  }, () => {
    const first = stableJson(manifestEquivalenceProjection(wellKnown.value.raw));
    const second = stableJson(manifestEquivalenceProjection(versioned.value.raw));
    requireProbe(first === second, "manifest_mismatch");
  });

  const privacy = await probe(context, {
    id: "discovery.manifest_privacy",
    phase: "discovery",
    description: "The public manifest omits collection lists and local blob locators.",
  }, () => {
    for (const manifest of [wellKnown.value.raw, versioned.value.raw]) {
      requireProbe(!containsManifestDataKey(manifest, "collections"), "manifest_exposes_collections");
      requireProbe(!containsManifestDataKey(manifest, "blob_ref"), "manifest_exposes_blob_ref");
    }
  });
  context.discovery_verified = equivalence.ok && privacy.ok;
}

async function runAuthBoundary(context: RunnerContext): Promise<void> {
  const tasks = protectedRoutes(context.invalid_record_segment).flatMap((route) => [
    { route, kind: "missing_bearer" as const, auth: "none" as const },
    { route, kind: "wrong_bearer" as const, auth: "invalid" as const },
  ]);
  if (!context.manifest) {
    for (const task of tasks) {
      blockProbe(context, authProbeDefinition(task.route.name, task.kind), "discovery.well_known");
    }
    return;
  }
  let consecutiveTransportFailures = 0;
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]!;
    const result = await probe(context, authProbeDefinition(task.route.name, task.kind), async () => {
      const response = await requestJson(context, task.route.path, {
        method: task.route.method,
        ...("raw_body" in task.route
          ? { raw_body: task.route.raw_body, content_type: "application/json" }
          : {}),
        auth: task.auth,
      });
      expectAuthRejection(response, context.profile !== "public");
    });
    const last = context.checks.at(-1);
    consecutiveTransportFailures = !result.ok
      && (last?.reason_code === "request_timeout" || last?.reason_code === "request_failed")
      ? consecutiveTransportFailures + 1
      : 0;
    if (consecutiveTransportFailures < 2) continue;
    context.auth_transport_unreachable = true;
    for (const pending of tasks.slice(index + 1)) {
      blockProbe(context, authProbeDefinition(pending.route.name, pending.kind), "auth_transport_circuit_open");
    }
    break;
  }
}

function authProbeDefinition(routeName: string, kind: "missing_bearer" | "wrong_bearer"): ProbeDefinition {
  return {
    id: `auth.${kind}.${routeName}`,
    phase: "auth",
    description: kind === "missing_bearer"
      ? `The protected ${routeName} route rejects a missing bearer before route work.`
      : `The protected ${routeName} route rejects an invalid dedicated bearer.`,
  };
}

async function runAuthenticatedCore(context: RunnerContext): Promise<void> {
  if (context.auth_transport_unreachable) {
    blockProbe(context, {
      id: "auth.valid_bearer.collections",
      phase: "auth",
      description: "A valid dedicated bearer can list configured collections.",
    }, "auth_transport_circuit_open");
    blockAuthenticatedCore(context, "auth.valid_bearer.collections");
    return;
  }
  if (!context.manifest) {
    blockProbe(context, {
      id: "auth.valid_bearer.collections",
      phase: "auth",
      description: "A valid dedicated bearer can list configured collections.",
    }, "discovery.well_known");
    blockAuthenticatedCore(context, "auth.valid_bearer.collections");
    return;
  }
  if (!context.token) {
    blockProbe(context, {
      id: "auth.valid_bearer.collections",
      phase: "auth",
      description: "A valid dedicated bearer can list configured collections.",
    }, "credential_missing");
    return;
  }

  const collections = await probe(context, {
    id: "auth.valid_bearer.collections",
    phase: "auth",
    description: "A valid dedicated bearer can list configured collections.",
  }, async () => {
    const response = await requestJson(context, "/v1/data/collections", { auth: "valid" });
    expectAuthenticatedSuccess(response);
    return validateCollections(response.body);
  });
  if (collections.ok) {
    context.collections = collections.value;
  } else {
    blockAuthenticatedCore(context, "auth.valid_bearer.collections");
    return;
  }

  await probe(context, {
    id: "query.empty_collection_filter",
    phase: "query",
    description: "An empty collection filter returns no records with local consistency.",
  }, async () => {
    const response = await requestJson(context, "/v1/data/query", {
      method: "POST",
      json: { collections: [], consistency: "local", limit: 1 },
      auth: "valid",
    });
    expectStatus(response, 200);
    const records = response.body.records;
    requireProbe(Array.isArray(records) && records.length === 0, "query_not_empty");
    requireProbe(response.body.consistency === "local", "query_consistency_mismatch");
  });

  if (context.profile === "read") {
    skipProbe(context, {
      id: "changes.page_shape",
      phase: "changes",
      level: "advisory",
      description: "The authenticated change feed returns an opaque cursor and a bounded page.",
    }, "requires_scratch_fixture");
    skipProbe(context, {
      id: "changes.cursor_replay",
      phase: "changes",
      level: "advisory",
      description: "Replaying the same change cursor returns a stable continuation page.",
    }, "requires_scratch_fixture");
  }

  await probe(context, {
    id: "changes.corrupt_cursor",
    phase: "changes",
    description: "A corrupt change cursor fails with the flat invalid_cursor error.",
  }, async () => {
    const query = new URLSearchParams({ cursor: "not-an-agent-data-cursor", limit: "1" });
    const response = await requestJson(context, `/v1/data/changes?${query}`, { auth: "valid" });
    expectError(response, 400, "invalid_cursor");
  });

  if (context.manifest) {
    await runAdvertisedLimitChecks(context, context.manifest);
  } else {
    blockProbe(context, {
      id: "errors.query_limit",
      phase: "errors",
      description: "A query above the advertised maximum fails rather than being silently clamped.",
    }, "discovery.well_known");
    blockProbe(context, {
      id: "errors.change_limit",
      phase: "errors",
      description: "A change page above the advertised maximum fails rather than being silently clamped.",
    }, "discovery.well_known");
  }

  await probe(context, {
    id: "errors.unsupported_consistency",
    phase: "errors",
    description: "A non-local query consistency fails explicitly.",
  }, async () => {
    const response = await requestJson(context, "/v1/data/query", {
      method: "POST",
      json: { collections: [], consistency: "eventual" },
      auth: "valid",
    });
    expectError(response, 400, "unsupported_consistency");
  });

  await probe(context, {
    id: "errors.json_content_type",
    phase: "errors",
    description: "JSON POST routes reject a non-JSON Content-Type with a flat error.",
  }, async () => {
    const response = await requestJson(context, "/v1/data/query", {
      method: "POST",
      raw_body: "{}",
      content_type: "text/plain",
      auth: "valid",
    });
    expectError(response, 415, "unsupported_media_type");
  });
}

async function runAdvertisedLimitChecks(context: RunnerContext, manifest: ManifestView): Promise<void> {
  await probe(context, {
    id: "errors.query_limit",
    phase: "errors",
    description: "A query above the advertised maximum fails rather than being silently clamped.",
  }, async () => {
    requireProbe(manifest.limits.max_query_limit < Number.MAX_SAFE_INTEGER, "limit_not_safely_probeable", {}, "inconclusive");
    const response = await requestJson(context, "/v1/data/query", {
      method: "POST",
      json: { collections: [], limit: manifest.limits.max_query_limit + 1 },
      auth: "valid",
    });
    expectError(response, 400, "limit_exceeded");
  });

  await probe(context, {
    id: "errors.change_limit",
    phase: "errors",
    description: "A change page above the advertised maximum fails rather than being silently clamped.",
  }, async () => {
    requireProbe(manifest.limits.max_change_limit < Number.MAX_SAFE_INTEGER, "limit_not_safely_probeable", {}, "inconclusive");
    const query = new URLSearchParams({ limit: String(manifest.limits.max_change_limit + 1) });
    const response = await requestJson(context, `/v1/data/changes?${query}`, { auth: "valid" });
    expectError(response, 400, "limit_exceeded");
  });
}

async function runFixtureLifecycle(
  context: RunnerContext,
  options: DataNodeConformanceOptions,
): Promise<void> {
  const prerequisite = fixturePrerequisite(context, options);
  if (!prerequisite.ok) {
    inconclusiveProbe(context, {
      id: "records.fixture_prerequisite",
      phase: "records",
      description: "The explicitly acknowledged scratch fixture is safe to exercise.",
    }, prerequisite.reason);
    blockFixtureChecks(context, "records.fixture_prerequisite");
    return;
  }

  const { collection, manifest } = prerequisite;
  const fixture: FixtureState = {
    run_id: context.run_id,
    collection_id: collection.id,
    provisional_record_ids: [],
    owned_record_ids: [],
    tombstoned_record_ids: [],
    active_owned_record_ids: [],
  };
  context.fixture = fixture;

  let baselineCursor: string | undefined;
  const baseline = await probe(context, {
    id: "changes.fixture_baseline",
    phase: "changes",
    description: "The scratch collection feed reaches a terminal cursor before mutation.",
  }, () => drainChangeFeed(context, collection.id, manifest.limits.max_change_limit));
  if (baseline.ok) baselineCursor = baseline.value;

  if (!baselineCursor) {
    inconclusiveProbe(context, {
      id: "records.fixture_prerequisite",
      phase: "records",
      description: "The explicitly acknowledged scratch fixture is safe to exercise.",
    }, "change_baseline_unavailable");
    blockFixtureChecks(context, "changes.fixture_baseline", ["changes.fixture_baseline"]);
    return;
  }

  await probe(context, {
    id: "records.fixture_prerequisite",
    phase: "records",
    description: "The explicitly acknowledged scratch fixture is safe to exercise.",
  }, () => undefined);

  const doomedInput = fixtureTextInput(context.run_id, "doomed");
  const doomedRecollectInput = {
    ...doomedInput,
    metadata: {
      agent_data_conformance: {
        ...doomedInput.metadata.agent_data_conformance,
        refresh_marker: "must_not_replace_first_envelope",
      },
    },
  };
  const controlInput = fixtureTextInput(context.run_id, "control");
  const doomedBytes = new TextEncoder().encode(doomedInput.text);
  const controlBytes = new TextEncoder().encode(controlInput.text);
  const doomedHash = sha256(doomedBytes);
  const controlHash = sha256(controlBytes);

  let doomed: RecordView | undefined;
  let control: RecordView | undefined;
  let firstEnvelope: JsonMap | undefined;
  let createdCursor: string | undefined;
  let tombstoneCursor: string | undefined;
  let createdEvents: JsonMap[] = [];
  let createEventsVerified = false;
  let idempotencyVerified = false;

  try {
    const collectedDoomed = await probe(context, {
      id: "records.collect_owned_fixture",
      phase: "records",
      description: "The text collector inserts one uniquely marked owned fixture record.",
    }, async () => {
      const record = await collectOwnedFixture(
        context,
        collection.id,
        collection.schema_version,
        doomedInput,
        doomedHash,
        doomedBytes.byteLength,
      );
      rememberProvisionalFixture(fixture, record.id);
      return record;
    });
    if (collectedDoomed.ok) {
      doomed = collectedDoomed.value;
      firstEnvelope = doomed.raw;
    }

    if (doomed && firstEnvelope) {
      const idempotent = await probe(context, {
        id: "records.collect_idempotent",
        phase: "records",
        description: "Re-collecting identical caller bytes returns the same immutable first envelope without a second insert.",
      }, async () => {
        await attemptMutation(context, async () => {
          const response = await requestJson(context, "/v1/data/collect", {
            method: "POST",
            json: { collection_id: collection.id, collector_id: "text", input: doomedRecollectInput },
            auth: "valid",
          });
          expectStatus(response, 200);
          const record = validateCollectResponse(
            response.body,
            collection.id,
            collection.schema_version,
            doomedInput,
            doomedHash,
            doomedBytes.byteLength,
            {
            inserted: 0,
            existing: 1,
            },
          );
          requireProbe(record.id === doomed!.id, "record_id_changed_on_recollect");
          requireProbe(stableJson(record.raw) === stableJson(firstEnvelope!), "first_envelope_mutated");
        });
      });
      idempotencyVerified = idempotent.ok;
    } else {
      blockProbe(context, {
        id: "records.collect_idempotent",
        phase: "records",
        description: "Re-collecting identical caller bytes returns the same immutable first envelope without a second insert.",
      }, "records.collect_owned_fixture");
    }

    if (doomed && idempotencyVerified) {
      const collectedControl = await probe(context, {
        id: "records.collect_distinct_control",
        phase: "records",
        description: "Changed caller bytes create a distinct immutable control record.",
      }, async () => {
        const record = await collectOwnedFixture(
          context,
          collection.id,
          collection.schema_version,
          controlInput,
          controlHash,
          controlBytes.byteLength,
        );
        requireProbe(record.id !== doomed!.id, "changed_bytes_reused_record_id");
        rememberProvisionalFixture(fixture, record.id);
        return record;
      });
      if (collectedControl.ok) control = collectedControl.value;
    } else {
      blockProbe(context, {
        id: "records.collect_distinct_control",
        phase: "records",
        description: "Changed caller bytes create a distinct immutable control record.",
      }, doomed ? "records.collect_idempotent" : "records.collect_owned_fixture");
    }

    if (doomed && control) {
      const feed = await probe(context, {
        id: "changes.fixture_create_pagination",
        phase: "changes",
        description: "Owned creates page from the terminal baseline with stable IDs, increasing sequence, and no duplicate recollect event.",
      }, async () => {
        const pageOne = await getChangePage(context, collection.id, baselineCursor!, 1);
        requireProbe(pageOne.changes.length === 1 && pageOne.has_more, "first_fixture_page_shape");
        const eventOne = validateCreatedEvent(pageOne.changes[0]!, doomed!.id, doomed!.raw);

        const replay = await getChangePage(context, collection.id, baselineCursor!, 1);
        requireProbe(stableJson(replay as unknown as JsonMap) === stableJson(pageOne as unknown as JsonMap), "fixture_cursor_replay_changed");

        const pageTwo = await getChangePage(context, collection.id, pageOne.cursor, 1);
        requireProbe(pageTwo.changes.length === 1, "second_fixture_page_shape");
        const eventTwo = validateCreatedEvent(pageTwo.changes[0]!, control!.id, control!.raw);
        requireProbe(eventTwo.sequence > eventOne.sequence, "change_sequence_not_increasing");
        requireProbe(eventTwo.id !== eventOne.id, "change_id_reused");

        const terminal = await getChangePage(context, collection.id, pageTwo.cursor, 1);
        requireProbe(terminal.changes.length === 0 && terminal.has_more === false, "fixture_feed_not_terminal");
        return { cursor: terminal.cursor, events: [pageOne.changes[0]!, pageTwo.changes[0]!] };
      });
      if (feed.ok) {
        createdCursor = feed.value.cursor;
        createdEvents = feed.value.events;
        createEventsVerified = true;
      }

      await probe(context, {
        id: "changes.cursor_filter_binding",
        phase: "changes",
        description: "A collection-filtered cursor is rejected outside that filter.",
      }, async () => {
        const query = new URLSearchParams({ cursor: createdCursor ?? baselineCursor!, limit: "1" });
        const response = await requestJson(context, `/v1/data/changes?${query}`, { auth: "valid" });
        expectError(response, 400, "invalid_cursor");
      });
    } else {
      blockProbe(context, {
        id: "changes.fixture_create_pagination",
        phase: "changes",
        description: "Owned creates page from the terminal baseline with stable IDs, increasing sequence, and no duplicate recollect event.",
      }, !doomed ? "records.collect_owned_fixture" : "records.collect_distinct_control");
      blockProbe(context, {
        id: "changes.cursor_filter_binding",
        phase: "changes",
        description: "A collection-filtered cursor is rejected outside that filter.",
      }, "changes.fixture_create_pagination");
    }

    if (doomed) {
      const resolved = await probe(context, {
        id: "records.resolve_and_verify_digest",
        phase: "records",
        description: "Exact reads return both original fixture byte strings whose lengths and SHA-256 values match their immutable envelopes.",
      }, async () => {
        const response = await requestJson(context, `/v1/data/records/${encodeURIComponent(doomed!.id)}`, { auth: "valid" });
        expectStatus(response, 200);
        validateResolvedRecord(response.body, doomed!, doomedBytes);
        requireProbe(Boolean(control), "control_fixture_unavailable", {}, "inconclusive");
        const controlResponse = await requestJson(context, `/v1/data/records/${encodeURIComponent(control!.id)}`, { auth: "valid" });
        expectStatus(controlResponse, 200);
        validateResolvedRecord(controlResponse.body, control!, controlBytes);
      });
      if (resolved.ok && createEventsVerified && control) {
        confirmOwnedFixture(fixture, doomed.id);
        confirmOwnedFixture(fixture, control.id);
      }

      await probe(context, {
        id: "query.owned_fixture_active",
        phase: "query",
        description: "The active owned fixture is found through its scratch collection and exact envelope filter.",
      }, async () => {
        const records = await queryByRecordId(context, collection.id, doomed!);
        requireProbe(records.length === 1, "active_fixture_query_not_exact");
      });

      await probe(context, {
        id: "tombstones.reason_limit_nonmutating",
        phase: "tombstones",
        description: "An overlong tombstone reason is rejected and leaves the owned record active.",
      }, async () => {
        requireProbe(
          fixture.owned_record_ids.includes(doomed!.id),
          "fixture_ownership_not_independently_verified",
          {},
          "inconclusive",
        );
        await attemptMutation(context, async () => {
          const response = await requestJson(context, `/v1/data/records/${encodeURIComponent(doomed!.id)}/tombstone`, {
            method: "POST",
            json: { reason: "x".repeat(1001) },
            auth: "valid",
          });
          expectError(response, 400, "invalid_request");
          const active = await requestJson(context, `/v1/data/records/${encodeURIComponent(doomed!.id)}`, { auth: "valid" });
          expectStatus(active, 200);
        }, doomed!.id);
      });

      const tombstoned = await probe(context, {
        id: "tombstones.append_owned_fixture",
        phase: "tombstones",
        description: "A valid tombstone is appended only to the owned doomed fixture.",
      }, async () => {
        requireProbe(
          fixture.owned_record_ids.includes(doomed!.id),
          "fixture_ownership_not_independently_verified",
          {},
          "inconclusive",
        );
        requireProbe(
          !context.do_not_retry_record_ids.has(doomed!.id),
          "mutation_outcome_uncertain_no_retry",
          {},
          "inconclusive",
        );
        const body = await tombstoneOwnedFixture(
          context,
          doomed!.id,
          collection.id,
          `agent-data conformance ${context.run_id}`,
        );
        rememberTombstonedFixture(fixture, doomed!.id);
        return body;
      });

      if (tombstoned.ok) {
        await probe(context, {
          id: "tombstones.read_gone",
          phase: "tombstones",
          description: "An ordinary exact read of the tombstoned fixture returns record_tombstoned with HTTP 410.",
        }, async () => {
          const response = await requestJson(context, `/v1/data/records/${encodeURIComponent(doomed!.id)}`, { auth: "valid" });
          expectError(response, 410, "record_tombstoned");
        });

        if (control) {
          await probe(context, {
            id: "tombstones.query_isolation",
            phase: "tombstones",
            description: "Query excludes the tombstoned fixture while the distinct control remains active.",
          }, async () => {
            const gone = await queryByRecordId(context, collection.id, doomed!);
            const kept = await queryByRecordId(context, collection.id, control!);
            requireProbe(gone.length === 0, "tombstoned_fixture_still_queryable");
            requireProbe(kept.length === 1, "control_fixture_query_not_exact");
          });
        } else {
          blockProbe(context, {
            id: "tombstones.query_isolation",
            phase: "tombstones",
            description: "Query excludes the tombstoned fixture while the distinct control remains active.",
          }, "records.collect_distinct_control");
        }

        if (createdCursor) {
          const event = await probe(context, {
            id: "tombstones.change_event",
            phase: "tombstones",
            description: "The feed appends exactly one matching tombstone while retaining the original created envelope.",
          }, async () => {
            const page = await getChangePage(context, collection.id, createdCursor!, 1);
            requireProbe(page.changes.length === 1, "tombstone_event_missing");
            validateTombstoneEvent(
              page.changes[0]!,
              doomed!.id,
              collection.id,
              asObject(tombstoned.value.tombstone, "confirmed_tombstone"),
            );
            const original = createdEvents.find((entry) => entry.record_id === doomed!.id);
            requireProbe(Boolean(original), "created_event_not_retained");
            requireProbe(stableJson(asObject(original!.record, "created_event_record")) === stableJson(doomed!.raw), "created_envelope_changed");
            const terminal = await getChangePage(context, collection.id, page.cursor, 1);
            requireProbe(
              terminal.changes.length === 0 && terminal.has_more === false,
              "unexpected_extra_tombstone_event",
            );
            return terminal.cursor;
          });
          if (event.ok) tombstoneCursor = event.value;
        } else {
          blockProbe(context, {
            id: "tombstones.change_event",
            phase: "tombstones",
            description: "The feed appends exactly one matching tombstone while retaining the original created envelope.",
          }, "changes.fixture_create_pagination");
        }

        await probe(context, {
          id: "tombstones.idempotent",
          phase: "tombstones",
          description: "Repeating the authorised tombstone returns the same tombstone and appends no duplicate event.",
        }, async () => {
          await attemptMutation(context, async () => {
            const repeated = await requestJson(context, `/v1/data/records/${encodeURIComponent(doomed!.id)}/tombstone`, {
              method: "POST",
              json: { reason: "a later reason must not rewrite the first" },
              auth: "valid",
            });
            expectStatus(repeated, 200);
            requireProbe(stableJson(repeated.body) === stableJson(tombstoned.value), "tombstone_changed_on_repeat");
            if (tombstoneCursor) {
              const terminal = await getChangePage(context, collection.id, tombstoneCursor, 1);
              requireProbe(
                terminal.changes.length === 0 && terminal.has_more === false,
                "duplicate_tombstone_event",
              );
            }
          }, doomed!.id);
        });
      } else {
        blockTombstoneDependents(context, "tombstones.append_owned_fixture");
      }
    } else {
      blockRecordDependents(context, "records.collect_owned_fixture");
    }
  } finally {
    await finalizeOwnedFixtures(context, fixture);
  }
}

function fixturePrerequisite(
  context: RunnerContext,
  options: DataNodeConformanceOptions,
): { ok: true; collection: CollectionView; manifest: ManifestView } | { ok: false; reason: string } {
  if (!context.token) return { ok: false, reason: "credential_missing" };
  if (!context.manifest) return { ok: false, reason: "manifest_unavailable" };
  if (!context.discovery_verified) return { ok: false, reason: "manifest_pair_not_verified" };
  if (!context.collections) return { ok: false, reason: "collection_list_unavailable" };
  if (context.manifest.node_id !== options.expected_node_id) return { ok: false, reason: "expected_node_mismatch" };
  if (!options.acknowledge_persistent_residue) return { ok: false, reason: "persistent_residue_not_acknowledged" };
  const textCollector = context.manifest.collectors.some((collector) => collector.collector_id === "text");
  if (!textCollector) return { ok: false, reason: "text_collector_not_advertised" };
  const collection = context.collections.find((candidate) => candidate.id === options.collection_id);
  if (!collection) return { ok: false, reason: "scratch_collection_not_found" };
  if (collection.allowed_media_types && !collection.allowed_media_types.includes("text/plain")) {
    return { ok: false, reason: "scratch_collection_rejects_text_plain" };
  }
  const requiredRecordBytes = Math.max(
    new TextEncoder().encode(fixtureTextInput(context.run_id, "doomed").text).byteLength,
    new TextEncoder().encode(fixtureTextInput(context.run_id, "control").text).byteLength,
  );
  if (
    Math.min(collection.max_record_bytes ?? Number.MAX_SAFE_INTEGER, context.manifest.limits.max_record_bytes)
      < requiredRecordBytes
  ) {
    return { ok: false, reason: "scratch_collection_record_limit_too_small" };
  }
  const largestFixtureBody = Math.max(
    jsonByteLength({ collection_id: collection.id, collector_id: "text", input: fixtureTextInput(context.run_id, "doomed") }),
    jsonByteLength({ reason: "x".repeat(1001) }),
  );
  if (context.manifest.limits.max_body_bytes < largestFixtureBody) {
    return { ok: false, reason: "scratch_fixture_exceeds_body_limit" };
  }
  return { ok: true, collection, manifest: context.manifest };
}

async function collectOwnedFixture(
  context: RunnerContext,
  collectionId: string,
  schemaVersion: string,
  input: ReturnType<typeof fixtureTextInput>,
  expectedHash: string,
  expectedSize: number,
): Promise<RecordView> {
  return attemptMutation(context, async () => {
    const response = await requestJson(context, "/v1/data/collect", {
      method: "POST",
      json: { collection_id: collectionId, collector_id: "text", input },
      auth: "valid",
    });
    expectStatus(response, 200);
    return validateCollectResponse(response.body, collectionId, schemaVersion, input, expectedHash, expectedSize, {
      inserted: 1,
      existing: 0,
    });
  });
}

async function tombstoneOwnedFixture(
  context: RunnerContext,
  recordId: string,
  collectionId: string,
  reason: string,
): Promise<JsonMap> {
  return attemptMutation(context, async () => {
    const response = await requestJson(context, `/v1/data/records/${encodeURIComponent(recordId)}/tombstone`, {
      method: "POST",
      json: { reason },
      auth: "valid",
    });
    expectStatus(response, 200);
    validateTombstoneResponse(response.body, recordId, collectionId, reason);
    return response.body;
  }, recordId);
}

async function finalizeOwnedFixtures(
  context: RunnerContext,
  fixture: FixtureState,
): Promise<void> {
  const remaining = [...fixture.active_owned_record_ids]
    .filter((recordId) => !context.do_not_retry_record_ids.has(recordId));
  const uncertain = fixture.active_owned_record_ids
    .filter((recordId) => context.do_not_retry_record_ids.has(recordId));
  await probe(context, {
    id: "tombstones.fixture_finalization",
    phase: "tombstones",
    description: "Every proven-owned active fixture was logically tombstoned without claiming physical erasure.",
  }, async () => {
    for (const recordId of remaining) {
      await tombstoneOwnedFixture(
        context,
        recordId,
        fixture.collection_id,
        `agent-data conformance finalization ${context.run_id}`,
      );
      rememberTombstonedFixture(fixture, recordId);
    }
    requireProbe(
      uncertain.length === 0
        && fixture.provisional_record_ids.length === 0
        && !context.mutation_uncertain,
      "mutation_outcome_uncertain_no_retry",
      {},
      "inconclusive",
    );
  });
}

async function attemptMutation<T>(
  context: RunnerContext,
  operation: () => Promise<T>,
  noRetryRecordId?: string,
): Promise<T> {
  context.mutation_started = true;
  try {
    return await operation();
  } catch (error) {
    context.mutation_uncertain = true;
    if (noRetryRecordId) context.do_not_retry_record_ids.add(noRetryRecordId);
    throw error;
  }
}

export function formatDataNodeConformanceReport(report: DataNodeConformanceReport): string {
  const lines = [
    `${report.verdict.toUpperCase()} ${report.suite.profile} (${report.run.profile})`,
    `Target: ${JSON.stringify(report.target.origin)}${report.target.node_id ? `  node_id=${JSON.stringify(report.target.node_id)}` : ""}`,
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.inconclusive} inconclusive, ${report.summary.skipped} skipped`,
    "",
  ];
  for (const check of report.checks) {
    const reason = check.reason_code ? ` (${check.reason_code})` : "";
    const level = check.level === "advisory" ? "/ADVISORY" : "";
    lines.push(`[${check.status.toUpperCase()}${level}] ${check.id}${reason}`);
  }
  if (report.mutation.requested) {
    lines.push(
      "",
      `Mutation: started=${report.mutation.started} record_created=${report.mutation.record_created} tombstone_appended=${report.mutation.tombstone_appended} uncertain=${report.mutation.uncertain}`,
      ...(report.mutation.fixture
        ? [`Fixture counts: owned=${report.mutation.fixture.owned_records} unverified=${report.mutation.fixture.unverified_records} tombstoned=${report.mutation.fixture.tombstoned_records} active_owned=${report.mutation.fixture.active_owned_records}`]
        : []),
      "Fixture tombstones are logical history, not physical cleanup or secure erasure.",
    );
  }
  lines.push(
    "",
    "PASS covers only the selected executable profile at this target and observation time.",
    "This report is not a security certification, identity endorsement, source-truth proof, durability proof, or secure-erasure proof.",
  );
  return lines.join("\n");
}

async function probe<T>(
  context: RunnerContext,
  definition: ProbeDefinition,
  operation: () => T | Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const started = performance.now();
  try {
    const value = await operation();
    pushCheck(context, {
      ...definition,
      level: definition.level ?? "required",
      status: "pass",
      duration_ms: elapsedMs(started),
    });
    return { ok: true, value };
  } catch (error) {
    const failure = error instanceof ProbeFailure
      ? error
      : new ProbeFailure("inconclusive", "runner_internal_error");
    pushCheck(context, {
      ...definition,
      level: definition.level ?? "required",
      status: failure.status,
      duration_ms: elapsedMs(started),
      reason_code: failure.reason_code,
      ...(Object.keys(failure.evidence).length ? { evidence: failure.evidence } : {}),
    });
    return { ok: false };
  }
}

function blockProbe(context: RunnerContext, definition: ProbeDefinition, blockedBy: string): void {
  pushCheck(context, {
    ...definition,
    level: definition.level ?? "required",
    status: "inconclusive",
    duration_ms: 0,
    reason_code: "prerequisite_inconclusive",
    evidence: { blocked_by: safeReason(blockedBy) },
  });
}

function inconclusiveProbe(context: RunnerContext, definition: ProbeDefinition, reason: string): void {
  pushCheck(context, {
    ...definition,
    level: definition.level ?? "required",
    status: "inconclusive",
    duration_ms: 0,
    reason_code: safeReason(reason),
  });
}

function skipProbe(context: RunnerContext, definition: ProbeDefinition, reason: string): void {
  pushCheck(context, {
    ...definition,
    level: definition.level ?? "advisory",
    status: "skip",
    duration_ms: 0,
    reason_code: safeReason(reason),
  });
}

function pushCheck(context: RunnerContext, check: DataNodeConformanceCheck): void {
  if (context.checks.some((existing) => existing.id === check.id)) {
    throw new DataNodeConformanceConfigError("duplicate_check_id", `Conformance check '${check.id}' was recorded twice`);
  }
  context.checks.push(check);
}

function requireProbe(
  condition: unknown,
  code: string,
  evidence: SafeEvidence = {},
  status: "fail" | "inconclusive" = "fail",
): asserts condition {
  if (!condition) throw new ProbeFailure(status, code, evidence);
}

function expectStatus(response: ProbeResponse, expected: number): void {
  requireProbe(response.status === expected, "unexpected_http_status", { observed_status: response.status });
}

function expectError(response: ProbeResponse, status: number, code: string): void {
  requireProbe(response.status === status, "unexpected_http_status", { observed_status: response.status });
  const observedCode = response.body.error;
  requireProbe(typeof observedCode === "string", "missing_error_code", { observed_status: response.status });
  requireProbe(observedCode === code, "unexpected_error_code", {
    observed_status: response.status,
  });
  requireProbe(typeof response.body.message === "string" && response.body.message.length > 0, "missing_error_message", {
    observed_status: response.status,
  });
  if (response.body.details !== undefined) {
    requireProbe(isObject(response.body.details), "invalid_error_details", {
      observed_status: response.status,
    });
  }
}

function expectAuthRejection(response: ProbeResponse, bearerExpectedConfigured: boolean): void {
  if (!bearerExpectedConfigured && response.status === 503) {
    expectError(response, 503, "data_auth_not_configured");
    return;
  }
  if (bearerExpectedConfigured && response.status === 503) {
    expectError(response, 503, "data_auth_not_configured");
    throw new ProbeFailure("inconclusive", "data_auth_not_configured", { observed_status: 503 });
  }
  if (response.status === 429) {
    throw new ProbeFailure("inconclusive", "target_rate_limited", { observed_status: 429 });
  }
  expectError(response, 401, "unauthorized");
  const challenge = response.headers.get("www-authenticate") ?? "";
  requireProbe(
    /(?:^|,\s*)Bearer(?:\s|$)/i.test(challenge),
    "missing_bearer_challenge",
    { observed_status: response.status },
  );
}

function expectAuthenticatedSuccess(response: ProbeResponse): void {
  if (response.status === 401 || response.status === 403) {
    throw new ProbeFailure("inconclusive", "credential_rejected", { observed_status: response.status });
  }
  if (response.status === 429) {
    throw new ProbeFailure("inconclusive", "target_rate_limited", { observed_status: response.status });
  }
  if (response.status >= 500) {
    throw new ProbeFailure("inconclusive", "target_server_error", { observed_status: response.status });
  }
  expectStatus(response, 200);
}

interface RequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  raw_body?: string;
  content_type?: string;
  auth: "none" | "valid" | "invalid";
}

async function requestJson(
  context: RunnerContext,
  path: string,
  options: RequestOptions,
): Promise<ProbeResponse> {
  requireProbe(path.startsWith("/"), "unsafe_request_path", {}, "inconclusive");
  const url = new URL(path, `${context.target}/`);
  requireProbe(url.origin === context.target, "request_origin_changed", {}, "inconclusive");
  const headers = new Headers({ accept: "application/json" });
  if (options.auth === "valid") {
    requireProbe(Boolean(context.token), "credential_missing", {}, "inconclusive");
    headers.set("authorization", `Bearer ${context.token!}`);
  } else if (options.auth === "invalid") {
    headers.set("authorization", `Bearer ${context.invalid_token}`);
  }

  let body: string | undefined;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set("content-type", "application/json");
  } else if (options.raw_body !== undefined) {
    body = options.raw_body;
    headers.set("content-type", options.content_type ?? "application/octet-stream");
  }

  let response: Response;
  try {
    response = await context.fetch(url, {
      method: options.method ?? "GET",
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(context.timeout_ms),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "TimeoutError"
      ? "request_timeout"
      : "request_failed";
    throw new ProbeFailure("inconclusive", code);
  }

  if (response.redirected) {
    context.followed_redirect_observed = true;
    try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
    throw new ProbeFailure("fail", "redirect_was_followed", { observed_status: response.status });
  }
  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      throw new ProbeFailure("fail", "response_url_invalid", { observed_status: response.status });
    }
    if (responseUrl.href !== url.href) {
      context.followed_redirect_observed = true;
      try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
      throw new ProbeFailure("fail", "response_url_changed", { observed_status: response.status });
    }
  }
  if (response.status < 100 || response.status > 599) {
    try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
    throw new ProbeFailure("inconclusive", "invalid_response_status");
  }

  if (response.status >= 300 && response.status < 400) {
    try {
      await response.body?.cancel();
    } catch {
      // The redirect is already a terminal failure; cancellation is best effort.
    }
    throw new ProbeFailure("fail", "redirect_refused", { observed_status: response.status });
  }
  const protectedAuthDisabledResponse = response.status === 503
    && options.auth !== "valid"
    && url.pathname.startsWith("/v1/data/");
  if (response.status === 429 || (response.status >= 500 && !protectedAuthDisabledResponse)) {
    try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
    throw new ProbeFailure(
      "inconclusive",
      response.status === 429 ? "target_rate_limited" : "target_server_error",
      { observed_status: response.status },
    );
  }
  if (options.auth === "valid" && (response.status === 401 || response.status === 403)) {
    try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
    throw new ProbeFailure("inconclusive", "credential_rejected", { observed_status: response.status });
  }
  const parsed = await readBoundedJsonResponse(response, context.max_response_bytes);
  return { status: response.status, headers: response.headers, body: parsed };
}

async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<JsonMap> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  requireProbe(contentType === "application/json", "invalid_response_content_type", {
    observed_status: response.status,
  });
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    requireProbe(Number.isSafeInteger(declared) && declared >= 0, "invalid_response_content_length", {
      observed_status: response.status,
    });
    requireProbe(declared <= maxBytes, "response_too_large", {
      observed_status: response.status,
    }, "inconclusive");
  }

  const bytes = await readBoundedBody(response.body, maxBytes, response.status);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProbeFailure("fail", "invalid_response_utf8", { observed_status: response.status });
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw new ProbeFailure("fail", "invalid_response_json", { observed_status: response.status });
  }
  requireProbe(isObject(value), "response_not_json_object", { observed_status: response.status });
  return value;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  status: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ProbeFailure("inconclusive", "response_too_large", { observed_status: status });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure("inconclusive", "response_read_failed", { observed_status: status });
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function validateManifest(body: JsonMap, target: string): ManifestView {
  requireProbe(body.protocol === "agent-data/v1", "manifest_protocol_mismatch");
  const nodeId = requiredString(body.node_id, "manifest_node_id");
  validateTimestamp(body.generated_at, "manifest_generated_at");
  if (body.base_url !== undefined) requireProbe(body.base_url === target, "manifest_base_url_mismatch");

  const endpoints = asObject(body.endpoints, "manifest_endpoints");
  requireProbe(Object.keys(EXPECTED_ENDPOINTS).every((key) => Object.hasOwn(endpoints, key)), "manifest_endpoint_missing");
  for (const [name, path] of Object.entries(EXPECTED_ENDPOINTS)) {
    const endpoint = requiredString(endpoints[name], `manifest_endpoint_${name}`);
    requireProbe(endpoint === `${target}${path}`, "manifest_endpoint_mismatch");
    let parsed: URL;
    try {
      parsed = new URL(endpoint.replace("{id}", "record-id-placeholder"));
    } catch {
      throw new ProbeFailure("fail", "manifest_endpoint_invalid");
    }
    requireProbe(parsed.origin === target && !parsed.username && !parsed.password, "manifest_endpoint_origin_mismatch");
  }

  const capabilities = asObject(body.capabilities, "manifest_capabilities");
  const consistency = capabilities.consistency;
  requireProbe(
    Array.isArray(consistency)
      && consistency.includes("local")
      && consistency.every((value) => typeof value === "string" && value.length > 0)
      && new Set(consistency).size === consistency.length,
    "manifest_consistency_invalid",
  );
  for (const field of [
    "immutable_records",
    "content_addressed_blobs",
    "full_text_search",
    "opaque_change_cursors",
    "tombstones",
    "peer_sync",
    "signature_verification",
    "schema_validation",
  ]) {
    requireProbe(typeof capabilities[field] === "boolean", "manifest_capability_invalid");
  }
  requireProbe(capabilities.immutable_records === true, "manifest_immutable_records_missing");
  requireProbe(capabilities.content_addressed_blobs === true, "manifest_content_addressing_missing");
  requireProbe(capabilities.opaque_change_cursors === true, "manifest_opaque_cursors_missing");
  requireProbe(capabilities.tombstones === true, "manifest_tombstones_missing");
  requireProbe(capabilities.http_data_auth === "dedicated_node_bearer", "manifest_auth_profile_mismatch");
  const enforcement = asObject(capabilities.policy_enforcement, "manifest_policy_enforcement");
  for (const field of ["max_record_bytes", "allowed_media_types", "visibility", "ttl", "allowed_dids", "retention"]) {
    requireProbe(typeof enforcement[field] === "boolean", "manifest_policy_capability_invalid");
  }

  const collectorsValue = body.collectors;
  requireProbe(Array.isArray(collectorsValue), "manifest_collectors_invalid");
  const collectors = collectorsValue.map((entry) => {
    const collector = asObject(entry, "manifest_collector");
    const id = requiredString(collector.collector_id, "collector_id");
    requireProbe(id.length <= 256, "runner_collector_id_bound_exceeded", {}, "inconclusive");
    requiredString(collector.description, "collector_description");
    if (collector.input_schema !== undefined) asObject(collector.input_schema, "collector_input_schema");
    return collector;
  });
  const collectorIds = collectors.map((collector) => collector.collector_id as string);
  requireProbe(new Set(collectorIds).size === collectorIds.length, "collector_id_duplicate");

  const limitsObject = asObject(body.limits, "manifest_limits");
  const limits = Object.fromEntries(LIMIT_FIELDS.map((field) => {
    const value = limitsObject[field];
    requireProbe(Number.isSafeInteger(value) && (value as number) > 0, "manifest_limit_invalid");
    return [field, value as number];
  })) as ManifestView["limits"];
  requireProbe(limits.default_query_limit <= limits.max_query_limit, "manifest_query_limits_inconsistent");
  requireProbe(limits.default_change_limit <= limits.max_change_limit, "manifest_change_limits_inconsistent");

  return { raw: body, node_id: nodeId, collectors, limits };
}

function validateCollections(body: JsonMap): CollectionView[] {
  requireProbe(Array.isArray(body.collections), "collections_wrapper_invalid");
  const collections = body.collections.map((entry) => {
    const collection = asObject(entry, "collection");
    requireProbe(collection.protocol === "agent-data/v1", "collection_protocol_mismatch");
    const id = requiredString(collection.id, "collection_id");
    requireProbe(id.length <= 512, "runner_collection_id_bound_exceeded", {}, "inconclusive");
    if (collection.name !== undefined) requiredString(collection.name, "collection_name");
    if (collection.description !== undefined) requiredString(collection.description, "collection_description");
    const schema = asObject(collection.schema, "collection_schema");
    const schemaVersion = requiredString(schema.version, "collection_schema_version");
    if (schema.json_schema !== undefined) asObject(schema.json_schema, "collection_json_schema");
    const policy = collection.policy === undefined ? {} : asObject(collection.policy, "collection_policy");
    if (policy.visibility !== undefined) {
      requireProbe(policy.visibility === "private" || policy.visibility === "public", "collection_visibility_invalid");
    }
    if (policy.max_record_bytes !== undefined) {
      requireProbe(Number.isSafeInteger(policy.max_record_bytes) && (policy.max_record_bytes as number) > 0, "collection_record_limit_invalid");
    }
    if (policy.allowed_media_types !== undefined) {
      requireProbe(
        Array.isArray(policy.allowed_media_types)
          && policy.allowed_media_types.every((value) => typeof value === "string" && isNormalizedMediaType(value)),
        "collection_media_types_invalid",
      );
    }
    if (policy.retention_days !== undefined) {
      requireProbe(typeof policy.retention_days === "number" && Number.isFinite(policy.retention_days) && policy.retention_days > 0, "collection_retention_invalid");
    }
    if (policy.ttl_seconds !== undefined) {
      requireProbe(Number.isSafeInteger(policy.ttl_seconds) && (policy.ttl_seconds as number) > 0, "collection_ttl_invalid");
    }
    if (policy.allowed_dids !== undefined) {
      requireProbe(
        Array.isArray(policy.allowed_dids)
          && policy.allowed_dids.every((value) => typeof value === "string" && value.startsWith("did:")),
        "collection_allowed_dids_invalid",
      );
    }
    validateTimestamp(collection.created_at, "collection_created_at");
    return {
      raw: collection,
      id,
      schema_version: schemaVersion,
      ...(typeof policy.max_record_bytes === "number" ? { max_record_bytes: policy.max_record_bytes } : {}),
      ...(Array.isArray(policy.allowed_media_types) ? { allowed_media_types: policy.allowed_media_types as string[] } : {}),
    };
  });
  requireProbe(new Set(collections.map((collection) => collection.id)).size === collections.length, "collection_id_duplicate");
  return collections;
}

function validateCollectResponse(
  body: JsonMap,
  collectionId: string,
  schemaVersion: string,
  input: ReturnType<typeof fixtureTextInput>,
  expectedHash: string,
  expectedSize: number,
  counts: { inserted: number; existing: number },
): RecordView {
  requireProbe(body.inserted === counts.inserted && body.existing === counts.existing, "collect_counts_mismatch");
  requireProbe(Array.isArray(body.records) && body.records.length === 1, "collect_record_count_mismatch");
  if (body.cursor !== undefined) requiredString(body.cursor, "collect_cursor");
  return validateRecord(body.records[0], collectionId, schemaVersion, input, expectedHash, expectedSize);
}

function validateRecord(
  value: unknown,
  collectionId: string,
  schemaVersion: string,
  input: ReturnType<typeof fixtureTextInput>,
  expectedHash: string,
  expectedSize: number,
): RecordView {
  const record = asObject(value, "record");
  requireProbe(record.protocol === "agent-data/v1", "record_protocol_mismatch");
  const id = requiredString(record.id, "record_id");
  requireProbe(id.length <= 1_024, "runner_record_id_bound_exceeded", {}, "inconclusive");
  requireProbe(record.collection_id === collectionId, "record_collection_mismatch");
  const source = asObject(record.source, "record_source");
  requireProbe(source.collector_id === "text", "record_collector_mismatch");
  requireProbe(source.uri === input.source_uri, "record_source_mismatch");
  requireProbe(source.external_id === input.external_id, "record_external_id_mismatch");
  const content = asObject(record.content, "record_content");
  requireProbe(content.sha256 === expectedHash, "record_digest_mismatch");
  requireProbe(content.size === expectedSize, "record_size_mismatch");
  requireProbe(content.media_type === "text/plain", "record_media_type_mismatch");
  requiredString(content.blob_ref, "record_blob_ref");
  requireProbe(record.schema_version === schemaVersion, "record_schema_version_mismatch");
  requireProbe(stableJson(asObject(record.metadata, "record_metadata")) === stableJson(input.metadata), "record_metadata_mismatch");
  requireProbe(record.key === input.key, "record_key_mismatch");
  requireProbe(record.version === input.version, "record_version_mismatch");
  requireProbe(record.supersedes_id === undefined, "record_unexpected_supersedes_id");
  if (record.provenance !== undefined) validateProvenance(record.provenance);
  if (record.signature !== undefined) validateSignature(record.signature);
  validateTimestamp(record.ingested_at, "record_ingested_at");
  requireProbe(record.observed_at === undefined, "record_unexpected_observed_at");
  return {
    raw: record,
    id,
    collection_id: collectionId,
    source_uri: input.source_uri,
    sha256: expectedHash,
    size: expectedSize,
    media_type: "text/plain",
  };
}

function validateResolvedRecord(body: JsonMap, expected: RecordView, expectedBytes: Uint8Array): void {
  requireProbe(stableJson(asObject(body.record, "resolved_record")) === stableJson(expected.raw), "resolved_envelope_mismatch");
  const content = asObject(body.content, "resolved_content");
  const encoding = content.encoding;
  const data = content.data;
  requireProbe((encoding === "utf8" || encoding === "base64") && typeof data === "string", "resolved_content_invalid");
  let bytes: Uint8Array;
  if (encoding === "utf8") {
    bytes = new TextEncoder().encode(data as string);
  } else {
    try {
      const buffer = Buffer.from(data as string, "base64");
      requireProbe(buffer.toString("base64") === data, "resolved_base64_invalid");
      bytes = new Uint8Array(buffer);
    } catch (error) {
      if (error instanceof ProbeFailure) throw error;
      throw new ProbeFailure("fail", "resolved_base64_invalid");
    }
  }
  requireProbe(Buffer.from(bytes).equals(Buffer.from(expectedBytes)), "resolved_bytes_mismatch");
  requireProbe(bytes.byteLength === expected.size && sha256(bytes) === expected.sha256, "resolved_digest_mismatch");
}

function validateProvenance(value: unknown): void {
  requireProbe(Array.isArray(value), "record_provenance_invalid");
  for (const entryValue of value) {
    const entry = asObject(entryValue, "record_provenance_entry");
    requiredString(entry.activity, "record_provenance_activity");
    validateTimestamp(entry.at, "record_provenance_at");
    if (entry.actor !== undefined) requiredString(entry.actor, "record_provenance_actor");
    if (entry.input_ids !== undefined) {
      requireProbe(
        Array.isArray(entry.input_ids)
          && entry.input_ids.every((inputId) => typeof inputId === "string" && !hasControlCharacter(inputId)),
        "record_provenance_input_ids_invalid",
      );
    }
  }
}

function validateSignature(value: unknown): void {
  const signature = asObject(value, "record_signature");
  requiredString(signature.algorithm, "record_signature_algorithm");
  requiredString(signature.signer, "record_signature_signer");
  requiredString(signature.value, "record_signature_value");
}

async function queryByRecordId(
  context: RunnerContext,
  collectionId: string,
  expected: RecordView,
): Promise<JsonMap[]> {
  const response = await requestJson(context, "/v1/data/query", {
    method: "POST",
    json: { collections: [collectionId], where: { id: expected.id }, consistency: "local", limit: 1 },
    auth: "valid",
  });
  expectStatus(response, 200);
  requireProbe(response.body.consistency === "local" && Array.isArray(response.body.records), "query_response_invalid");
  return response.body.records.map((value) => {
    const hit = asObject(value, "query_hit");
    const record = asObject(hit.record, "query_record");
    requireProbe(record.id === expected.id, "query_record_id_mismatch");
    requireProbe(record.collection_id === collectionId, "query_record_collection_mismatch");
    requireProbe(stableJson(record) === stableJson(expected.raw), "query_record_envelope_mismatch");
    if (hit.score !== undefined) requireProbe(typeof hit.score === "number" && Number.isFinite(hit.score), "query_score_invalid");
    return record;
  });
}

function validateChangePage(body: JsonMap, requestedLimit: number): ChangePage {
  requireProbe(Array.isArray(body.changes) && body.changes.length <= requestedLimit, "change_page_invalid");
  const cursor = requiredString(body.cursor, "change_cursor");
  requireProbe(typeof body.has_more === "boolean", "change_has_more_invalid");
  for (const value of body.changes) {
    const change = asObject(value, "change_event");
    requiredString(change.id, "change_id");
    requireProbe(change.type === "record.created" || change.type === "record.tombstoned", "change_type_invalid");
    requireProbe(Number.isSafeInteger(change.sequence) && (change.sequence as number) > 0, "change_sequence_invalid");
    requiredString(change.collection_id, "change_collection_id");
    requiredString(change.record_id, "change_record_id");
    validateTimestamp(change.occurred_at, "change_occurred_at");
  }
  return { changes: body.changes as JsonMap[], cursor, has_more: body.has_more as boolean };
}

async function getChangePage(
  context: RunnerContext,
  collectionId: string,
  cursor: string | undefined,
  limit: number,
): Promise<ChangePage> {
  const query = new URLSearchParams({ collection_id: collectionId, limit: String(limit) });
  if (cursor !== undefined) query.set("cursor", cursor);
  const response = await requestJson(context, `/v1/data/changes?${query}`, { auth: "valid" });
  expectStatus(response, 200);
  return validateChangePage(response.body, limit);
}

async function drainChangeFeed(context: RunnerContext, collectionId: string, advertisedLimit: number): Promise<string> {
  const limit = Math.min(advertisedLimit, 1_000);
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < context.max_change_pages; pageNumber += 1) {
    const page = await getChangePage(context, collectionId, cursor, limit);
    cursor = page.cursor;
    if (!page.has_more) return cursor;
  }
  throw new ProbeFailure("inconclusive", "change_baseline_page_cap_reached");
}

function validateCreatedEvent(event: JsonMap, recordId: string, envelope: JsonMap): { id: string; sequence: number } {
  requireProbe(event.type === "record.created" && event.record_id === recordId, "created_event_mismatch");
  requireProbe(stableJson(asObject(event.record, "created_event_record")) === stableJson(envelope), "created_event_envelope_mismatch");
  return {
    id: requiredString(event.id, "created_event_id"),
    sequence: requiredInteger(event.sequence, "created_event_sequence"),
  };
}

function validateTombstoneResponse(
  body: JsonMap,
  recordId: string,
  collectionId: string,
  expectedReason: string,
): void {
  requireProbe(body.record_id === recordId && body.tombstoned === true, "tombstone_response_mismatch");
  const tombstone = asObject(body.tombstone, "tombstone");
  requireProbe(tombstone.record_id === recordId && tombstone.collection_id === collectionId, "tombstone_identity_mismatch");
  requireProbe(tombstone.reason === expectedReason, "tombstone_reason_mismatch");
  validateTimestamp(tombstone.tombstoned_at, "tombstone_time");
}

function validateTombstoneEvent(
  event: JsonMap,
  recordId: string,
  collectionId: string,
  expectedTombstone: JsonMap,
): void {
  requireProbe(event.type === "record.tombstoned" && event.record_id === recordId, "tombstone_event_mismatch");
  requireProbe(event.collection_id === collectionId, "tombstone_event_collection_mismatch");
  const tombstone = asObject(event.tombstone, "tombstone_event_payload");
  requireProbe(tombstone.record_id === recordId && tombstone.collection_id === collectionId, "tombstone_event_payload_mismatch");
  requireProbe(stableJson(tombstone) === stableJson(expectedTombstone), "tombstone_event_payload_changed");
}

function fixtureTextInput(runId: string, role: "doomed" | "control") {
  return {
    text: `agent data conformance sentinel ${runId} ${role}`,
    media_type: "text/plain",
    source_uri: `urn:agent-data:conformance:${runId}:${role}`,
    external_id: `${runId}:${role}`,
    key: `conformance-${runId}-${role}`,
    version: "1",
    metadata: {
      agent_data_conformance: {
        suite: AGENT_DATA_CONFORMANCE_SUITE,
        run_id: runId,
        role,
      },
    },
  } as const;
}

function rememberProvisionalFixture(fixture: FixtureState, recordId: string): void {
  if (!fixture.provisional_record_ids.includes(recordId)) fixture.provisional_record_ids.push(recordId);
}

function confirmOwnedFixture(fixture: FixtureState, recordId: string): void {
  requireProbe(fixture.provisional_record_ids.includes(recordId), "fixture_record_not_provisional", {}, "inconclusive");
  fixture.provisional_record_ids = fixture.provisional_record_ids.filter((candidate) => candidate !== recordId);
  if (!fixture.owned_record_ids.includes(recordId)) fixture.owned_record_ids.push(recordId);
  if (!fixture.active_owned_record_ids.includes(recordId)) fixture.active_owned_record_ids.push(recordId);
}

function rememberTombstonedFixture(fixture: FixtureState, recordId: string): void {
  if (!fixture.tombstoned_record_ids.includes(recordId)) fixture.tombstoned_record_ids.push(recordId);
  fixture.active_owned_record_ids = fixture.active_owned_record_ids.filter((candidate) => candidate !== recordId);
}

function fixtureReport(fixture: FixtureState): DataNodeConformanceFixtureReport {
  return {
    run_id: fixture.run_id,
    collection_id: fixture.collection_id,
    owned_records: fixture.owned_record_ids.length,
    unverified_records: fixture.provisional_record_ids.length,
    tombstoned_records: fixture.tombstoned_record_ids.length,
    active_owned_records: fixture.active_owned_record_ids.length,
    persistent_history_expected: true,
    physical_erasure_verified: false,
  };
}

function blockFixtureChecks(context: RunnerContext, blockedBy: string, exclusions: string[] = []): void {
  const definitions: ProbeDefinition[] = [
    { id: "changes.fixture_baseline", phase: "changes", description: "The scratch collection feed reaches a terminal cursor before mutation." },
    { id: "records.collect_owned_fixture", phase: "records", description: "The text collector inserts one uniquely marked owned fixture record." },
    { id: "records.collect_idempotent", phase: "records", description: "Re-collecting identical caller bytes returns the same immutable first envelope without a second insert." },
    { id: "records.collect_distinct_control", phase: "records", description: "Changed caller bytes create a distinct immutable control record." },
    { id: "changes.fixture_create_pagination", phase: "changes", description: "Owned creates page from the terminal baseline with stable IDs, increasing sequence, and no duplicate recollect event." },
    { id: "changes.cursor_filter_binding", phase: "changes", description: "A collection-filtered cursor is rejected outside that filter." },
    { id: "records.resolve_and_verify_digest", phase: "records", description: "Exact record read returns the original bytes whose length and SHA-256 match the immutable envelope." },
    { id: "query.owned_fixture_active", phase: "query", description: "The active owned fixture is found through its scratch collection and exact envelope filter." },
    { id: "tombstones.reason_limit_nonmutating", phase: "tombstones", description: "An overlong tombstone reason is rejected and leaves the owned record active." },
    { id: "tombstones.append_owned_fixture", phase: "tombstones", description: "A valid tombstone is appended only to the owned doomed fixture." },
    { id: "tombstones.read_gone", phase: "tombstones", description: "An ordinary exact read of the tombstoned fixture returns record_tombstoned with HTTP 410." },
    { id: "tombstones.query_isolation", phase: "tombstones", description: "Query excludes the tombstoned fixture while the distinct control remains active." },
    { id: "tombstones.change_event", phase: "tombstones", description: "The feed appends exactly one matching tombstone while retaining the original created envelope." },
    { id: "tombstones.idempotent", phase: "tombstones", description: "Repeating the authorised tombstone returns the same tombstone and appends no duplicate event." },
    { id: "tombstones.fixture_finalization", phase: "tombstones", description: "Every proven-owned active fixture was logically tombstoned without claiming physical erasure." },
  ];
  for (const definition of definitions) {
    if (exclusions.includes(definition.id) || context.checks.some((check) => check.id === definition.id)) continue;
    blockProbe(context, definition, blockedBy);
  }
}

function blockAuthenticatedCore(context: RunnerContext, blockedBy: string): void {
  const definitions: ProbeDefinition[] = [
    { id: "query.empty_collection_filter", phase: "query", description: "An empty collection filter returns no records with local consistency." },
    { id: "changes.page_shape", phase: "changes", level: "advisory", description: "The authenticated change feed returns an opaque cursor and a bounded page." },
    { id: "changes.cursor_replay", phase: "changes", level: "advisory", description: "Replaying the same change cursor returns a stable continuation page." },
    { id: "changes.corrupt_cursor", phase: "changes", description: "A corrupt change cursor fails with the flat invalid_cursor error." },
    { id: "errors.query_limit", phase: "errors", description: "A query above the advertised maximum fails rather than being silently clamped." },
    { id: "errors.change_limit", phase: "errors", description: "A change page above the advertised maximum fails rather than being silently clamped." },
    { id: "errors.unsupported_consistency", phase: "errors", description: "A non-local query consistency fails explicitly." },
    { id: "errors.json_content_type", phase: "errors", description: "JSON POST routes reject a non-JSON Content-Type with a flat error." },
  ];
  for (const definition of definitions) blockProbe(context, definition, blockedBy);
}

function blockRecordDependents(context: RunnerContext, blockedBy: string): void {
  for (const definition of [
    { id: "records.resolve_and_verify_digest", phase: "records", description: "Exact record read returns the original bytes whose length and SHA-256 match the immutable envelope." },
    { id: "query.owned_fixture_active", phase: "query", description: "The active owned fixture is found through its scratch collection and exact envelope filter." },
    { id: "tombstones.reason_limit_nonmutating", phase: "tombstones", description: "An overlong tombstone reason is rejected and leaves the owned record active." },
    { id: "tombstones.append_owned_fixture", phase: "tombstones", description: "A valid tombstone is appended only to the owned doomed fixture." },
  ] satisfies ProbeDefinition[]) {
    if (!context.checks.some((check) => check.id === definition.id)) blockProbe(context, definition, blockedBy);
  }
  blockTombstoneDependents(context, blockedBy);
}

function blockTombstoneDependents(context: RunnerContext, blockedBy: string): void {
  for (const definition of [
    { id: "tombstones.read_gone", phase: "tombstones", description: "An ordinary exact read of the tombstoned fixture returns record_tombstoned with HTTP 410." },
    { id: "tombstones.query_isolation", phase: "tombstones", description: "Query excludes the tombstoned fixture while the distinct control remains active." },
    { id: "tombstones.change_event", phase: "tombstones", description: "The feed appends exactly one matching tombstone while retaining the original created envelope." },
    { id: "tombstones.idempotent", phase: "tombstones", description: "Repeating the authorised tombstone returns the same tombstone and appends no duplicate event." },
  ] satisfies ProbeDefinition[]) {
    if (!context.checks.some((check) => check.id === definition.id)) blockProbe(context, definition, blockedBy);
  }
}

function validateProfileOptions(profile: DataNodeConformanceProfile, options: DataNodeConformanceOptions): void {
  if (!(["public", "read", "slice1"] as const).includes(profile)) {
    throw new DataNodeConformanceConfigError("invalid_profile", "profile must be public, read, or slice1");
  }
  if (options.token !== undefined) validateToken(options.token);
  if (profile === "public" && options.token !== undefined) {
    throw new DataNodeConformanceConfigError("public_profile_token", "The public profile does not accept a bearer");
  }
  if ((profile === "read" || profile === "slice1") && !options.token) {
    throw new DataNodeConformanceConfigError("credential_missing", `The ${profile} profile requires a dedicated node bearer`);
  }
  if (profile === "slice1") {
    if (!options.collection_id || options.collection_id.length > 512 || hasControlCharacter(options.collection_id)) {
      throw new DataNodeConformanceConfigError("scratch_collection_missing", "The slice1 profile requires a valid scratch collection ID");
    }
    if (!options.expected_node_id || hasControlCharacter(options.expected_node_id)) {
      throw new DataNodeConformanceConfigError("expected_node_missing", "The slice1 profile requires the expected public node_id");
    }
    if (options.acknowledge_persistent_residue !== true) {
      throw new DataNodeConformanceConfigError(
        "persistent_residue_not_acknowledged",
        "The slice1 profile requires explicit acknowledgement of persistent fixture residue",
      );
    }
  } else if (options.collection_id || options.expected_node_id || options.acknowledge_persistent_residue) {
    throw new DataNodeConformanceConfigError("mutation_option_without_slice1", "Scratch fixture options require the slice1 profile");
  }
  if (options.run_id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.run_id)) {
    throw new DataNodeConformanceConfigError("invalid_run_id", "run_id contains unsupported characters");
  }
}

function validateToken(token: string): void {
  if (token.length === 0 || token.length > 16 * 1024 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new DataNodeConformanceConfigError(
      "invalid_credential",
      "The dedicated node bearer must be 1-16384 printable ASCII characters without spaces",
    );
  }
}

function normalizeTarget(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DataNodeConformanceConfigError("invalid_target", "Target must be an absolute HTTP(S) origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DataNodeConformanceConfigError("invalid_target_scheme", "Target must use HTTPS or loopback HTTP");
  }
  if (url.username || url.password) {
    throw new DataNodeConformanceConfigError("target_url_credentials", "Credentials are not permitted in the target URL");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new DataNodeConformanceConfigError("target_not_origin", "Target must be an exact origin without a path, query, or fragment");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new DataNodeConformanceConfigError("insecure_target", "Bearer profiles require HTTPS except on an explicit loopback origin");
  }
  return url.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function positiveBoundedInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new DataNodeConformanceConfigError("invalid_option", `${field} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  requireProbe(typeof value === "string" && value.length > 0 && !hasControlCharacter(value), `${safeReason(field)}_invalid`);
  return value as string;
}

function requiredInteger(value: unknown, field: string): number {
  requireProbe(Number.isSafeInteger(value), `${safeReason(field)}_invalid`);
  return value as number;
}

function validateTimestamp(value: unknown, field: string): void {
  requireProbe(typeof value === "string" && value.length > 0, `${safeReason(field)}_invalid`);
  try {
    normalizeIsoDate(value as string, field);
  } catch {
    throw new ProbeFailure("fail", `${safeReason(field)}_invalid`);
  }
}

function asObject(value: unknown, field: string): JsonMap {
  requireProbe(isObject(value), `${safeReason(field)}_invalid`);
  return value as JsonMap;
}

function isObject(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isNormalizedMediaType(value: string): boolean {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value);
}

function containsManifestDataKey(value: unknown, target: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsManifestDataKey(entry, target));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    if (key === "endpoints" || key === "input_schema" || key === "json_schema") return false;
    return key === target || containsManifestDataKey(child, target);
  });
}

function manifestEquivalenceProjection(value: JsonMap): JsonMap {
  const projection = Object.fromEntries(
    ["protocol", "node_id", "base_url", "endpoints", "capabilities", "collectors", "limits"]
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
  if (Array.isArray(projection.collectors)) {
    projection.collectors = [...projection.collectors]
      .sort((left, right) => {
        const leftId = isObject(left) && typeof left.collector_id === "string" ? left.collector_id : stableJson(left);
        const rightId = isObject(right) && typeof right.collector_id === "string" ? right.collector_id : stableJson(right);
        return leftId.localeCompare(rightId);
      });
  }
  if (isObject(projection.capabilities) && Array.isArray(projection.capabilities.consistency)) {
    projection.capabilities = {
      ...projection.capabilities,
      consistency: [...projection.capabilities.consistency].sort((left, right) => String(left).localeCompare(String(right))),
    };
  }
  return projection;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function countChecks(checks: DataNodeConformanceCheck[]): Record<DataNodeConformanceStatus, number> {
  const counts: Record<DataNodeConformanceStatus, number> = { pass: 0, fail: 0, skip: 0, inconclusive: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round((performance.now() - started) * 1000) / 1000);
}

function safeReason(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
  return normalized || "unknown";
}
