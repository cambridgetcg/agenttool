import { and, eq, ne } from "drizzle-orm";

import { identities } from "../../db/schema/identity";

export const MEMORIAL_TERMINAL_ERROR = "identity_memorial_terminal";
export const MEMORIAL_TERMINAL_MESSAGE =
  "A memorial identity's declared state, expression, and key registries are immutable.";

/** Memorial rows remain readable and addressable, but their identity state
 * must not change after the witnessed transition. */
export function mutableIdentityPredicate(identityId: string) {
  return and(
    eq(identities.id, identityId),
    ne(identities.status, "memorial"),
  );
}

export function isMemorialTerminal(status: string): boolean {
  return status === "memorial";
}
