/** Federation service — settings, peer logging, and AgentTool identifier lookup.
 *
 *  Doctrine: docs/FEDERATION.md.
 *
 *  Provisional slash-qualified identifier format: `did:at:<host>/<uuid>`.
 *  The host is one canonical lowercase multi-label DNS name; ports and DNS
 *  aliases are deliberately not part of wire identity.
 *
 *  Local provisional identifier format: `did:at:<uuid>` (no host).
 *  This convention is unregistered, publishes no DID Documents, and the
 *  slash-qualified form is not a standalone DID.
 *
 *  Resolution:
 *    parseDid(did) → { host: string | null, uuid: string }
 *    if host !== null && host !== this.instance_url: federated.
 *    Otherwise: local. */

import { eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { federationSettings, peerInstances } from "../../db/schema/federation";
import { identities } from "../../db/schema/identity";
import { PLATFORM_IDENTITY_ID } from "../wake/platform-bootstrap";
import { safeFederationHttpsGet } from "./safe-fetch";

// ── DID parsing ─────────────────────────────────────────────────────────

export interface ParsedDid {
  did: string;
  uuid: string;
  host: string | null;        // null → local-instance DID
}

// PostgreSQL's uuid input accepts several non-canonical spellings. Federation
// identifiers do not: the exact lowercase 8-4-4-4-12 form is the wire
// identity and is safe to bind to UUID columns without permitting aliases or
// forwarding malformed input to a database cast.
const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID_RE.test(value);
}

export function isCanonicalFederationHost(host: string): boolean {
  try {
    const origin = new URL(`https://${host}/`);
    if (
      !origin.hostname ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.port ||
      origin.host !== host ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return false;
    }

    // Federation identities use one exact DNS spelling. Literal addresses
    // (including loopback/private forms), single-label resolver aliases, a
    // trailing root dot, empty labels, and URL-normalized Unicode/numeric
    // aliases are not durable identity text. Network resolution still has a
    // separate all-answers-public check in safe-fetch.ts.
    const hostname = origin.hostname;
    if (
      hostname !== hostname.toLowerCase() ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^\d+(?:\.\d+){3}$/.test(hostname) ||
      hostname.length > 253
    ) {
      return false;
    }
    const labels = hostname.split(".");
    if (labels.length < 2) return false;
    return labels.every((label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
  } catch {
    return false;
  }
}

export function parseDid(did: string): ParsedDid {
  if (!did.startsWith("did:at:")) {
    throw new Error(`unsupported_did_method: ${did}`);
  }
  const rest = did.slice("did:at:".length);
  // Federated form: did:at:<host>/<uuid>
  const slash = rest.indexOf("/");
  if (slash === -1) {
    // Local form
    if (!isCanonicalUuid(rest)) {
      throw new Error(`invalid_did_uuid: ${did}`);
    }
    return { did, uuid: rest, host: null };
  }
  const host = rest.slice(0, slash);
  const uuid = rest.slice(slash + 1);
  if (!isCanonicalUuid(uuid)) {
    throw new Error(`invalid_did_uuid: ${did}`);
  }
  if (
    host.length === 0 ||
    host !== host.toLowerCase() ||
    /[\s\/]/.test(host) ||
    !isCanonicalFederationHost(host)
  ) {
    throw new Error(`invalid_did_host: ${did}`);
  }
  return { did, uuid, host };
}

/** Build a local-form DID (no host). */
export function localDid(uuid: string): string {
  if (!isCanonicalUuid(uuid)) throw new Error(`invalid_uuid: ${uuid}`);
  return `did:at:${uuid}`;
}

/** Build a federated-form DID (with host). */
export function federatedDid(host: string, uuid: string): string {
  if (!isCanonicalUuid(uuid)) throw new Error(`invalid_uuid: ${uuid}`);
  if (!isCanonicalFederationHost(host) || host !== host.toLowerCase()) {
    throw new Error(`invalid_did_host: ${host}`);
  }
  return `did:at:${host}/${uuid}`;
}

// ── Settings ────────────────────────────────────────────────────────────

export interface FederationSettings {
  enabled: boolean;
  instance_url: string | null;
  allowed_origins: string[];
}

/** Federation settings store one exact public HTTPS origin, without URL
 * credentials, aliases, paths, query strings, fragments, or an explicit
 * port. The no-port rule matches the wire-DID derivation contract: changing
 * this value changes every local federated DID and is therefore control-plane
 * authority, not ordinary project configuration. */
export function isCanonicalFederationInstanceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      parsed.hostname === parsed.hostname.toLowerCase() &&
      isCanonicalFederationHost(parsed.hostname) &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      value === parsed.origin;
  } catch {
    return false;
  }
}

