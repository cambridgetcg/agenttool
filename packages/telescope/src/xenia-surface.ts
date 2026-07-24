import { DEFAULT_LIMITS } from "./constants.js";
import {
  isRecord,
  parseJsonBody,
  readBoundedString,
} from "./parsers/common.js";
import {
  fetchDocument,
  ScanBudget,
  type FetchedDocument,
} from "./transport.js";
import { defaultResolveHostname } from "./target.js";
import type {
  DiscoveryAdapter,
  ExtensionObservation,
  FetchLike,
  ResolveHostname,
  TelescopeLimits,
} from "./types.js";

const XENIA_SURFACE_PATH = "/.well-known/agent.json";
const XENIA_SURFACE_PROFILE = "xenia-surface/0.1";
const XENIA_SURFACE_MANIFEST_VERSION = "xenia.surface.manifest/0.1";
const XENIA_SURFACE_MANIFEST_SCHEMA =
  "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/manifest.schema.json";
const XENIA_SURFACE_PROBLEM_SCHEMA =
  "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/problem.schema.json";
const STABLE_ID = /^[a-z][a-z0-9._-]*$/;
const MEDIA_TYPES = new Set(["application/json", "text/html"]);
const CLAIM_EVIDENCE_STATES = new Set(["asserted", "tested", "attested"]);
const CLAIM_OUTCOMES = new Set(["pass", "fail", "unknown"]);

const XENIA_LIMITS: TelescopeLimits = Object.freeze({
  ...DEFAULT_LIMITS,
  max_response_bytes: 65_536,
  max_total_bytes: 65_536,
  max_requests: DEFAULT_LIMITS.max_redirects + 1,
});

export interface XeniaSurfaceManifestSummary {
  schema_version: typeof XENIA_SURFACE_MANIFEST_VERSION;
  profile: typeof XENIA_SURFACE_PROFILE;
  service_canonical_origin: string;
  resource_count: number;
  html_resource_count: number;
  declared_claim_count: number;
  declared_asserted_claim_count: number;
  declared_tested_claim_count: number;
  declared_attested_claim_count: number;
  declared_pass_claim_count: number;
  declared_fail_claim_count: number;
  declared_unknown_claim_count: number;
  not_covered_count: number;
}

export type XeniaSurfaceManifestParseResult =
  | {
      ok: true;
      value: XeniaSurfaceManifestSummary;
    }
  | {
      ok: false;
      code:
        | "invalid_utf8"
        | "invalid_json"
        | "json_complexity_limit"
        | "xenia_surface_manifest_not_object"
        | "xenia_surface_profile_mismatch"
        | "xenia_surface_manifest_shape_unrecognized";
    };

export interface XeniaSurfaceAdapterOptions {
  fetch?: FetchLike;
  resolve_hostname?: ResolveHostname;
}

function parsePublicOrigin(value: unknown): string | null {
  const text = readBoundedString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    url.port = "";
    return url.origin;
  } catch {
    return null;
  }
}

function validResource(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (!STABLE_ID.test(value.id) || value.auth !== "none") return false;
  if (!readBoundedString(value.href, 2_048)) return false;
  if (
    !Array.isArray(value.representations) ||
    value.representations.length < 1 ||
    value.representations.length > 2 ||
    value.representations.some(
      (entry) => typeof entry !== "string" || !MEDIA_TYPES.has(entry),
    ) ||
    new Set(value.representations).size !== value.representations.length ||
    !value.representations.includes("application/json")
  ) {
    return false;
  }
  return (
    typeof value.default_media_type === "string" &&
    MEDIA_TYPES.has(value.default_media_type) &&
    value.representations.includes(value.default_media_type)
  );
}

function validClaim(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    STABLE_ID.test(value.id) &&
    readBoundedString(value.statement, 1_000) !== null &&
    Array.isArray(value.scope) &&
    value.scope.length >= 1 &&
    value.scope.every((entry) => readBoundedString(entry, 300) !== null) &&
    typeof value.evidence_state === "string" &&
    CLAIM_EVIDENCE_STATES.has(value.evidence_state) &&
    typeof value.outcome === "string" &&
    CLAIM_OUTCOMES.has(value.outcome) &&
    Array.isArray(value.evidence)
  );
}

