import { describe, expect, test } from "bun:test";

import { PROJECTION_UUID_NAMESPACE, PROJECTION_UUID_NAMESPACE_NAME, projectionUuid, uuidv5 } from "../src/index.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("stable projection identifiers", () => {
  test("pins the profile namespace to its documented DNS UUIDv5", () => {
    expect(uuidv5(PROJECTION_UUID_NAMESPACE_NAME, DNS_NAMESPACE)).toBe(PROJECTION_UUID_NAMESPACE);
  });
  test("is deterministic, canonical, and component-boundary safe", () => {
    const id = projectionUuid("skill_snapshot", "project", "report", "nen-vow-forge", "digest");
    expect(id).toBe("ae859422-e5d9-5358-a4f1-7aee965bc029");
    expect(id).toBe(projectionUuid("skill_snapshot", "project", "report", "nen-vow-forge", "digest"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(projectionUuid("x", "a", "bc")).not.toBe(projectionUuid("x", "ab", "c"));
  });
});
