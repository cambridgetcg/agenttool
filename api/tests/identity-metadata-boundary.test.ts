import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  replaceCallerIdentityMetadata,
  requestedServerManagedIdentityMetadataKeys,
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
    expect(source).toContain("replaceCallerIdentityMetadata(");
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