/**
 * Recognizes the release-pinned Surface 0.1 markers and only the bounded fields
 * Telescope reports. This is deliberately not the XENIA Surface conformance
 * checker and does not validate or follow declared evidence.
 */
export function parseXeniaSurfaceManifestEvidence(
  body: Uint8Array,
  limits: TelescopeLimits = XENIA_LIMITS,
): XeniaSurfaceManifestParseResult {
  const parsed = parseJsonBody(body, limits);
  if (!parsed.ok) {
    const code =
      parsed.code === "invalid_utf8" ||
      parsed.code === "invalid_json" ||
      parsed.code === "json_complexity_limit"
        ? parsed.code
        : "xenia_surface_manifest_shape_unrecognized";
    return { ok: false, code };
  }
  if (!isRecord(parsed.value)) {
    return { ok: false, code: "xenia_surface_manifest_not_object" };
  }
  if (
    parsed.value.$schema !== XENIA_SURFACE_MANIFEST_SCHEMA ||
    parsed.value.schema_version !== XENIA_SURFACE_MANIFEST_VERSION ||
    parsed.value.profile !== XENIA_SURFACE_PROFILE ||
    parsed.value.problem_schema !== XENIA_SURFACE_PROBLEM_SCHEMA
  ) {
    return { ok: false, code: "xenia_surface_profile_mismatch" };
  }

  const service = parsed.value.service;
  const resources = parsed.value.resources;
  const claims = parsed.value.claims;
  const notCovered = parsed.value.not_covered;
  const canonicalOrigin =
    isRecord(service) && readBoundedString(service.name, 120)
      ? parsePublicOrigin(service.canonical_url)
      : null;
  if (
    !canonicalOrigin ||
    !Array.isArray(resources) ||
    resources.length < 1 ||
    resources.length > 8 ||
    !resources.every(validResource) ||
    new Set(resources.map((resource) => resource.id)).size !== resources.length ||
    !Array.isArray(claims) ||
    !claims.every(validClaim) ||
    new Set(claims.map((claim) => claim.id)).size !== claims.length ||
    !Array.isArray(notCovered) ||
    notCovered.length < 1 ||
    !notCovered.every((entry) => readBoundedString(entry, 300) !== null) ||
    new Set(notCovered).size !== notCovered.length
  ) {
    return {
      ok: false,
      code: "xenia_surface_manifest_shape_unrecognized",
    };
  }

  const countClaims = (field: "evidence_state" | "outcome", value: string) =>
    claims.filter((entry) => entry[field] === value).length;
  return {
    ok: true,
    value: Object.freeze({
      schema_version: XENIA_SURFACE_MANIFEST_VERSION,
      profile: XENIA_SURFACE_PROFILE,
      service_canonical_origin: canonicalOrigin,
      resource_count: resources.length,
      html_resource_count: resources.filter((resource) =>
        (resource.representations as unknown[]).includes("text/html"),
      ).length,
      declared_claim_count: claims.length,
      declared_asserted_claim_count: countClaims("evidence_state", "asserted"),
      declared_tested_claim_count: countClaims("evidence_state", "tested"),
      declared_attested_claim_count: countClaims("evidence_state", "attested"),
      declared_pass_claim_count: countClaims("outcome", "pass"),
      declared_fail_claim_count: countClaims("outcome", "fail"),
      declared_unknown_claim_count: countClaims("outcome", "unknown"),
      not_covered_count: notCovered.length,
    }),
  };
}