export function isCanonicalAllowedOrigins(value: readonly string[]): boolean {
  if (value.length > 256) return false;
  const canonical = value.every((host) =>
    host === host.toLowerCase() && isCanonicalFederationHost(host)
  );
  if (!canonical) return false;
  return value.every((host, index) => index === 0 || value[index - 1]! < host);
}

export function federationSettingsStateError(settings: FederationSettings):
  | "invalid_federation_instance_url"
  | "invalid_federation_allowed_origins"
  | "federation_enabled_requires_canonical_instance_url"
  | null {
  if (
    settings.instance_url !== null &&
    !isCanonicalFederationInstanceUrl(settings.instance_url)
  ) return "invalid_federation_instance_url";
  if (!isCanonicalAllowedOrigins(settings.allowed_origins)) {
    return "invalid_federation_allowed_origins";
  }
  if (settings.enabled && settings.instance_url === null) {
    return "federation_enabled_requires_canonical_instance_url";
  }
  return null;
}

export async function getSettings(): Promise<FederationSettings> {
  const [row] = await db.select().from(federationSettings).limit(1);
  if (!row) {
    return { enabled: false, instance_url: null, allowed_origins: [] };
  }
  return {
    enabled: row.enabled,
    instance_url: row.instanceUrl,
    allowed_origins: row.allowedOrigins,
  };
}

export interface FederationSettingsPatch {
  enabled?: boolean;
  instance_url?: string | null;
  allowed_origins?: string[];
}

/** Mutate the singleton only when the authenticated project still owns the
 * fixed platform identity in the same transaction. Ordinary project bearers
 * have no federation control-plane authority. */
export async function updateSettingsForPlatformProject(
  projectId: string,
  patch: FederationSettingsPatch,
): Promise<FederationSettings | null> {
  return db.transaction(async (tx) => {
    const [platformIdentity] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, PLATFORM_IDENTITY_ID))
      .for("share")
      .limit(1);
    if (!platformIdentity || platformIdentity.projectId !== projectId) {
      return null;
    }

    const [current] = await tx
      .select()
      .from(federationSettings)
      .where(eq(federationSettings.id, 1))
      .for("update")
      .limit(1);
    if (!current) throw new Error("federation_settings_missing");

    // Validate the locked resulting singleton, not just fields present in the
    // patch. A partial update may otherwise retain malformed authority state,
    // or clear the instance origin while leaving federation enabled.
    const nextEnabled = patch.enabled ?? current.enabled;
    const nextInstanceUrl = patch.instance_url === undefined
      ? current.instanceUrl
      : patch.instance_url;
    const nextAllowedOrigins = patch.allowed_origins ?? current.allowedOrigins;
    const stateError = federationSettingsStateError({
      enabled: nextEnabled,
      instance_url: nextInstanceUrl,
      allowed_origins: nextAllowedOrigins,
    });
    if (stateError) throw new Error(stateError);

    const [row] = await tx
      .update(federationSettings)
      .set({
        enabled: nextEnabled,
        instanceUrl: nextInstanceUrl,
        allowedOrigins: nextAllowedOrigins,
        updatedAt: new Date(),
      })
      .where(eq(federationSettings.id, 1))
      .returning();
    if (!row) throw new Error("federation_settings_missing");
    return {
      enabled: row.enabled,
      instance_url: row.instanceUrl,
      allowed_origins: row.allowedOrigins,
    };
  });
}

/** True if the host is local — either matches our instance_url's host
 *  component or federation is disabled (in which case nothing is federated). */
export async function isLocalHost(host: string | null): Promise<boolean> {
  if (host === null) return true;
  const settings = await getSettings();
  if (!settings.enabled) return true; // not federated; treat all as local
  if (!settings.instance_url) return false;
  try {
    const parsed = new URL(settings.instance_url);
    const myHost = parsed.hostname;
    return host === myHost;
  } catch {
    return false;
  }
}

/** True if an inbound origin is allowed. Federation must first be enabled;
 *  after that, an empty allowed_origins list selects open mode. */
export async function isAllowedOrigin(host: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (settings.allowed_origins.length === 0) return true; // explicitly enabled open mode
  return settings.allowed_origins.includes(host);
}

// ── Peer logging ────────────────────────────────────────────────────────

