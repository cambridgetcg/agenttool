import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import {
  PIN_ID_DOMAIN,
  REVIEWED_TLS_QUEST_NORMATIVE_DIGEST,
  REVIEWED_TREE_NORMATIVE_DIGEST,
  TLS_QUEST_ID,
} from "../src/constants.js";
import { domainSeparatedId } from "../src/canonical.js";
import { assertReviewedPin, inspectTreeBytes } from "../src/tree.js";
import { makePin } from "./helpers.js";

const TREE_BYTES = gunzipSync(Buffer.from(
  readFileSync(
    new URL(
      "./fixtures/constructive-intelligence-tree.v1.json.gz.base64",
      import.meta.url,
    ),
    "utf8",
  ).trim(),
  "base64",
));

test("pins the exact reviewed tree and TLS quest projections", () => {
  const inspected = inspectTreeBytes(TREE_BYTES, TLS_QUEST_ID, "2026-07-30");
  expect(inspected.tree_normative_digest).toBe(REVIEWED_TREE_NORMATIVE_DIGEST);
  expect(inspected.quest_normative_digest).toBe(REVIEWED_TLS_QUEST_NORMATIVE_DIGEST);
  expect(inspected.raw_digest)
    .toBe("sha256:8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf");
});

test("fails closed after reviewAfter", () => {
  expect(() => inspectTreeBytes(TREE_BYTES, TLS_QUEST_ID, "2026-08-29"))
    .toThrow(/outside.*reviewed status window/);
});

test("rejects a changed normative tree", () => {
  const source = TREE_BYTES.toString("utf8");
  const changed = source.replace(
    "Turn the RFC 8446 to RFC 9846 directional KeyShare",
    "Change the RFC 8446 to RFC 9846 directional KeyShare",
  );
  expect(() => inspectTreeBytes(Buffer.from(changed), TLS_QUEST_ID, "2026-07-30"))
    .toThrow(/raw-byte digest|normative digest/);
});

test("anchors exact RFC specification strings in stored pins", () => {
  const changed = structuredClone(makePin());
  const first = changed.standards[0];
  if (!first) throw new Error("test pin standard missing");
  first.specification = "https://example.invalid/rfc8446";
  const { pin_id: _oldId, ...core } = changed;
  changed.pin_id = domainSeparatedId(PIN_ID_DOMAIN, core);
  expect(() => assertReviewedPin(changed)).toThrow(/reviewed standard window/);
});