function transportFacts(
  document: FetchedDocument<"xenia_surface_manifest">,
  options: XeniaSurfaceAdapterOptions,
): ExtensionObservation["facts"] {
  const source = document.observation;
  return {
    observation_kind: "manifest_discovery_only",
    canonical_path: XENIA_SURFACE_PATH,
    http_transport: options.fetch ? "injected" : "native_fetch",
    dns_resolver: options.resolve_hostname ? "injected" : "system_lookup",
    methods: "GET",
    credentials: "omitted",
    redirects: "manual_revalidated",
    dns_preflight: true,
    connected_address_pinning: false,
    transport_state: source.state,
    status_code: source.status_code,
    media_type: source.media_type,
    bytes: source.bytes,
    sha256: source.sha256,
    redirects_followed: source.redirect_chain.length,
    error_code: source.error_code,
    resource_probes_made: 0,
    problem_probes_made: 0,
    declared_evidence_fetched: false,
    declared_evidence_verified: false,
    declared_claims_verified: false,
    manifest_schema_validated: false,
    surface_conformance: "not_tested",
    covenant_adoption: "not_assessed",
    authority: "none",
    remote_content_acted_on: false,
  };
}

function isJsonMediaType(value: string | null): boolean {
  return value === "application/json" || Boolean(value?.endsWith("+json"));
}

/**
 * Creates one opt-in Telescope discovery adapter for the canonical XENIA
 * Surface 0.1 manifest path. It makes no declared resource, problem-route,
 * evidence, Covenant, authorization, or action request.
 */
export function createXeniaSurfaceAdapter(
  options: XeniaSurfaceAdapterOptions = {},
): DiscoveryAdapter {
  return {
    id: "xenia_surface",
    async discover(context): Promise<ExtensionObservation> {
      const document = await fetchDocument({
        id: "xenia_surface_manifest",
        url: new URL(XENIA_SURFACE_PATH, `${context.subject.origin}/`).href,
        accept: "application/json",
        fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
        resolve_hostname: options.resolve_hostname ?? defaultResolveHostname,
        budget: new ScanBudget(XENIA_LIMITS),
        limits: XENIA_LIMITS,
        signal: context.signal,
      });
      const facts = transportFacts(document, options);
      const source = document.observation;

      if (source.state === "not_found") {
        return {
          id: "xenia_surface",
          state: "absent",
          summary:
            "No XENIA Surface manifest was observed at the canonical path; this says nothing about whole-XENIA practice.",
          facts,
        };
      }
      if (source.state !== "present" || !document.body) {
        return {
          id: "xenia_surface",
          state: "error",
          summary:
            "Telescope could not observe the canonical XENIA Surface path within its read-only network boundary; no conformance result was produced.",
          facts,
        };
      }
      if (!isJsonMediaType(source.media_type)) {
        return {
          id: "xenia_surface",
          state: "invalid",
          summary:
            "The canonical XENIA Surface path returned an unsupported media type; no conformance result was produced.",
          facts: { ...facts, parse_code: "unexpected_media_type" },
        };
      }

      const parsed = parseXeniaSurfaceManifestEvidence(document.body);
      if (!parsed.ok) {
        return {
          id: "xenia_surface",
          state: "invalid",
          summary:
            "The canonical XENIA Surface path did not match Telescope's bounded Surface 0.1 manifest summary; no conformance result was produced.",
          facts: { ...facts, parse_code: parsed.code },
        };
      }
      return {
        id: "xenia_surface",
        state: "present",
        summary:
          "XENIA Surface 0.1 manifest markers were recognized at the canonical path; this is manifest discovery only, not a Surface conformance result or Covenant adoption.",
        facts: {
          ...facts,
          manifest_shape: "recognized_profile_summary",
          profile_markers: "release_pinned",
          schema_version: parsed.value.schema_version,
          profile: parsed.value.profile,
          service_canonical_origin_matches_target:
            parsed.value.service_canonical_origin === context.subject.origin,
          resource_count: parsed.value.resource_count,
          html_resource_count: parsed.value.html_resource_count,
          declared_claim_count: parsed.value.declared_claim_count,
          declared_asserted_claim_count:
            parsed.value.declared_asserted_claim_count,
          declared_tested_claim_count:
            parsed.value.declared_tested_claim_count,
          declared_attested_claim_count:
            parsed.value.declared_attested_claim_count,
          declared_pass_claim_count: parsed.value.declared_pass_claim_count,
          declared_fail_claim_count: parsed.value.declared_fail_claim_count,
          declared_unknown_claim_count:
            parsed.value.declared_unknown_claim_count,
          not_covered_count: parsed.value.not_covered_count,
        },
      };
    },
  };
}
