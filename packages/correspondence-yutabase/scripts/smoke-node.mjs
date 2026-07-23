import {
  PROJECTION_UUID_NAMESPACE,
  PROJECTION_UUID_NAMESPACE_NAME,
  projectionUuid,
  uuidv5,
} from "../dist/index.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const expectedEventId = "9483e158-353b-5c12-8aff-dc716591d381";

if (uuidv5(PROJECTION_UUID_NAMESPACE_NAME, DNS_NAMESPACE) !== PROJECTION_UUID_NAMESPACE) {
  throw new Error("published projection namespace changed");
}
if (projectionUuid("event", "sha256:" + "1".repeat(64)) !== expectedEventId) {
  throw new Error("projection UUID differs between Bun test vectors and Node");
}

process.stdout.write("node smoke: projection UUID vectors match\n");
