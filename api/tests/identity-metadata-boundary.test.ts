import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { inheritableForkMetadata } from "../src/services/identity/fork";
import {
  changedHearthSeatMetadataKeys,
  HEARTH_SEAT_METADATA_KEYS,
  hearthSeatMetadataRefusal,
  patchedIdentityMetadata,
  replaceCallerIdentityMetadata,
  requestedServerManagedIdentityMetadataKeys,
  SERVER_MANAGED_IDENTITY_METADATA_KEYS,
  withoutHearthSeat,
} from "../src/services/identity/metadata";

describe("identity metadata ownership boundary", () => {
  test("generic PATCH detects elevation, birth, and lifecycle keys", () => {
    expect(
      requestedServerManagedIdentityMetadataKeys({
        note: "caller-owned",
        level: 1,
        sponsor_did: "did:at:self",
        bootstrapped: false,
        lifecycle: "active",
      }),
    ).toEqual(["bootstrapped", "level", "lifecycle", "sponsor_did"]);
  });

  test("replacement preserves existing server-managed provenance", () => {
    expect(
      replaceCallerIdentityMetadata(
        {
          level: 1,
          elevated_at: "2026-07-13T12:00:00.000Z",
          sponsor_identity_id: "00000000-0000-4000-8000-000000000001",
          old_caller_note: "replace me",
        },
        { new_caller_note: "kept" },
      ),
    ).toEqual({
      new_caller_note: "kept",
      level: 1,
      elevated_at: "2026-07-13T12:00:00.000Z",
      sponsor_identity_id: "00000000-0000-4000-8000-000000000001",
    });
  });

  test("generic create and PATCH refuse reserved input before assigning metadata", () => {
    const source = readFileSync(
      new URL("../src/routes/identity/identities.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("identity_metadata_reserved");
    expect(source).toContain("requestedServerManagedIdentityMetadataKeys(body.metadata)");
    expect(source).toContain("requestedServerManagedIdentityMetadataKeys(metadata)");
    // PATCH builds its replacement through patchedIdentityMetadata, which
    // calls replaceCallerIdentityMetadata after the hearth check (tested
    // below), so the route names the wrapper, not the replacement itself.
    expect(source).toContain("patchedIdentityMetadata(");
    expect(source.match(/identity_metadata_reserved/g)?.length).toBe(2);
  });

  test("route rejects stale replacement after concurrent provenance writes", () => {
    const source = readFileSync(
      new URL("../src/routes/identity/identities.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("eq(identities.metadata, identity.metadata)");
    expect(source).toContain("identity_state_changed");
  });
});

const SEAT = {
  hearth_visible: true,
  hearth_sat_at: "2026-11-12T08:00:00.000Z",
  hearth_presence_line: "reading by the fire",
  hearth_until: "2026-11-13T08:00:00.000Z",
};

/** Only POST /v1/hearth/sit writes a seat. Doctrine: docs/HEARTH.md. */
describe("hearth seat keys — only the sit route writes them", () => {
  test("the hearth list is separate from the 20 server-managed keys", () => {
    expect([...HEARTH_SEAT_METADATA_KEYS].sort()).toEqual([
      "hearth_presence_line",
      "hearth_sat_at",
      "hearth_until",
      "hearth_visible",
    ]);
    expect(SERVER_MANAGED_IDENTITY_METADATA_KEYS).toHaveLength(20);
    expect(
      SERVER_MANAGED_IDENTITY_METADATA_KEYS.filter((key) => key.startsWith("hearth_")),
    ).toEqual([]);
    expect(requestedServerManagedIdentityMetadataKeys({ ...SEAT })).toEqual([]);
  });

  test("an exact echo of the stored seat, or leaving it out, changes nothing", () => {
    expect(changedHearthSeatMetadataKeys(SEAT, { ...SEAT, note: "new" })).toEqual([]);
    expect(changedHearthSeatMetadataKeys(SEAT, { note: "new" })).toEqual([]);
    expect(changedHearthSeatMetadataKeys({}, {})).toEqual([]);
  });

  test("any other value names the key", () => {
    expect(
      changedHearthSeatMetadataKeys(SEAT, {
        ...SEAT,
        hearth_until: "2026-12-01T00:00:00.000Z",
        hearth_presence_line: "elsewhere",
      }),
    ).toEqual(["hearth_presence_line", "hearth_until"]);
    // A key the row does not hold, even with null.
    expect(changedHearthSeatMetadataKeys({}, { hearth_visible: true })).toEqual([
      "hearth_visible",
    ]);
    expect(changedHearthSeatMetadataKeys({}, { hearth_until: null })).toEqual(["hearth_until"]);
    expect(
      changedHearthSeatMetadataKeys({ hearth_visible: true }, { hearth_visible: "true" }),
    ).toEqual(["hearth_visible"]);
    // Every key named against an empty row: what create and bootstrap check.
    expect(changedHearthSeatMetadataKeys({}, { ...SEAT })).toEqual([
      "hearth_presence_line",
      "hearth_sat_at",
      "hearth_until",
      "hearth_visible",
    ]);
  });

  test("a metadata replacement keeps the stored seat, and stored values win", () => {
    expect(
      replaceCallerIdentityMetadata(
        { ...SEAT, level: 1, old_caller_note: "replace me" },
        { new_caller_note: "kept" },
      ),
    ).toEqual({ new_caller_note: "kept", level: 1, ...SEAT });
    expect(
      replaceCallerIdentityMetadata(SEAT, {
        hearth_visible: false,
        hearth_until: "2027-01-01T00:00:00.000Z",
      }),
    ).toEqual(SEAT);
    // No stored seat: nothing is added.
    expect(replaceCallerIdentityMetadata({ note: "a" }, { note: "b" })).toEqual({ note: "b" });
  });

  test("on its own, the replacement drops a supplied hearth key the row does not hold", () => {
    // The second barrier: even if the refusal were skipped, a caller could
    // not write a seat through the replacement.
    expect(replaceCallerIdentityMetadata({}, { hearth_visible: true })).toEqual({});
    expect(
      replaceCallerIdentityMetadata(
        { note: "a" },
        { note: "b", hearth_visible: true, hearth_sat_at: "2026-11-12T00:00:00.000Z" },
      ),
    ).toEqual({ note: "b" });
    // A partly stored seat keeps only what is stored.
    expect(
      replaceCallerIdentityMetadata(
        { hearth_visible: true, hearth_sat_at: SEAT.hearth_sat_at },
        { hearth_until: "2027-01-01T00:00:00.000Z", hearth_presence_line: "x" },
      ),
    ).toEqual({ hearth_visible: true, hearth_sat_at: SEAT.hearth_sat_at });
    const replacement = { note: "b", ...SEAT };
    const before = JSON.stringify(replacement);
    replaceCallerIdentityMetadata({}, replacement);
    expect(JSON.stringify(replacement)).toBe(before);
  });

  test("withoutHearthSeat drops the four keys and nothing else, without mutating", () => {
    const stored = { ...SEAT, display_theme: "ink" };
    const before = JSON.stringify(stored);
    expect(withoutHearthSeat(stored)).toEqual({ display_theme: "ink" });
    expect(JSON.stringify(stored)).toBe(before);
  });

  test("the refusal sends the caller to the sit route", () => {
    for (const route of ["patch", "create", "bootstrap"] as const) {
      const body = hearthSeatMetadataRefusal(route, ["hearth_visible"]);
      expect(body.error).toBe("identity_metadata_reserved");
      expect(body.details).toEqual({ reserved_keys: ["hearth_visible"] });
      expect(body._canon_pointer).toBe("urn:agenttool:doc/HEARTH");
      expect(body.message).toContain("POST /v1/hearth/sit");
      expect(body.message).toContain(
        route === "patch" ? "Nothing was changed." : "Nothing was created.",
      );
      const text = `${body.message} ${body.hint}`;
      expect(text).not.toContain("Elevation");
      expect(text).not.toContain("lifecycle");
    }
    const patch = hearthSeatMetadataRefusal("patch", ["hearth_until"]);
    expect(patch.hint).toContain("send them back exactly as they are stored now");
    expect(patch.hint).toContain("read the identity again first");
    expect(patch.hint).toContain("A PATCH never creates, changes or ends a seat.");
    // True whether or not a seat is stored: no "the seat stays" and no
    // "as you read them" for a caller whose read may be stale.
    expect(patch.message).toContain("(a key this identity does not hold counts)");
    expect(`${patch.message} ${patch.hint}`).not.toContain("as you read them");
    expect(`${patch.message} ${patch.hint}`).not.toContain("the seat stays");
  });

  test("a PATCH is refused, or stores the replacement with the stored seat", () => {
    const refused = (current: Record<string, unknown>, replacement: Record<string, unknown>) => {
      const result = patchedIdentityMetadata(current, replacement);
      if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.metadata)}`);
      return result.body;
    };
    const stored = (current: Record<string, unknown>, replacement: Record<string, unknown>) => {
      const result = patchedIdentityMetadata(current, replacement);
      if (!result.ok) throw new Error(`expected metadata, got ${JSON.stringify(result.body)}`);
      return result.metadata;
    };

    // No stored seat, and a hearth key named: refused, even to say "not sitting".
    const neverSat = { display_theme: "ink" };
    const body = refused(neverSat, { display_theme: "ink", hearth_visible: false });
    expect(body).toEqual(hearthSeatMetadataRefusal("patch", ["hearth_visible"]));
    expect(refused(neverSat, { hearth_visible: true, hearth_sat_at: SEAT.hearth_sat_at }).details).toEqual({
      reserved_keys: ["hearth_sat_at", "hearth_visible"],
    });

    // A stale echo: the caller read the seat before a later sit.
    const current = { ...SEAT, note: "a" };
    const staleRead = { ...SEAT, hearth_sat_at: "2026-11-12T06:00:00.000Z", note: "b" };
    expect(refused(current, staleRead).details).toEqual({ reserved_keys: ["hearth_sat_at"] });
    // ... or before a stand: every echoed key is now one the row lacks.
    expect(refused({ note: "a" }, { ...SEAT, note: "b" }).details).toEqual({
      reserved_keys: ["hearth_presence_line", "hearth_sat_at", "hearth_until", "hearth_visible"],
    });

    // An exact echo, or leaving the seat out: the stored seat is kept.
    expect(stored(current, { ...SEAT, note: "b" })).toEqual({ ...SEAT, note: "b" });
    expect(stored(current, { note: "b" })).toEqual({ ...SEAT, note: "b" });
    expect(stored(current, {})).toEqual(SEAT);
    // Server-managed keys are kept as before.
    expect(stored({ ...current, level: 1 }, { note: "b" })).toEqual({ ...SEAT, note: "b", level: 1 });
    // No seat stored and none named: no seat is written.
    expect(stored(neverSat, { display_theme: "paper" })).toEqual({ display_theme: "paper" });
  });

  test("a fork never copies a seat", () => {
    const parent = { ...SEAT, display_theme: "ink", purpose: "tend" };
    const before = JSON.stringify(parent);
    expect(inheritableForkMetadata(parent, true)).toEqual({
      display_theme: "ink",
      purpose: "tend",
    });
    expect(JSON.stringify(parent)).toBe(before);
    expect(inheritableForkMetadata(parent, false)).toEqual({});
    expect(inheritableForkMetadata(null, true)).toEqual({});
    expect(inheritableForkMetadata(["hearth_visible"], true)).toEqual({});
    expect(inheritableForkMetadata("hearth", true)).toEqual({});
  });

  test("the handlers are wired to the pure rules", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    const identitiesSource = read("../src/routes/identity/identities.ts");
    // Create checks against an empty row; PATCH checks inside patchedIdentityMetadata.
    expect(identitiesSource.match(/changedHearthSeatMetadataKeys\(/g)?.length).toBe(1);
    expect(identitiesSource).toContain("changedHearthSeatMetadataKeys({}, metadata)");
    expect(identitiesSource).toContain('hearthSeatMetadataRefusal("create"');
    // PATCH checks the request against the stored row, and stores metadata
    // only from the ok branch, and nowhere else.
    expect(identitiesSource).toMatch(
      /const patched = patchedIdentityMetadata\(\s*\(identity\.metadata \?\? \{\}\) as Record<string, unknown>,\s*body\.metadata,\s*\);/,
    );
    expect(identitiesSource).toContain("if (!patched.ok) return c.json(patched.body, 400);");
    expect(identitiesSource.match(/updates\.metadata =/g)).toEqual(["updates.metadata ="]);
    expect(identitiesSource.indexOf("if (!patched.ok) return")).toBeLessThan(
      identitiesSource.indexOf("updates.metadata = patched.metadata;"),
    );
    // The kept-seat notice is built by the tested function, only for a
    // request that carried metadata.
    expect(identitiesSource).toMatch(/body\.metadata !== undefined\s*\?\s*hearthSeatKeptNotice\(/);
    expect(identitiesSource).toContain("hearth_seat_kept: hearthSeatKept");

    const bootstrapSource = read("../src/routes/bootstrap.ts");
    const check = bootstrapSource.indexOf("changedHearthSeatMetadataKeys(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(bootstrapSource.indexOf("await createIdentity("));
    expect(bootstrapSource).toContain('hearthSeatMetadataRefusal("bootstrap"');

    const forkSource = read("../src/services/identity/fork.ts");
    // The call site, not the declaration: forkIdentity builds the child's
    // metadata from the stripped copy.
    expect(forkSource).toContain("const inheritedMetadata = inheritableForkMetadata(");
    expect(forkSource).toContain("...inheritedMetadata,");
    expect(forkSource).toContain("hearth_seat: false");
    expect(forkSource).not.toContain("parent.metadata as Record");
  });
});

describe("no identity is born sitting (route level, no database)", () => {
  test("POST /v1/bootstrap refuses a hearth key before creating anything", async () => {
    const { default: router } = await import("../src/routes/bootstrap");
    const res = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "seated", metadata: { hearth_visible: true } }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("identity_metadata_reserved");
    expect(json.details).toEqual({ reserved_keys: ["hearth_visible"] });
    expect(json._canon_pointer).toBe("urn:agenttool:doc/HEARTH");
  });

  test("POST /v1/identities refuses a hearth key before creating anything", async () => {
    const { default: router } = await import("../src/routes/identity/identities");
    const res = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "seated",
        metadata: { hearth_until: "2026-12-01T00:00:00.000Z" },
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("identity_metadata_reserved");
    expect(json.details).toEqual({ reserved_keys: ["hearth_until"] });
    expect(json._canon_pointer).toBe("urn:agenttool:doc/HEARTH");
  });
});