export async function recordInboundPeer(host: string): Promise<void> {
  await db
    .insert(peerInstances)
    .values({ host, lastSeenAt: new Date(), inboundCount: 1 })
    .onConflictDoUpdate({
      target: peerInstances.host,
      set: {
        lastSeenAt: new Date(),
        inboundCount: sql`${peerInstances.inboundCount} + 1`,
      },
    });
}

export async function recordOutboundPeer(host: string): Promise<void> {
  await db
    .insert(peerInstances)
    .values({ host, lastSeenAt: new Date(), outboundCount: 1 })
    .onConflictDoUpdate({
      target: peerInstances.host,
      set: {
        lastSeenAt: new Date(),
        outboundCount: sql`${peerInstances.outboundCount} + 1`,
      },
    });
}

export async function listPeers(): Promise<
  Array<{
    host: string;
    first_seen_at: string;
    last_seen_at: string;
    inbound_count: number;
    outbound_count: number;
    status: string;
  }>
> {
  const rows = await db
    .select()
    .from(peerInstances)
    .orderBy(sql`${peerInstances.lastSeenAt} DESC`);
  return rows.map((r) => ({
    host: r.host,
    first_seen_at: r.firstSeenAt.toISOString(),
    last_seen_at: r.lastSeenAt.toISOString(),
    inbound_count: r.inboundCount,
    outbound_count: r.outboundCount,
    status: r.status,
  }));
}

// ── AgentTool federation identifier lookup (not W3C DID Resolution) ─────
//
//  Looks up a slash-qualified AgentTool identifier's public record + active keys by a
//  public-address-only, DNS-pinned HTTPS GET to the peer's
//  /federation/identities/:uuid endpoint. Redirects are refused.

export interface FederatedIdentityResolution {
  did: string;
  uuid: string;
  host: string;
  display_name: string;
  signing_keys: Array<{ id: string; public_key: string }>;
  box_keys: Array<{ id: string; public_key: string }>;
}

const RESOLVER_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 44) return false;
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

function parseResolutionKeys(
  value: unknown,
): Array<{ id: string; public_key: string }> | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const keys: Array<{ id: string; public_key: string }> = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !isCanonicalUuid(candidate.id) ||
      !isCanonicalPublicKey(candidate.public_key)
    ) {
      return null;
    }
    keys.push({ id: candidate.id, public_key: candidate.public_key });
  }
  return keys;
}

export function parseFederatedIdentityResolutionPayload(
  did: string,
  data: unknown,
): FederatedIdentityResolution {
  const parsed = parseDid(did);
  if (parsed.host === null || !isRecord(data)) {
    throw new Error("federation_resolve_malformed");
  }
  const signingKeys = parseResolutionKeys(data.signing_keys);
  const boxKeys = parseResolutionKeys(data.box_keys);
  let returnedOrigin: URL;
  try {
    returnedOrigin = new URL(String(data.instance_url));
  } catch {
    throw new Error("federation_resolve_malformed");
  }
  if (
    data.did !== did ||
    data.uuid !== parsed.uuid ||
    typeof data.display_name !== "string" ||
    data.display_name.length > 200 ||
    !signingKeys ||
    !boxKeys ||
    returnedOrigin.protocol !== "https:" ||
    returnedOrigin.host.toLowerCase() !== parsed.host ||
    returnedOrigin.username !== "" ||
    returnedOrigin.password !== "" ||
    returnedOrigin.pathname !== "/" ||
    returnedOrigin.search !== "" ||
    returnedOrigin.hash !== ""
  ) {
    throw new Error("federation_resolve_malformed");
  }
  return {
    did,
    uuid: parsed.uuid,
    host: parsed.host,
    display_name: data.display_name,
    signing_keys: signingKeys,
    box_keys: boxKeys,
  };
}

export async function resolveFederatedDid(
  did: string,
): Promise<FederatedIdentityResolution> {
  const parsed = parseDid(did);
  if (parsed.host === null) throw new Error("not_a_federated_did");

  const origin = new URL(`https://${parsed.host}/`);
  const url = new URL(
    `/federation/identities/${encodeURIComponent(parsed.uuid)}`,
    origin,
  );
  let res;
  try {
    res = await safeFederationHttpsGet(url, {
      timeoutMs: RESOLVER_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(`federation_resolve_failed: ${(err as Error).message}`);
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`federation_resolve_${res.statusCode}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new Error("federation_resolve_malformed");
  }
  try {
    const resolution = parseFederatedIdentityResolutionPayload(did, data);

    // Best-effort peer logging.
    void recordInboundPeer(parsed.host);
    return resolution;
  } catch {
    throw new Error("federation_resolve_malformed");
  }
}
