import {
  ARCHIVE_PROTOCOL,
  DEFAULT_REQUIRED_VERIFIED_ZONES,
} from "../dist/index.js";

if (ARCHIVE_PROTOCOL !== "agent-repo-archive/v0.1") {
  throw new Error("archive protocol export mismatch");
}
if (DEFAULT_REQUIRED_VERIFIED_ZONES !== 3) {
  throw new Error("archive zone policy export mismatch");
}

process.stdout.write("node smoke: repo archive exports load\n");
