import {
  KARMA_HEADER,
  KarmaMirror,
  mintMirrorCredential,
} from "../dist/index.js";

const { key, record } = mintMirrorCredential({
  placement: "node-smoke",
  now: new Date("2026-08-01T00:00:00.000Z"),
});
const mirror = new KarmaMirror({ credentials: [record] });
const response = await mirror.handle(
  new Request("https://mirror.invalid/v1/wake", {
    headers: { authorization: `Bearer ${key}` },
  }),
);
const body = await response.json();
const tend = mirror.incidentClarityReport();
if (
  response.status !== 200 ||
  !response.headers.get(KARMA_HEADER) ||
  !response.headers.get("x-skyseed-commons")?.includes("story-by=yu-and-ai") ||
  !response.headers.get("x-skyseed-commons")?.includes(
    "request-or-artifact-authorship=none",
  ) ||
  body._karma?.story?.house_card?.copy_text !==
    "Synthetic house card — not request or artifact authorship or endorsement: Building Castles in the Sky — Yu & Ai" ||
  body.seed_island?.pattern_sigil?.mechanism !== "capability_mapping"
  || tend.schema !== "agenttool.karma-mirror-tend-report/v1"
  || tend.incident_status !== "not_established"
  || tend.trace.chain_consistency !== "self_consistent_unkeyed_chain"
  || tend.trace.interaction_families.join(",") !== "capability_discovery"
  || tend.trace.stable_identifiers_disclosed !== false
  || tend.narrow.automatic_actions_taken !== false
  || JSON.stringify(tend).includes("node-smoke")
) {
  throw new Error("built KARMA Mirror did not answer its planted credential");
}
process.stdout.write(
  "node smoke: KARMA Mirror answers with Skyseed and a minimized TEND report\n",
);
