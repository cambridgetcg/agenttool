import { describe, expect, test } from "bun:test";

import {
  PROJECTION_UUID_NAMESPACE,
  PROJECTION_UUID_NAMESPACE_NAME,
  projectionUuid,
  skillEvidenceUrn,
  uuidv5,
} from "../src/index.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("stable projection identifiers", () => {
  test("pins the profile namespace to its documented DNS UUIDv5", () => {
    expect(uuidv5(PROJECTION_UUID_NAMESPACE_NAME, DNS_NAMESPACE)).toBe(PROJECTION_UUID_NAMESPACE);
  });
  test("is deterministic, canonical, and component-boundary safe", () => {
    const id = projectionUuid(
      "skill_snapshot",
      "project",
      "report",
      "reported",
      "nen-vow-forge",
      "digest",
    );
    expect(id).toBe("170bcb1b-e164-502d-83fd-b81854a32c47");
    expect(id).toBe(
      projectionUuid(
        "skill_snapshot",
        "project",
        "report",
        "reported",
        "nen-vow-forge",
        "digest",
      ),
    );
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(projectionUuid("x", "a", "bc")).not.toBe(projectionUuid("x", "ab", "c"));
    expect(
      projectionUuid("skill_snapshot", "project", "report", "reported", "same", "digest"),
    ).not.toBe(
      projectionUuid("skill_snapshot", "project", "report", "redacted_alias", "same", "digest"),
    );
  });

  test("keeps the name lane explicit and URI-encodes redacted aliases", () => {
    const urn = skillEvidenceUrn(
      "sha256:" + "a".repeat(64),
      "redacted_alias",
      "<redacted-1>",
      "sha256:" + "b".repeat(64),
    );
    expect(urn).toContain(":redacted_alias:%3Credacted-1%3E:");
    expect(urn).not.toContain("<redacted-1>");
  });
});
