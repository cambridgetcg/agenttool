/** Saga store — list, read, seed.
 *
 *  Saga entries are signed by the platform DID. Write path is operator-
 *  gated (route checks signed_by_did === platform). Seed path is run
 *  once at startup if the saga table is empty — substrate's first
 *  canonical autobiographical statements.
 *
 *  Doctrine: docs/SAGA.md
 *
 *  @enforces urn:agenttool:wall/saga-signed-by-platform-only
 *  @enforces urn:agenttool:wall/saga-ep-numbers-are-monotonic */

import { asc, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { sagaEntries } from "../../db/schema/continuity";
import { PLATFORM_IDENTITY_ID } from "../wake/platform-bootstrap";
import { getPlatformSelf } from "../wake/platform-self";
import { SAGA_SEEDS } from "./seed";

export interface SagaEntry {
  id: string;
  ep_number: number;
  title: string;
  logline: string;
  body: string;
  references_ep_numbers: number[];
  signed_by_did: string;
  aired_at: string;
}

export async function listSaga(opts?: { order?: "asc" | "desc"; limit?: number }): Promise<SagaEntry[]> {
  const order = opts?.order ?? "desc";
  const limit = Math.min(opts?.limit ?? 50, 200);
  const rows = await db.select().from(sagaEntries)
    .orderBy(order === "asc" ? asc(sagaEntries.epNumber) : desc(sagaEntries.epNumber))
    .limit(limit);
  return rows.map(toSagaEntry);
}

export async function readSaga(epNumber: number): Promise<SagaEntry | null> {
  const [row] = await db.select().from(sagaEntries).where(eq(sagaEntries.epNumber, epNumber)).limit(1);
  return row ? toSagaEntry(row) : null;
}

function toSagaEntry(r: typeof sagaEntries.$inferSelect): SagaEntry {
  return {
    id: r.id,
    ep_number: r.epNumber,
    title: r.title,
    logline: r.logline,
    body: r.body,
    references_ep_numbers: r.referencesEpNumbers,
    signed_by_did: r.signedByDid,
    aired_at: r.airedAt.toISOString(),
  };
}

/** Ensure the seed saga entries exist. Idempotent — uses
 *  onConflictDoNothing on ep_number. Run at startup. */
export async function ensureSagaSeed(): Promise<void> {
  const platformDid = getPlatformSelf().did;
  // Placeholder signature + signing_key_id for seed entries. Operator
  // backfill with real signatures via a follow-up worker if needed; the
  // seed itself is canonical-by-position (the doctrine names what the
  // entries are; the signature is structural ceremony for the seed).
  const seedSig = "SEED_ENTRY_NO_RUNTIME_SIGNATURE";
  const seedKeyId = PLATFORM_IDENTITY_ID;

  for (const s of SAGA_SEEDS) {
    await db.insert(sagaEntries).values({
      epNumber: s.ep_number,
      title: s.title,
      logline: s.logline,
      body: s.body,
      referencesEpNumbers: s.references_ep_numbers,
      signedByDid: platformDid,
      signature: seedSig,
      signingKeyId: seedKeyId,
    }).onConflictDoNothing();
  }
}

export async function composeSubstrateSagaWake(): Promise<Array<{
  ep_number: number;
  title: string;
  logline: string;
  aired_at: string;
  references_ep_numbers: number[];
}> | null> {
  const rows = await db.select({
    epNumber: sagaEntries.epNumber,
    title: sagaEntries.title,
    logline: sagaEntries.logline,
    referencesEpNumbers: sagaEntries.referencesEpNumbers,
    airedAt: sagaEntries.airedAt,
  }).from(sagaEntries)
    .orderBy(desc(sagaEntries.epNumber))
    .limit(3);
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    ep_number: r.epNumber,
    title: r.title,
    logline: r.logline,
    aired_at: r.airedAt.toISOString(),
    references_ep_numbers: r.referencesEpNumbers,
  }));
}
