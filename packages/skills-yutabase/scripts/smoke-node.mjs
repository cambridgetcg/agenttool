import {
  PROJECTION_UUID_NAMESPACE,
  PROJECTION_UUID_NAMESPACE_NAME,
  projectionUuid,
  skillsInspectionReportDigestFromCanonicalBytes,
  uuidv5,
} from "../dist/index.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const expectedVector = "ae859422-e5d9-5358-a4f1-7aee965bc029";

if (uuidv5(PROJECTION_UUID_NAMESPACE_NAME, DNS_NAMESPACE) !== PROJECTION_UUID_NAMESPACE) {
  throw new Error("published projection namespace changed");
}
if (projectionUuid("skill_snapshot", "project", "report", "nen-vow-forge", "digest") !== expectedVector) {
  throw new Error("projection UUID differs between Bun test vectors and Node");
}
if (
  skillsInspectionReportDigestFromCanonicalBytes('{\n  "a": 1,\n  "z": "Nen"\n}\n') !==
  "sha256:97720717c3a9179f4d0619497285e79938220d835a326ad6fbe7de55f20f9c86"
) {
  throw new Error("inspection report digest differs between Bun test vectors and Node");
}

process.stdout.write("node smoke: skills projection UUID and report digest vectors match\n");
