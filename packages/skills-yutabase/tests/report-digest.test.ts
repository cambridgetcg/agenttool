import { describe, expect, test } from "bun:test";

import {
  REPORT_DIGEST_SEMANTICS,
  skillsInspectionReportDigestFromCanonicalBytes,
} from "../src/index.js";

describe("inspection report digest contract", () => {
  test("pins the semantics identifier and exact UTF-8 byte vector", () => {
    const canonical = '{\n  "a": 1,\n  "z": "Nen"\n}\n';
    expect(REPORT_DIGEST_SEMANTICS).toBe(
      "agenttool.skills/report-stable-json-sha256-v1",
    );
    expect(skillsInspectionReportDigestFromCanonicalBytes(canonical)).toBe(
      "sha256:97720717c3a9179f4d0619497285e79938220d835a326ad6fbe7de55f20f9c86",
    );
  });

  test("hashes bytes only and does not normalize alternate serialization", () => {
    const canonical = '{\n  "a": 1\n}\n';
    const compact = '{"a":1}\n';
    expect(skillsInspectionReportDigestFromCanonicalBytes(canonical)).not.toBe(
      skillsInspectionReportDigestFromCanonicalBytes(compact),
    );
  });
});
