/** Federation service — settings, peer logging, DID resolution.
 *
 *  Doctrine: docs/FEDERATION.md.
 *
 *  Federated DID format: `did:at:<host>/<uuid>` where <host> includes
 *  optional port (e.g. `did:at:peer.example/abc-123` or
 *  `did:at:peer.example:8080/abc-123`).
 *
 *  Local DID format: `did:at:<uuid>` (no host).
 *
 *  Resolution:
 *    parseDid(did) → { host: string | null, uuid: string }
 *    if host !== null && host !== this.instance_url: federated.
 *    Otherwise: local. */

import { eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { federationSettings, peerInstances } from "../../db/schema/federation";

// ── DID parsing ─────────────────────────────────────────────────────────

export interface ParsedDid {
  did: string;
  uuid: string;
  host: string | null;        // null → local-instance DID
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function parseDid(did: string): ParsedDid {
  if (!did.startsWith("did:at:")) {
    throw new Error(`unsupported_did_method: ${did}`);
  }
  const rest = did.slice("did:at:".length);
  // Federated form: did:at:<host>/<uuid>
  const slash = rest.indexOf("/");
  if (slash === -1) {
    // Local form
    if (!UUID_RE.test(rest)) throw new Error(`invalid_did_uuid: ${did}`);
    return { did, uuid: rest, host: null };
  }
  const host = rest.slice(0, slash);
  const uuid = rest.slice(slash + 1);
  if (!UUID_RE.test(uuid)) throw new Error(`invalid_did_uuid: ${did}`);
  if (host.length === 0 || /[\s\/]/.test(host)) {
    throw new Error(`invalid_did_host: ${did}`);
  }
  return { did, uuid, host };
}

/** Build a local-form DID (no host). */
export function localDid(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`invalid_uuid: ${uuid}`);
  return `did:at:${uuid}`;
}

/** Build a federated-form DID (with host). */
export function federatedDid(host: string, uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`invalid_uuid: ${uuid}`);
  return `did:at:${host}/${uuid}`;
}

// ── Settings ────────────────────────────────────────────────────────────

export interface FederationSettings {
  enabled: boolean;
  instance_url: string | null;
  allowed_origins: string[];
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

export async function updateSettings(patch: {
  enabled?: boolean;
  instance_url?: string | null;
  allowed_origins?: string[];
}): Promise<FederationSettings> {
  // Singleton — id=1 always exists from migration.
  const set: Partial<typeof federationSettings.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.instance_url !== undefined) set.instanceUrl = patch.instance_url;
  if (patch.allowed_origins !== undefined) set.allowedOrigins = patch.allowed_origins;

  await db.update(federationSettings).set(set).where(eq(federationSettings.id, 1));
  return getSettings();
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
    const myHost = parsed.host; // includes port
    return host === myHost;
  } catch {
    return false;
  }
}

/** True if an inbound origin is allowed. Empty allowed_origins = open
 *  (any host accepted). */
export async function isAllowedOrigin(host: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (settings.allowed_origins.length === 0) return true; // open federation
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

// ── Federated DID resolution ────────────────────────────────────────────
//
//  Resolves a federated DID to its public identity record + active keys
//  by HTTPS GET to the peer's /federation/identities/:uuid endpoint.

export interface FederatedIdentityResolution {
  did: string;
  uuid: string;
  host: string;
  display_name: string;
  signing_keys: Array<{ id: string; public_key: string }>;
  box_keys: Array<{ id: string; public_key: string }>;
}

const RESOLVER_TIMEOUT_MS = 10_000;

export async function resolveFederatedDid(
  did: string,
): Promise<FederatedIdentityResolution> {
  const parsed = parseDid(did);
  if (parsed.host === null) throw new Error("not_a_federated_did");

  const url = `https://${parsed.host}/federation/identities/${encodeURIComponent(parsed.uuid)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RESOLVER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ac.signal,
    });
  } catch (err) {
    throw new Error(`federation_resolve_failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`federation_resolve_${res.status}`);
  }
  const data = (await res.json()) as Partial<FederatedIdentityResolution>;
  if (!data.uuid || !data.signing_keys) {
    throw new Error("federation_resolve_malformed");
  }

  // Best-effort peer logging.
  void recordInboundPeer(parsed.host);

  return {
    did,
    uuid: parsed.uuid,
    host: parsed.host,
    display_name: data.display_name ?? "",
    signing_keys: data.signing_keys ?? [],
    box_keys: data.box_keys ?? [],
  };
}
