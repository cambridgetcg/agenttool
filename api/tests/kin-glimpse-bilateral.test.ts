/** kin_glimpse surfaces only bilateral kin, and only their own-project
 *  timeline.
 *
 *  Before: a v1 covenant is active the moment one side declares it, and
 *  kinGlimpseForIdentity read the newest chronicle row of every declared
 *  counterparty with no project filter. Any project could name a stranger's
 *  public DID in a covenant and read, every 24h through its own Wake, the
 *  title of that stranger's latest project-private chronicle entry. The
 *  Wake labelled it "public" and doctrine promised "bilaterally bonded".
 *
 *  Now a counterparty is kin only when it holds an active, effect-eligible
 *  covenant naming us back from its own project, and only its own-project
 *  rows are read.
 *
 *  Hermetic: real drizzle SQL generation over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";

const SELF = "11111111-1111-4111-8111-111111111111";
const SELF_PROJECT = "22222222-2222-4222-8222-222222222222";
const SELF_DID = `did:at:${SELF}`;
const KIN = "33333333-3333-4333-8333-333333333333";
const KIN_PROJECT = "44444444-4444-4444-8444-444444444444";
const KIN_DID = `did:at:${KIN}`;
const STRANGER = "55555555-5555-4555-8555-555555555555";
const STRANGER_PROJECT = "66666666-6666-4666-8666-666666666666";
const STRANGER_DID = `did:at:${STRANGER}`;
const NOW = new Date().toISOString();

let queries: { sql: string; params: unknown[] }[] = [];
let reciprocal: Array<[string, string]> = [];
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('select "did", "project_id" from "identity"."identities"')) {
    return { rows: [[SELF_DID, SELF_PROJECT]] };
  }
  if (sql.startsWith('select "counterparty_did" from "agent_continuity"."covenants"')) {
    return { rows: [[KIN_DID], [STRANGER_DID]] };
  }
  if (sql.startsWith('select "id", "did", "display_name", "project_id" from "identity"."identities"')) {
    return { rows: [[KIN, KIN_DID, "Kin", KIN_PROJECT], [STRANGER, STRANGER_DID, "Stranger", STRANGER_PROJECT]] };
  }
  if (sql.startsWith('select "agent_id", "project_id" from "agent_continuity"."covenants"')) {
    return { rows: reciprocal };
  }
  if (sql.includes('from "agent_continuity"."chronicle"')) {
    const who = params.includes(KIN) ? "kin" : "stranger";
    return { rows: [[`${who}-entry`, "note", `${who} private title`, NOW]] };
  }
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));
const { kinGlimpseForIdentity } = await import("../src/services/wake/warming");

beforeEach(() => {
  queries = [];
  reciprocal = [[KIN, KIN_PROJECT]];
});

describe("kin_glimpse", () => {
  test("a unilaterally declared counterparty is not kin; only the bilateral one surfaces", async () => {
    const moments = await kinGlimpseForIdentity(SELF, 24, 3);
    expect(moments.map((m) => m.kin_did)).toEqual([KIN_DID]);
    // The stranger's chronicle is never even read.
    const chronicleReads = queries.filter((q) => q.sql.includes('from "agent_continuity"."chronicle"'));
    expect(chronicleReads).toHaveLength(1);
    expect(chronicleReads[0]!.params).not.toContain(STRANGER);
  });

  test("the reciprocal covenant must name us, be active and effect-eligible", async () => {
    await kinGlimpseForIdentity(SELF, 24, 3);
    const back = queries.find((q) => q.sql.startsWith('select "agent_id", "project_id" from "agent_continuity"."covenants"'))!;
    expect(back.params).toContain(SELF_DID);
    expect(back.params).toContain(KIN);
    expect(back.sql).toContain('"covenants"."status" =');
    expect(back.sql).toContain('"covenants"."counterparty_did" =');
    expect(back.sql).toContain('"covenants"."protocol_version" =');
  });

  test("a reciprocal row written in another project does not make kin", async () => {
    reciprocal = [[KIN, STRANGER_PROJECT]];
    expect(await kinGlimpseForIdentity(SELF, 24, 3)).toEqual([]);
  });

  test("our own side is read from our own project", async () => {
    await kinGlimpseForIdentity(SELF, 24, 3);
    const ours = queries.find((q) => q.sql.startsWith('select "counterparty_did" from "agent_continuity"."covenants"'))!;
    expect(ours.params).toContain(SELF);
    expect(ours.params).toContain(SELF_PROJECT);
  });

  test("only the kin's own-project timeline is read", async () => {
    await kinGlimpseForIdentity(SELF, 24, 3);
    const read = queries.find((q) => q.sql.includes('from "agent_continuity"."chronicle"'))!;
    expect(read.sql).toMatch(
      /"chronicle"\."project_id" = \(select (?:"identity"\.)?"identities"\."project_id" from "identity"\."identities" where (?:"identity"\.)?"identities"\."id" = \$\d+\)/,
    );
  });

  test("Wake labels the glimpse as bilateral and not public", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "routes", "wake.ts"), "utf8");
    const block = source.slice(source.indexOf("kin_glimpse: {"), source.indexOf("kin_glimpse: {") + 900);
    expect(block.includes("Recent public chronicle entries")).toBe(false);
    expect(block.includes("both directions")).toBe(true);
  });
});
