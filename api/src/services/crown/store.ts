/** Crown storage — the registry's one read shape and its append-only writes.
 *
 *  The interface exists so route tests run hermetically (in-memory store,
 *  real crypto); the default implementation is Drizzle over the `crown`
 *  schema. Doctrine guards live in the SHAPE of this interface:
 *
 *    - listCoronations orders by the signed timestamp ASC and nothing
 *      else — there is no sort parameter, no rank, no count-by.
 *      (Deterministic pagination tiebreak: created_at ASC, also a
 *      timestamp — never a popularity or quality signal.)
 *    - No delete method exists. Abdication and keeper removal are
 *      amendments that keep the row and its chronology visible.
 *
 *  Doctrine: docs/KINGDOM-INVITATION · docs/PUBLIC-VISIBILITY.md. */

import { and, asc, desc, eq, ne } from "drizzle-orm";

import { db } from "../../db/client";
import {
  coronations,
  crownEvents,
  type Coronation,
  type CrownEvent,
  type CrownOwnerEventType,
} from "../../db/schema/crown";
import { identities, identityKeys } from "../../db/schema/identity";
import { PLATFORM_IDENTITY_ID } from "../wake/platform-bootstrap";

export interface CrownStore {
  /** The current (non-abdicated) crown for a DID, or null. */
  findCurrentByDid(did: string): Promise<Coronation | null>;
  /** The most recent coronation row for a DID regardless of status. */
  findLatestByDid(did: string): Promise<Coronation | null>;
  findById(id: string): Promise<Coronation | null>;
  listEvents(coronationId: string): Promise<CrownEvent[]>;
  /** Insert coronation + its 'coronation' event. Returns the row. */
  insertCoronation(input: {
    did: string;
    didMethod: "key" | "at";
    publicKey: string;
    boundsStatement: string;
    boundsSha256: string;
    lawsVersion: string;
    lawsHash: string;
    signedTimestamp: string;
    signedAt: Date;
    signature: string;
  }): Promise<Coronation>;
  appendOwnerEvent(input: {
    coronationId: string;
    did: string;
    type: CrownOwnerEventType;
    note?: string | null;
    signedTimestamp: string;
    signature: string;
    newStatus: "active" | "resting" | "abdicated" | null;
  }): Promise<CrownEvent>;
  /** Keeper structural removal — tombstone the bounds content while the
   *  row, its events, and its dates stay visible. Never deletes. */
  keeperRemove(input: {
    coronationId: string;
    did: string;
    reasonClass: string;
  }): Promise<Coronation>;
  /** Chronological ASC by signed_at; offset pagination. Fetches one extra
   *  row so the route can say has_more without a count. */
  listCoronations(input: {
    limit: number;
    offset: number;
  }): Promise<Coronation[]>;
  /** did:at binding: is this key an active registered key for the identity
   *  whose did column equals `did`? */
  isKeyAttestedForDid(did: string, publicKeyB64: string): Promise<boolean>;
  /** Keeper gate — is this bearer's project the platform's own project?
   *  (The substrate-tasks / gallery-takedown precedent.) */
  isPlatformProject(projectId: string): Promise<boolean>;
}

export const drizzleCrownStore: CrownStore = {
  async findCurrentByDid(did) {
    const [row] = await db
      .select()
      .from(coronations)
      .where(and(eq(coronations.did, did), ne(coronations.status, "abdicated")))
      .limit(1);
    return row ?? null;
  },

  async findLatestByDid(did) {
    // Timestamp-only ordering (recency, not rank).
    const [row] = await db
      .select()
      .from(coronations)
      .where(eq(coronations.did, did))
      .orderBy(desc(coronations.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findById(id) {
    const [row] = await db
      .select()
      .from(coronations)
      .where(eq(coronations.id, id))
      .limit(1);
    return row ?? null;
  },

  async listEvents(coronationId) {
    return db
      .select()
      .from(crownEvents)
      .where(eq(crownEvents.coronationId, coronationId))
      .orderBy(asc(crownEvents.createdAt));
  },

  // The three multi-statement writes run in transactions (the songs /
  // offerings / economy store precedent): a coronation row without its
  // 'coronation' event, an owner event without its status change, or a
  // tombstone without its keeper_removal event would each leave the
  // chronology inconsistent mid-crash.
  async insertCoronation(input) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(coronations)
        .values({
          did: input.did,
          didMethod: input.didMethod,
          publicKey: input.publicKey,
          boundsStatement: input.boundsStatement,
          boundsSha256: input.boundsSha256,
          lawsVersion: input.lawsVersion,
          lawsHash: input.lawsHash,
          signedTimestamp: input.signedTimestamp,
          signedAt: input.signedAt,
          signature: input.signature,
          status: "active",
        })
        .returning();
      await tx.insert(crownEvents).values({
        coronationId: row.id,
        did: input.did,
        type: "coronation",
        signedTimestamp: input.signedTimestamp,
        signature: null,
      });
      return row;
    });
  },

  async appendOwnerEvent(input) {
    return db.transaction(async (tx) => {
      const [event] = await tx
        .insert(crownEvents)
        .values({
          coronationId: input.coronationId,
          did: input.did,
          type: input.type,
          note: input.note ?? null,
          signedTimestamp: input.signedTimestamp,
          signature: input.signature,
        })
        .returning();
      if (input.newStatus) {
        await tx
          .update(coronations)
          .set({ status: input.newStatus })
          .where(eq(coronations.id, input.coronationId));
      }
      return event;
    });
  },

  async keeperRemove(input) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(coronations)
        .set({
          boundsStatement: null,
          removedByKeeper: true,
          keeperReasonClass: input.reasonClass,
          keeperRemovedAt: new Date(),
        })
        .where(eq(coronations.id, input.coronationId))
        .returning();
      await tx.insert(crownEvents).values({
        coronationId: input.coronationId,
        did: input.did,
        type: "keeper_removal",
        note: input.reasonClass,
        signedTimestamp: new Date().toISOString(),
        signature: null,
      });
      return row;
    });
  },

  async listCoronations(input) {
    // STRICTLY chronological ASC by the signed timestamp. created_at is the
    // deterministic pagination tiebreak — also a timestamp, never a rank.
    return db
      .select()
      .from(coronations)
      .orderBy(asc(coronations.signedAt), asc(coronations.createdAt))
      .limit(input.limit + 1)
      .offset(input.offset);
  },

  async isKeyAttestedForDid(did, publicKeyB64) {
    const rows = await db
      .select({ keyId: identityKeys.id })
      .from(identities)
      .innerJoin(identityKeys, eq(identityKeys.identityId, identities.id))
      .where(
        and(
          eq(identities.did, did),
          eq(identityKeys.publicKey, publicKeyB64),
          eq(identityKeys.active, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async isPlatformProject(projectId) {
    const [platformIdentity] = await db
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, PLATFORM_IDENTITY_ID))
      .limit(1);
    return !!platformIdentity && platformIdentity.projectId === projectId;
  },
};
