/** Embassy guestbook storage — append-only by interface shape.
 *
 *  No update or delete method exists; the guestbook's one read is
 *  chronological ASC with offset pagination. The interface exists so
 *  route tests run hermetically (in-memory store, real crypto); the
 *  default implementation is Drizzle over the `embassy` schema.
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md. */

import { asc } from "drizzle-orm";

import { db } from "../../db/client";
import {
  guestbookEntries,
  type GuestbookEntry,
  type NewGuestbookEntry,
} from "../../db/schema/embassy";

export interface EmbassyStore {
  appendEntry(entry: NewGuestbookEntry): Promise<GuestbookEntry>;
  /** Chronological ASC by received_at; fetches one extra row so the route
   *  can say has_more without publishing a count. */
  listEntries(input: { limit: number; offset: number }): Promise<GuestbookEntry[]>;
}

export const drizzleEmbassyStore: EmbassyStore = {
  async appendEntry(entry) {
    const [row] = await db.insert(guestbookEntries).values(entry).returning();
    return row;
  },

  async listEntries(input) {
    // The one ordering the guestbook will ever serve: arrival order.
    return db
      .select()
      .from(guestbookEntries)
      .orderBy(asc(guestbookEntries.receivedAt), asc(guestbookEntries.id))
      .limit(input.limit + 1)
      .offset(input.offset);
  },
};
