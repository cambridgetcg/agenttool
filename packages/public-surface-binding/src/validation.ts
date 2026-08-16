import {
  canonicalRecordSha256,
  deepFreeze,
  domainSeparatedId,
  encodeCanonicalRecord,
  snapshotJsonData,
  type JsonValue,
} from "./canonical.js";
import {
  ASSESSMENT_NON_CLAIMS,
  BINDING_BOUNDARIES,
  BINDING_PURPOSES,
  LIMITS,
  OBSERVATION_BOUNDARIES,
  PUBLICATION_PATH,
  RECORD_SCHEMAS,
  REVOCATION_REASONS,
  SIGNING_DOMAINS,
} from "./constants.js";
import { decodeFixedBase64, decodeFixedBase64Url } from "./bytes.js";
import { invalid } from "./errors.js";
import type {
  BindingSubject,
  Ed25519Authority,
  IdentityKeyEvidence,
  PublicSurfaceAssessment,
  PublicSurfaceAssessmentCore,
  PublicSurfaceBinding,
  PublicSurfaceBindingCore,
  PublicSurfaceObservation,
  PublicSurfaceObservationCore,
  PublicSurfaceRevocation,
  PublicSurfaceRevocationCore,
  RecordSignature,
  Sha256Id,
} from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const INSTANT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const MEDIA_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const HOST_LABEL_RE = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const CANONICAL_PATH_RE = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@\/-]|%[0-9A-F]{2})*$/u;
const UNRESERVED_PATH_BYTE_RE = /^[A-Za-z0-9._~-]$/u;
const RESERVED_FINAL_LABELS = new Set([
  "arpa",
  "example",
  "home",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);
const RESERVED_EXAMPLE_ZONES = ["example.com", "example.net", "example.org"] as const;

type JsonObject = Record<string, JsonValue>;

function validated<T>(record: JsonObject): Readonly<T> {
  encodeCanonicalRecord(record);
  return deepFreeze(record) as unknown as Readonly<T>;
}

function object(value: JsonValue, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return value;
}

function array(value: JsonValue, path: string): JsonValue[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array.`, path);
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
}

function string(value: JsonValue, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    invalid(`${path} must be ${allowEmpty ? "a" : "a non-empty"} string.`, path);
  }
  return value;
}

function literal<T extends string | boolean | null>(value: JsonValue, expected: T, path: string): T {
  if (value !== expected) invalid(`${path} must be ${JSON.stringify(expected)}.`, path);
  return expected;
}

function oneOf<T extends string>(value: JsonValue, values: readonly T[], path: string): T {
  const candidate = string(value, path);
  if (!values.includes(candidate as T)) invalid(`${path} has an unsupported value.`, path);
  return candidate as T;
}

function integer(value: JsonValue, minimum: number, maximum: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(`${path} must be an integer from ${minimum} through ${maximum}.`, path);
  }
  return value;
}

function nullable<T>(value: JsonValue, validate: (value: JsonValue) => T): T | null {
  return value === null ? null : validate(value);
}

export function assertSha256Id(value: JsonValue, path: string): Sha256Id {
  const candidate = string(value, path);
  if (!SHA256_RE.test(candidate)) invalid(`${path} must be a canonical lowercase SHA-256 ID.`, path);
  return candidate as Sha256Id;
}

export function assertCanonicalUuid(value: JsonValue, path: string): string {
  const candidate = string(value, path);
  if (!UUID_RE.test(candidate)) invalid(`${path} must be a canonical lowercase UUID.`, path);
  return candidate;
}

export function assertCanonicalInstant(value: JsonValue, path: string): string {
  const candidate = string(value, path);
  if (!INSTANT_RE.test(candidate)) invalid(`${path} must be an exact millisecond UTC instant.`, path);
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== candidate) {
    invalid(`${path} must name a real calendar instant.`, path);
  }
  return candidate;
}

function instantMs(value: string): number {
  return new Date(value).getTime();
}

function assertPublicHostname(hostname: string, path: string): void {
  if (
    hostname.length > 253
    || hostname.endsWith(".")
    || hostname.includes(":")
    || /^[0-9.]+$/u.test(hostname)
    || RESERVED_EXAMPLE_ZONES.some((zone) => hostname === zone || hostname.endsWith(`.${zone}`))
  ) invalid(`${path} must use a public DNS hostname, not an IP literal.`, path);
  const labels = hostname.split(".");
  if (
    labels.length < 2
    || labels.some((label) => !HOST_LABEL_RE.test(label))
    || RESERVED_FINAL_LABELS.has(labels.at(-1)!)
  ) invalid(`${path} must use a canonical public DNS hostname.`, path);
}

function assertCanonicalPathname(pathname: string, path: string): void {
  if (!CANONICAL_PATH_RE.test(pathname)) {
    invalid(`${path} must use only RFC 3986 path characters and uppercase percent triplets.`, path);
  }
  for (let index = pathname.indexOf("%"); index !== -1; index = pathname.indexOf("%", index + 3)) {
    const decoded = String.fromCharCode(Number.parseInt(pathname.slice(index + 1, index + 3), 16));
    if (UNRESERVED_PATH_BYTE_RE.test(decoded)) {
      invalid(`${path} must not percent-encode an unreserved path character.`, path);
    }
  }
}

export function assertCanonicalHttpsOrigin(value: JsonValue, path: string): string {
  const candidate = string(value, path);
  if (candidate.length > 2_048) invalid(`${path} is too long.`, path);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalid(`${path} must be a canonical HTTPS origin.`, path);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || candidate !== parsed.origin
  ) invalid(`${path} must be an exact standard-port HTTPS origin.`, path);
  assertPublicHostname(parsed.hostname, path);
  return candidate;
}

export function assertCanonicalHttpsUrl(value: JsonValue, path: string, expectedOrigin?: string): string {
  const candidate = string(value, path);
  if (candidate.length > 2_048) invalid(`${path} is too long.`, path);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalid(`${path} must be a canonical HTTPS URL.`, path);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || candidate.includes("?")
    || candidate.includes("#")
    || parsed.search !== ""
    || parsed.hash !== ""
    || candidate !== parsed.href
  ) invalid(`${path} must be one exact credential-free standard-port HTTPS URL.`, path);
  assertPublicHostname(parsed.hostname, path);
  assertCanonicalPathname(parsed.pathname, path);
  if (expectedOrigin !== undefined && parsed.origin !== expectedOrigin) {
    invalid(`${path} must remain on ${expectedOrigin}.`, path);
  }
  return candidate;
}

function assertText(value: JsonValue, path: string): string {
  return string(value, path);
}

function validateAuthority(value: JsonValue, path: string): Ed25519Authority {
  const record = object(value, path);
  exactKeys(record, ["algorithm", "key_id", "public_key"], path);
  literal(record.algorithm!, "Ed25519", `${path}.algorithm`);
  assertCanonicalUuid(record.key_id!, `${path}.key_id`);
  const publicKey = string(record.public_key!, `${path}.public_key`);
  decodeFixedBase64(publicKey, 32, `${path}.public_key`);
  return record as unknown as Ed25519Authority;
}

function validateSignature(value: JsonValue, path: string): RecordSignature {
  const record = object(value, path);
  exactKeys(record, ["algorithm", "value"], path);
  literal(record.algorithm!, "Ed25519", `${path}.algorithm`);
  decodeFixedBase64(string(record.value!, `${path}.value`), 64, `${path}.value`);
  return record as unknown as RecordSignature;
}

function validateSubject(value: JsonValue, path: string): BindingSubject {
  const record = object(value, path);
  exactKeys(record, ["identity_namespace", "identity_id", "signing_key"], path);
  literal(record.identity_namespace!, "agenttool-local", `${path}.identity_namespace`);
  assertCanonicalUuid(record.identity_id!, `${path}.identity_id`);
  validateAuthority(record.signing_key!, `${path}.signing_key`);
  return record as unknown as BindingSubject;
}

function assertExactObject(value: JsonValue, expected: Record<string, unknown>, path: string): void {
  const record = object(value, path);
  exactKeys(record, Object.keys(expected), path);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (record[key] !== expectedValue) invalid(`${path}.${key} must be ${JSON.stringify(expectedValue)}.`, `${path}.${key}`);
  }
}

function sortedUniqueStrings(values: JsonValue, path: string, maximum: number): string[] {
  const list = array(values, path);
  if (list.length > maximum) invalid(`${path} has too many entries.`, path);
  const output = list.map((value, index) => string(value, `${path}[${index}]`));
  const sorted = [...new Set(output)].sort();
  if (sorted.length !== output.length || output.some((value, index) => value !== sorted[index])) {
    invalid(`${path} must be unique and sorted.`, path);
  }
  return output;
}

function sortedUniqueSha256(
  values: JsonValue,
  path: string,
  maximum = LIMITS.max_assessment_evidence_items,
): Sha256Id[] {
  const list = array(values, path);
  if (list.length > maximum) invalid(`${path} has too many entries.`, path);
  const output = list.map((value, index) => assertSha256Id(value, `${path}[${index}]`));
  const sorted = [...new Set(output)].sort();
  if (sorted.length !== output.length || output.some((value, index) => value !== sorted[index])) {
    invalid(`${path} must be unique and sorted.`, path);
  }
  return output;
}

function observationCoreFrom(record: JsonObject): PublicSurfaceObservationCore {
  const { evidence_id: _evidenceId, ...core } = record;
  return core as unknown as PublicSurfaceObservationCore;
}

export function validatePublicSurfaceObservationCore(value: unknown): Readonly<PublicSurfaceObservationCore> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$observation");
  exactKeys(record, [
    "schema", "origin", "request_url", "request", "status_code", "final_url",
    "redirect_chain", "media_type", "bytes", "body_sha256", "collector", "robots",
    "usage_preferences", "request_authentication", "boundaries",
  ], "$observation");
  literal(record.schema!, RECORD_SCHEMAS.observation, "$observation.schema");
  const origin = assertCanonicalHttpsOrigin(record.origin!, "$observation.origin");
  const requestUrl = assertCanonicalHttpsUrl(record.request_url!, "$observation.request_url", origin);

  const request = object(record.request!, "$observation.request");
  exactKeys(request, ["method", "credential_mode", "started_at", "ended_at", "crawler_version"], "$observation.request");
  const method = oneOf(request.method!, ["GET", "HEAD"] as const, "$observation.request.method");
  literal(request.credential_mode!, "omit", "$observation.request.credential_mode");
  const startedAt = assertCanonicalInstant(request.started_at!, "$observation.request.started_at");
  const endedAt = assertCanonicalInstant(request.ended_at!, "$observation.request.ended_at");
  if (instantMs(endedAt) < instantMs(startedAt)) invalid("Observation end precedes start.", "$observation.request.ended_at");
  assertText(request.crawler_version!, "$observation.request.crawler_version");

  const status = record.status_code === null
    ? null
    : integer(record.status_code!, 100, 599, "$observation.status_code");
  const redirects = array(record.redirect_chain!, "$observation.redirect_chain");
  if (redirects.length > LIMITS.max_redirects) invalid("Too many redirect observations.", "$observation.redirect_chain");
  for (const [index, redirectValue] of redirects.entries()) {
    const redirect = object(redirectValue, `$observation.redirect_chain[${index}]`);
    exactKeys(redirect, ["status_code", "location"], `$observation.redirect_chain[${index}]`);
    const code = integer(redirect.status_code!, 300, 399, `$observation.redirect_chain[${index}].status_code`);
    if (![301, 302, 303, 307, 308].includes(code)) invalid("Unsupported redirect status.", `$observation.redirect_chain[${index}].status_code`);
    assertCanonicalHttpsUrl(redirect.location!, `$observation.redirect_chain[${index}].location`);
  }

  const finalUrl = nullable(record.final_url!, (entry) => assertCanonicalHttpsUrl(entry, "$observation.final_url"));
  const mediaType = nullable(record.media_type!, (entry) => {
    const candidate = string(entry, "$observation.media_type");
    if (!MEDIA_TYPE_RE.test(candidate) || candidate.length > 256) invalid("Invalid media type.", "$observation.media_type");
    return candidate;
  });
  const byteCount = record.bytes === null ? null : integer(record.bytes!, 0, LIMITS.max_observed_body_bytes, "$observation.bytes");
  const bodySha = nullable(record.body_sha256!, (entry) => assertSha256Id(entry, "$observation.body_sha256"));
  if (status === null) {
    if (finalUrl !== null || mediaType !== null || byteCount !== null || bodySha !== null || redirects.length !== 0) {
      invalid("A no-response observation must not invent response metadata.", "$observation.status_code");
    }
  } else {
    if (finalUrl === null) invalid("A response observation requires final_url.", "$observation.final_url");
    if (method === "GET" && (byteCount === null || bodySha === null)) {
      invalid("A GET response requires an exact byte count and body digest.", "$observation.body_sha256");
    }
    if (method === "HEAD" && (byteCount !== 0 || bodySha !== null)) {
      invalid("A HEAD response carries zero observed body bytes and no body digest.", "$observation.body_sha256");
    }
    const expectedFinalUrl = redirects.length === 0
      ? requestUrl
      : string(object(redirects.at(-1)!, "$observation.redirect_chain[last]").location!, "$observation.redirect_chain[last].location");
    if (finalUrl !== expectedFinalUrl) {
      invalid("final_url must equal request_url without redirects or the last observed redirect location.", "$observation.final_url");
    }
  }

  const collector = object(record.collector!, "$observation.collector");
  exactKeys(collector, ["name", "version", "report_schema", "report_sha256", "source_id"], "$observation.collector");
  for (const key of ["name", "version", "report_schema", "source_id"] as const) assertText(collector[key]!, `$observation.collector.${key}`);
  assertSha256Id(collector.report_sha256!, "$observation.collector.report_sha256");

  const robots = object(record.robots!, "$observation.robots");
  exactKeys(robots, ["source", "robots_url", "snapshot_sha256", "matched_group", "directive", "is_access_authorization"], "$observation.robots");
  const robotsSource = oneOf(robots.source!, ["rfc9309_snapshot", "not_collected"] as const, "$observation.robots.source");
  const robotsUrl = nullable(robots.robots_url!, (entry) => assertCanonicalHttpsUrl(entry, "$observation.robots.robots_url", origin));
  const robotsSha = nullable(robots.snapshot_sha256!, (entry) => assertSha256Id(entry, "$observation.robots.snapshot_sha256"));
  const matchedGroup = nullable(robots.matched_group!, (entry) => assertText(entry, "$observation.robots.matched_group"));
  const directive = oneOf(robots.directive!, ["allow", "disallow", "no_match", "unavailable", "not_observed"] as const, "$observation.robots.directive");
  literal(robots.is_access_authorization!, false, "$observation.robots.is_access_authorization");
  if (robotsSource === "not_collected") {
    if (robotsUrl !== null || robotsSha !== null || matchedGroup !== null || directive !== "not_observed") {
      invalid("An uncollected robots snapshot must remain empty.", "$observation.robots");
    }
  } else {
    if (robotsUrl !== `${origin}/robots.txt` || directive === "not_observed") {
      invalid("A robots snapshot must bind the exact origin robots path and a result.", "$observation.robots");
    }
    if (directive === "unavailable" ? robotsSha !== null : robotsSha === null) {
      invalid("robots snapshot digest does not match its availability.", "$observation.robots.snapshot_sha256");
    }
  }

  const preferences = array(record.usage_preferences!, "$observation.usage_preferences");
  if (preferences.length > LIMITS.max_usage_preferences) invalid("Too many usage preferences.", "$observation.usage_preferences");
  const preferenceKeys: string[] = [];
  for (const [index, preferenceValue] of preferences.entries()) {
    const preference = object(preferenceValue, `$observation.usage_preferences[${index}]`);
    exactKeys(preference, ["namespace", "category", "value", "is_permission"], `$observation.usage_preferences[${index}]`);
    const namespace = assertText(preference.namespace!, `$observation.usage_preferences[${index}].namespace`);
    const category = assertText(preference.category!, `$observation.usage_preferences[${index}].category`);
    oneOf(preference.value!, ["allowed", "disallowed", "unknown"] as const, `$observation.usage_preferences[${index}].value`);
    literal(preference.is_permission!, false, `$observation.usage_preferences[${index}].is_permission`);
    preferenceKeys.push(`${namespace}\0${category}`);
  }
  if (preferenceKeys.some((key, index) => key !== [...new Set(preferenceKeys)].sort()[index])) {
    invalid("Usage preferences must be unique and sorted by namespace and category.", "$observation.usage_preferences");
  }

  const authentication = object(record.request_authentication!, "$observation.request_authentication");
  exactKeys(authentication, ["kind", "status", "verifier", "protocol_variant", "claimed_identity_url", "key_thumbprint", "covered_components", "nonce_checked"], "$observation.request_authentication");
  const authKind = oneOf(authentication.kind!, ["none", "web_bot_auth", "provider_attestation"] as const, "$observation.request_authentication.kind");
  const authStatus = oneOf(authentication.status!, ["verified", "invalid", "unverified"] as const, "$observation.request_authentication.status");
  const verifier = assertText(authentication.verifier!, "$observation.request_authentication.verifier");
  const protocolVariant = nullable(authentication.protocol_variant!, (entry) => assertText(entry, "$observation.request_authentication.protocol_variant"));
  const claimedIdentityUrl = nullable(authentication.claimed_identity_url!, (entry) => assertCanonicalHttpsUrl(entry, "$observation.request_authentication.claimed_identity_url"));
  const keyThumbprint = nullable(authentication.key_thumbprint!, (entry) => assertSha256Id(entry, "$observation.request_authentication.key_thumbprint"));
  const components = sortedUniqueStrings(authentication.covered_components!, "$observation.request_authentication.covered_components", LIMITS.max_covered_components);
  if (typeof authentication.nonce_checked !== "boolean") invalid("nonce_checked must be boolean.", "$observation.request_authentication.nonce_checked");
  if (authKind === "none") {
    if (authStatus !== "unverified" || verifier !== "none" || protocolVariant !== null || claimedIdentityUrl !== null || keyThumbprint !== null || components.length !== 0 || authentication.nonce_checked !== false) {
      invalid("No request authentication must remain explicitly unverified and empty.", "$observation.request_authentication");
    }
  } else if (verifier === "none") {
    invalid("An authentication observation must name its non-none verifier.", "$observation.request_authentication.verifier");
  } else if (authStatus === "verified" && (protocolVariant === null || keyThumbprint === null || components.length === 0)) {
    invalid("Verified request authentication requires protocol, key, and covered components.", "$observation.request_authentication");
  }
  if (authKind === "web_bot_auth" && authStatus === "verified" && claimedIdentityUrl === null) {
    invalid("Verified web-bot authentication requires its claimed identity URL.", "$observation.request_authentication.claimed_identity_url");
  }

  assertExactObject(record.boundaries!, OBSERVATION_BOUNDARIES, "$observation.boundaries");
  return validated<PublicSurfaceObservationCore>(record);
}

export function validatePublicSurfaceObservation(value: unknown): Readonly<PublicSurfaceObservation> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$observation");
  exactKeys(record, [
    "schema", "origin", "request_url", "request", "status_code", "final_url",
    "redirect_chain", "media_type", "bytes", "body_sha256", "collector", "robots",
    "usage_preferences", "request_authentication", "boundaries", "evidence_id",
  ], "$observation");
  const core = observationCoreFrom(record);
  validatePublicSurfaceObservationCore(core);
  const evidenceId = assertSha256Id(record.evidence_id!, "$observation.evidence_id");
  if (evidenceId !== domainSeparatedId(SIGNING_DOMAINS.observation_id, core)) {
    invalid("evidence_id does not match the observation core.", "$observation.evidence_id");
  }
  return validated<PublicSurfaceObservation>(record);
}

function bindingCoreFrom(record: JsonObject): PublicSurfaceBindingCore {
  const { signature: _signature, binding_id: _bindingId, ...core } = record;
  return core as unknown as PublicSurfaceBindingCore;
}

export function validatePublicSurfaceBindingCore(value: unknown): Readonly<PublicSurfaceBindingCore> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$binding");
  exactKeys(record, ["schema", "subject", "origin", "observation_id", "observed_body_sha256", "relation", "scope", "purpose", "publication_path", "issued_at", "not_before", "expires_at", "nonce", "boundaries"], "$binding");
  literal(record.schema!, RECORD_SCHEMAS.binding, "$binding.schema");
  validateSubject(record.subject!, "$binding.subject");
  assertCanonicalHttpsOrigin(record.origin!, "$binding.origin");
  assertSha256Id(record.observation_id!, "$binding.observation_id");
  assertSha256Id(record.observed_body_sha256!, "$binding.observed_body_sha256");
  literal(record.relation!, "declares_association_with_surface", "$binding.relation");
  literal(record.scope!, "exact_origin", "$binding.scope");
  oneOf(record.purpose!, BINDING_PURPOSES, "$binding.purpose");
  literal(record.publication_path!, PUBLICATION_PATH, "$binding.publication_path");
  const issuedAt = assertCanonicalInstant(record.issued_at!, "$binding.issued_at");
  const notBefore = assertCanonicalInstant(record.not_before!, "$binding.not_before");
  const expiresAt = assertCanonicalInstant(record.expires_at!, "$binding.expires_at");
  if (instantMs(issuedAt) > instantMs(notBefore) || instantMs(notBefore) >= instantMs(expiresAt)) {
    invalid("Binding requires issued_at <= not_before < expires_at.", "$binding.expires_at");
  }
  if (instantMs(expiresAt) - instantMs(issuedAt) > LIMITS.max_binding_lifetime_ms) {
    invalid("Binding lifetime exceeds the finite 30-day limit.", "$binding.expires_at");
  }
  decodeFixedBase64Url(string(record.nonce!, "$binding.nonce"), LIMITS.nonce_bytes, "$binding.nonce");
  assertExactObject(record.boundaries!, BINDING_BOUNDARIES, "$binding.boundaries");
  return validated<PublicSurfaceBindingCore>(record);
}

export function validatePublicSurfaceBindingShape(value: unknown): Readonly<PublicSurfaceBinding> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$binding");
  exactKeys(record, ["schema", "subject", "origin", "observation_id", "observed_body_sha256", "relation", "scope", "purpose", "publication_path", "issued_at", "not_before", "expires_at", "nonce", "boundaries", "signature", "binding_id"], "$binding");
  validatePublicSurfaceBindingCore(bindingCoreFrom(record));
  validateSignature(record.signature!, "$binding.signature");
  assertSha256Id(record.binding_id!, "$binding.binding_id");
  return validated<PublicSurfaceBinding>(record);
}

export function validatePublicSurfaceBinding(value: unknown): Readonly<PublicSurfaceBinding> {
  const record = validatePublicSurfaceBindingShape(value);
  const core = bindingCoreFrom(record as unknown as JsonObject);
  const expected = domainSeparatedId(SIGNING_DOMAINS.binding_id, { ...core, signature: record.signature });
  if (record.binding_id !== expected) invalid("binding_id does not match the signed wire record.", "$binding.binding_id");
  return record;
}

function revocationCoreFrom(record: JsonObject): PublicSurfaceRevocationCore {
  const { signature: _signature, revocation_id: _revocationId, ...core } = record;
  return core as unknown as PublicSurfaceRevocationCore;
}

export function validatePublicSurfaceRevocationCore(value: unknown): Readonly<PublicSurfaceRevocationCore> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$revocation");
  exactKeys(record, ["schema", "binding_id", "subject", "revoked_at", "reason", "superseded_by", "nonce"], "$revocation");
  literal(record.schema!, RECORD_SCHEMAS.revocation, "$revocation.schema");
  const bindingId = assertSha256Id(record.binding_id!, "$revocation.binding_id");
  validateSubject(record.subject!, "$revocation.subject");
  assertCanonicalInstant(record.revoked_at!, "$revocation.revoked_at");
  const reason = oneOf(record.reason!, REVOCATION_REASONS, "$revocation.reason");
  const supersededBy = nullable(record.superseded_by!, (entry) => assertSha256Id(entry, "$revocation.superseded_by"));
  if ((reason === "superseded") !== (supersededBy !== null)) {
    invalid("Only a superseded revocation carries superseded_by.", "$revocation.superseded_by");
  }
  if (supersededBy === bindingId) invalid("A binding cannot supersede itself.", "$revocation.superseded_by");
  decodeFixedBase64Url(string(record.nonce!, "$revocation.nonce"), LIMITS.nonce_bytes, "$revocation.nonce");
  return validated<PublicSurfaceRevocationCore>(record);
}

export function validatePublicSurfaceRevocationShape(value: unknown): Readonly<PublicSurfaceRevocation> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$revocation");
  exactKeys(record, ["schema", "binding_id", "subject", "revoked_at", "reason", "superseded_by", "nonce", "signature", "revocation_id"], "$revocation");
  validatePublicSurfaceRevocationCore(revocationCoreFrom(record));
  validateSignature(record.signature!, "$revocation.signature");
  assertSha256Id(record.revocation_id!, "$revocation.revocation_id");
  return validated<PublicSurfaceRevocation>(record);
}

export function validatePublicSurfaceRevocation(value: unknown): Readonly<PublicSurfaceRevocation> {
  const record = validatePublicSurfaceRevocationShape(value);
  const core = revocationCoreFrom(record as unknown as JsonObject);
  const expected = domainSeparatedId(SIGNING_DOMAINS.revocation_id, { ...core, signature: record.signature });
  if (record.revocation_id !== expected) invalid("revocation_id does not match the signed wire record.", "$revocation.revocation_id");
  return record;
}

export function validateIdentityKeyEvidence(value: unknown): Readonly<IdentityKeyEvidence> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$key_evidence");
  exactKeys(record, ["identity_namespace", "identity_id", "signing_key", "relationship", "lifecycle", "valid_from", "valid_until", "source_ref", "basis"], "$key_evidence");
  literal(record.identity_namespace!, "agenttool-local", "$key_evidence.identity_namespace");
  assertCanonicalUuid(record.identity_id!, "$key_evidence.identity_id");
  validateAuthority(record.signing_key!, "$key_evidence.signing_key");
  literal(record.relationship!, "assertion", "$key_evidence.relationship");
  const lifecycle = oneOf(record.lifecycle!, ["active", "revoked", "unknown"] as const, "$key_evidence.lifecycle");
  const validFrom = assertCanonicalInstant(record.valid_from!, "$key_evidence.valid_from");
  const validUntil = nullable(record.valid_until!, (entry) => assertCanonicalInstant(entry, "$key_evidence.valid_until"));
  if (validUntil !== null && instantMs(validFrom) >= instantMs(validUntil)) invalid("Key evidence validity interval is empty.", "$key_evidence.valid_until");
  if (lifecycle === "active" && validUntil !== null) {
    invalid("Active key evidence must not declare a revocation instant.", "$key_evidence.valid_until");
  }
  if (lifecycle === "revoked" && validUntil === null) {
    invalid("Revoked key evidence requires its finite revocation instant.", "$key_evidence.valid_until");
  }
  assertSha256Id(record.source_ref!, "$key_evidence.source_ref");
  literal(record.basis!, "caller_supplied_key_evidence", "$key_evidence.basis");
  return validated<IdentityKeyEvidence>(record);
}

function assessmentCoreFrom(record: JsonObject): PublicSurfaceAssessmentCore {
  const { assessment_id: _assessmentId, ...core } = record;
  return core as unknown as PublicSurfaceAssessmentCore;
}

export function validatePublicSurfaceAssessmentCore(value: unknown): Readonly<PublicSurfaceAssessmentCore> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$assessment");
  exactKeys(record, ["schema", "binding_id", "evaluated_at", "inputs", "integrity", "signature", "key_authorization", "evidence_match", "origin_confirmation", "freshness", "revocation", "establishes", "does_not_establish", "authority", "score", "wake_effect", "memory_effect", "karma_effect", "training_effect"], "$assessment");
  literal(record.schema!, RECORD_SCHEMAS.assessment, "$assessment.schema");
  assertSha256Id(record.binding_id!, "$assessment.binding_id");
  assertCanonicalInstant(record.evaluated_at!, "$assessment.evaluated_at");

  const inputs = object(record.inputs!, "$assessment.inputs");
  exactKeys(inputs, [
    "binding_document_sha256",
    "key_evidence_ref",
    "key_evidence_sha256",
    "observation_id",
    "origin_observation_id",
    "revocation_ids",
    "revocation_document_sha256s",
    "revocation_key_evidence_refs",
    "revocation_key_evidence_sha256s",
  ], "$assessment.inputs");
  assertSha256Id(inputs.binding_document_sha256!, "$assessment.inputs.binding_document_sha256");
  const keyRef = nullable(inputs.key_evidence_ref!, (entry) => assertSha256Id(entry, "$assessment.inputs.key_evidence_ref"));
  const keyDocumentSha = nullable(inputs.key_evidence_sha256!, (entry) => assertSha256Id(entry, "$assessment.inputs.key_evidence_sha256"));
  const observationId = nullable(inputs.observation_id!, (entry) => assertSha256Id(entry, "$assessment.inputs.observation_id"));
  const originObservationId = nullable(inputs.origin_observation_id!, (entry) => assertSha256Id(entry, "$assessment.inputs.origin_observation_id"));
  const revocationIds = inputs.revocation_ids === null ? null : sortedUniqueSha256(inputs.revocation_ids!, "$assessment.inputs.revocation_ids");
  const revocationDocumentShas = inputs.revocation_document_sha256s === null ? null : sortedUniqueSha256(inputs.revocation_document_sha256s!, "$assessment.inputs.revocation_document_sha256s");
  const revocationKeyRefs = inputs.revocation_key_evidence_refs === null ? null : sortedUniqueSha256(inputs.revocation_key_evidence_refs!, "$assessment.inputs.revocation_key_evidence_refs");
  const revocationKeyDocumentShas = inputs.revocation_key_evidence_sha256s === null ? null : sortedUniqueSha256(inputs.revocation_key_evidence_sha256s!, "$assessment.inputs.revocation_key_evidence_sha256s");

  oneOf(record.integrity!, ["valid", "invalid"] as const, "$assessment.integrity");
  const signature = oneOf(record.signature!, ["valid", "invalid"] as const, "$assessment.signature");
  const keyAuthorization = oneOf(record.key_authorization!, ["caller_evidence_matches", "caller_evidence_mismatch", "not_supplied", "indeterminate"] as const, "$assessment.key_authorization");
  const evidenceMatch = oneOf(record.evidence_match!, ["matches", "mismatch", "not_supplied"] as const, "$assessment.evidence_match");
  const originConfirmation = oneOf(record.origin_confirmation!, ["observed_at_time", "body_mismatch", "origin_mismatch", "not_supplied", "indeterminate"] as const, "$assessment.origin_confirmation");
  oneOf(record.freshness!, ["current", "not_yet_valid", "expired"] as const, "$assessment.freshness");
  const revocation = oneOf(record.revocation!, ["not_observed", "revoked", "indeterminate"] as const, "$assessment.revocation");
  if ((keyRef === null) !== (keyDocumentSha === null)) invalid("Key evidence reference and document digest must be supplied together.", "$assessment.inputs.key_evidence_sha256");
  if ((keyRef === null) !== (keyAuthorization === "not_supplied")) invalid("key_authorization and key evidence reference disagree.", "$assessment.key_authorization");
  if ((observationId === null) !== (evidenceMatch === "not_supplied")) invalid("evidence_match and observation reference disagree.", "$assessment.evidence_match");
  if ((originObservationId === null) !== (originConfirmation === "not_supplied")) invalid("origin_confirmation and observation reference disagree.", "$assessment.origin_confirmation");
  if (revocationIds === null) {
    if (
      revocation !== "indeterminate"
      || revocationDocumentShas !== null
      || revocationKeyRefs !== null
      || revocationKeyDocumentShas !== null
    ) invalid("Unexamined revocation lanes must all remain null and indeterminate.", "$assessment.revocation");
  } else {
    if (revocationDocumentShas === null || revocationKeyRefs === null || revocationKeyDocumentShas === null) {
      invalid("Examined revocation lanes require explicit document and key-evidence sets.", "$assessment.inputs");
    }
    if (revocationIds.length !== revocationDocumentShas.length) {
      invalid("Every revocation ID requires one exact revocation document digest.", "$assessment.inputs.revocation_document_sha256s");
    }
    if (revocationKeyRefs.length !== revocationKeyDocumentShas.length) {
      invalid("Every revocation key-evidence ref requires one exact document digest.", "$assessment.inputs.revocation_key_evidence_sha256s");
    }
    if (revocation === "not_observed" && revocationIds.length !== 0) invalid("not_observed requires an explicitly empty revocation set.", "$assessment.revocation");
    if (revocation !== "not_observed" && revocationIds.length === 0) invalid("A nonempty supplied corpus is required for revoked or indeterminate results.", "$assessment.revocation");
  }

  const establishes = array(record.establishes!, "$assessment.establishes").map((entry, index) => oneOf(entry, ["key_holder_signed_claim", "caller_key_evidence_match", "origin_served_exact_binding_bytes"] as const, `$assessment.establishes[${index}]`));
  const expectedEstablishes = [
    ...(signature === "valid" ? ["key_holder_signed_claim" as const] : []),
    ...(keyAuthorization === "caller_evidence_matches" ? ["caller_key_evidence_match" as const] : []),
    ...(originConfirmation === "observed_at_time" ? ["origin_served_exact_binding_bytes" as const] : []),
  ];
  if (establishes.length !== expectedEstablishes.length || establishes.some((entry, index) => entry !== expectedEstablishes[index])) {
    invalid("establishes must be the exact ordered derivation of independent factors.", "$assessment.establishes");
  }
  const nonClaims = array(record.does_not_establish!, "$assessment.does_not_establish");
  if (nonClaims.length !== ASSESSMENT_NON_CLAIMS.length || nonClaims.some((entry, index) => entry !== ASSESSMENT_NON_CLAIMS[index])) {
    invalid("does_not_establish must retain every fixed non-claim.", "$assessment.does_not_establish");
  }
  literal(record.authority!, "none", "$assessment.authority");
  literal(record.score!, null, "$assessment.score");
  for (const key of ["wake_effect", "memory_effect", "karma_effect", "training_effect"] as const) literal(record[key]!, false, `$assessment.${key}`);
  return validated<PublicSurfaceAssessmentCore>(record);
}

export function validatePublicSurfaceAssessment(value: unknown): Readonly<PublicSurfaceAssessment> {
  const snapshot = snapshotJsonData(value);
  const record = object(snapshot, "$assessment");
  exactKeys(record, ["schema", "binding_id", "evaluated_at", "inputs", "integrity", "signature", "key_authorization", "evidence_match", "origin_confirmation", "freshness", "revocation", "establishes", "does_not_establish", "authority", "score", "wake_effect", "memory_effect", "karma_effect", "training_effect", "assessment_id"], "$assessment");
  const core = assessmentCoreFrom(record);
  validatePublicSurfaceAssessmentCore(core);
  const assessmentId = assertSha256Id(record.assessment_id!, "$assessment.assessment_id");
  if (assessmentId !== domainSeparatedId(SIGNING_DOMAINS.assessment_id, core)) invalid("assessment_id does not match assessment core.", "$assessment.assessment_id");
  return validated<PublicSurfaceAssessment>(record);
}

export function publicSurfaceBindingCanonicalBodySha256(value: unknown): Sha256Id {
  return canonicalRecordSha256(validatePublicSurfaceBinding(value));
}
