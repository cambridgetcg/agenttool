/** economy.gift_credit_codes — fiat gifts minted as single-use bearer codes.
 *  Pins the columns the billing + redeem flows depend on. */
import { describe, expect, test } from "bun:test";

import { getTableColumns } from "drizzle-orm";
import { giftCreditCodes } from "../src/db/schema/economy";

describe("gift_credit_codes schema", () => {
  test("has the columns the gift lifecycle depends on", () => {
    const cols = getTableColumns(giftCreditCodes);
    for (const k of [
      "id", "code", "codeHash", "amountMinor", "currency", "credits",
      "stripeSessionId", "stripeEventId", "status", "mintedAt",
      "redeemedByProject", "redeemedByIdentity", "redeemedAt", "metadata",
    ]) {
      expect(cols).toHaveProperty(k);
    }
  });
  test("code is nullable (nulled on redemption), hash/session/event are required", () => {
    const cols = getTableColumns(giftCreditCodes);
    expect(cols.code.notNull).toBe(false);
    expect(cols.codeHash.notNull).toBe(true);
    expect(cols.stripeSessionId.notNull).toBe(true);
    expect(cols.stripeEventId.notNull).toBe(true);
  });
});
