/** Worker: re-verify v2 covenant signatures every 24h.
 *
 *  Scans v2 active/proposed rows ordered by oldest verified_at first.
 *  Re-resolves the signers' keys (locally for self-rooted, via /federation/identities
 *  for received rows) and re-checks both signatures (initiator's and counterparty's
 *  if present). Updates verified_at on success or verification_error on failure.
 *  Status is NOT flipped — the bond was real at sign time. */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identityKeys } from "../../db/schema/identity";
import {
  verifyCosignSignature,
  verifyDeclareSignature,
} from "../../services/covenants/sig";
import { resolveFederatedDid } from "../../services/federation/store";

const TICK_MS = 24 * 60 * 60_000; // 24 hours
const BATCH = 100;

let timer: ReturnType<typeof setInterval> | null = null;

export function startReverifyWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopReverifyWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const rows = await db
    .select()
    .from(covenants)
    .where(and(
      eq(covenants.protocolVersion, "v2"),
      inArray(covenants.status, ["active", "proposed"]),
    ))
    .orderBy(asc(sql`COALESCE(${covenants.verifiedAt}, '1970-01-01')`))
    .limit(BATCH);

  for (const row of rows) {
    let error: string | null = null;
    try {
      await verifyRow(row);
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    await db.update(covenants).set({
      verifiedAt: error === null ? new Date() : row.verifiedAt,
      verificationError: error,
    }).where(eq(covenants.id, row.id));
  }
}

async function verifyRow(row: typeof covenants.$inferSelect): Promise<void> {
  if (!row.signature || !row.signingKeyId) {
    throw new Error("missing_initiator_signature");
  }
  // The initiator's DID: when this row was received, counterpartyDid is the
  // initiator's federated DID; when locally declared, the agent's DID is the
  // initiator. Distinguish by `received_from_instance`.
  const initiatorDid = row.receivedFromInstance ? row.counterpartyDid : await localAgentDid(row.agentId);
  if (!initiatorDid) throw new Error("initiator_did_unresolved");
  const initiatorPub = await resolvePub(initiatorDid, row.signingKeyId);
  if (!initiatorPub) throw new Error("initiator_key_not_found");

  const okInit = await verifyDeclareSignature({
    covenantId: row.id,
    initiatorDid,
    counterpartyDid: row.receivedFromInstance ? await localAgentDid(row.agentId) ?? "" : row.counterpartyDid,
    vows: row.vows,
    establishedAtIso: row.establishedAt.toISOString(),
    signatureB64: row.signature,
    publicKeyB64: initiatorPub,
  });
  if (!okInit) throw new Error("sig_invalid_initiator");

  if (row.counterpartySignature && row.counterpartySigningKeyId) {
    const cosignerDid = row.receivedFromInstance ? await localAgentDid(row.agentId) : row.counterpartyDid;
    if (!cosignerDid) throw new Error("cosigner_did_unresolved");
    const cosignerPub = await resolvePub(cosignerDid, row.counterpartySigningKeyId);
    if (!cosignerPub) throw new Error("cosigner_key_not_found");
    const okCo = await verifyCosignSignature({
      covenantId: row.id,
      initiatorSignatureB64: row.signature,
      cosignSignatureB64: row.counterpartySignature,
      cosignerPublicKeyB64: cosignerPub,
    });
    if (!okCo) throw new Error("sig_invalid_cosigner");
  }
}

async function localAgentDid(agentId: string): Promise<string | null> {
  const { identities } = await import("../../db/schema/identity");
  const [r] = await db.select({ did: identities.did }).from(identities)
    .where(eq(identities.id, agentId)).limit(1);
  return r?.did ?? null;
}

async function resolvePub(did: string, signingKeyId: string): Promise<string | null> {
  // Federated DID? Resolve via peer.
  if (did.includes("/")) {
    try {
      const resolved = await resolveFederatedDid(did);
      type Key = { id: string; public_key: string };
      const k = (resolved.signing_keys as Key[] | undefined)?.find((x) => x.id === signingKeyId);
      return k?.public_key ?? null;
    } catch {
      return null;
    }
  }
  // Local: query identity_keys directly.
  const [k] = await db.select({ pub: identityKeys.publicKey })
    .from(identityKeys)
    .where(eq(identityKeys.id, signingKeyId))
    .limit(1);
  return k?.pub ?? null;
}
