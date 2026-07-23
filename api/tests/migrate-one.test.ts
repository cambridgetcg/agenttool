/** Transaction-wrapper detection for the migration runner.
 *
 * These are deliberately source-only tests: the helper must make its decision
 * before any database connection is opened. */

import { describe, expect, test } from "bun:test";

import { shouldWrapInTransaction } from "../scripts/_migrate-one";

describe("_migrate-one transaction handling", () => {
  test("does not double-wrap a BEGIN after a long comment header", () => {
    expect(
      shouldWrapInTransaction(`
-- migration title
-- documentation line one
-- documentation line two
-- documentation line three
-- documentation line four
-- documentation line five

BEGIN;
ALTER TABLE example ADD COLUMN value text;
COMMIT;
`),
    ).toBe(false);
  });

  test("does not mistake a later PL/pgSQL BEGIN for transaction ownership", () => {
    expect(
      shouldWrapInTransaction(`
DO $$
BEGIN
  PERFORM 1;
END $$;
`),
    ).toBe(true);
  });

  test("honours the explicit no-transaction marker", () => {
    expect(
      shouldWrapInTransaction("-- @no-transaction\nCREATE INDEX CONCURRENTLY idx ON example (id);"),
    ).toBe(false);
  });
});
