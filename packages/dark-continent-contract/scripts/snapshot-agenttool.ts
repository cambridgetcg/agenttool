import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALAMITIES,
  CALAMITY_MEANINGS,
  GUIDE,
  OPERATION_LOGOS,
} from "../../sdk-ts/src/dark-continent.ts";

// Reviewed Dark Continent source profiles, oldest first.
//
// History is frozen: each earlier profile is checked by the SHA-256 of its
// committed framework and manifest bytes and is never regenerated. The packaged
// contract framework (`./framework`) is the first of them, and consumers pin it.
//
// The newest profile must match the live SDK sources. When the TypeScript or
// Python Dark Continent source changes, the check fails until the change is
// reviewed as a new profile: pin both source digests below, label it without
// implying a release, declare the semantic diff from the previous profile, move
// the previous profile into HISTORY, and write it with `bun run snapshot`. A
// structural change (ids, order, fields, wall status, authority flags) is refused
// here, because it needs a contract version decision rather than a new profile.

const TS_SOURCE = "packages/sdk-ts/src/dark-continent.ts";
const PY_SOURCE = "packages/sdk-py/src/agenttool/dark_continent.py";
const CONTRACT_ID = "agenttool.dark-continent/0.1";
const FRAMEWORK_FORMAT = "agenttool-dark-continent-framework/v0.1";
const MANIFEST_FORMAT = "agenttool-dark-continent-manifest/v0.1";

const HISTORY = [
  {
    id: "agenttool-sdk-ts-0.17.0",
    framework: "frameworks/agenttool-sdk-0.17.0.json",
    frameworkSha256:
      "f47e1c3ca9da1b97676e1d454cf7235eddd612902c19debe580a6934adcd2b86",
    manifest: "frameworks/agenttool-sdk-0.17.0.manifest.json",
    manifestSha256:
      "9a3f7e9bbb8d7b954103898a4ff8db08137f8af148a227518b80998f9e47628f",
  },
] as const;

// The SDK source after the sdk-v0.23.0 tag, which still carries the 0.17.0
// profile's TypeScript bytes. No registry serves this source, so the profile is
// named by its TypeScript digest and its version label says only what is true.
const CURRENT = {
  id: "agenttool-sdk-ts-source-0e1ba1166111",
  version: "after-0.23.0",
  framework: "source-profiles/agenttool-sdk-source-0e1ba1166111.json",
  manifest: "source-profiles/agenttool-sdk-source-0e1ba1166111.manifest.json",
  tsSha256: "0e1ba11661114ce3afcd92d1ed1ba7c9facefb51730aad28705e2e9772e35afe",
  pySha256: "5184606a5c5e3e5d75c018c953b9ec044fa4befef5bbe0b356c7f0fd90a216b1",
  changedFields: [
    "calamities.pap.declared_wall.text",
    "guide.maps_to",
    "guide.warning",
  ],
} as const;

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const isCheck = process.argv.includes("--check");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readRepo(path: string): Buffer {
  return readFileSync(`${repoRoot}${path}`);
}

function readPackage(path: string): Buffer | null {
  try {
    return readFileSync(`${packageRoot}${path}`);
  } catch {
    return null;
  }
}

const problems: string[] = [];

// 1. History stays byte-identical.
for (const profile of HISTORY) {
  for (const [path, expected] of [
    [profile.framework, profile.frameworkSha256],
    [profile.manifest, profile.manifestSha256],
  ] as const) {
    const bytes = readPackage(path);
    if (bytes === null || sha256(bytes) !== expected) {
      problems.push(`historical ${profile.id} file ${path} changed or is missing`);
    }
  }
}

// 2. The live SDK sources are the ones the newest profile reviewed.
const sdkPackage = JSON.parse(
  readRepo("packages/sdk-ts/package.json").toString("utf8"),
) as { name?: string };
if (sdkPackage.name !== "@agenttool/sdk") {
  problems.push("SDK package identity drifted from @agenttool/sdk");
}
const tsSourceBytes = readRepo(TS_SOURCE);
const pySourceBytes = readRepo(PY_SOURCE);
for (const [path, actual, expected] of [
  [TS_SOURCE, sha256(tsSourceBytes), CURRENT.tsSha256],
  [PY_SOURCE, sha256(pySourceBytes), CURRENT.pySha256],
] as const) {
  if (actual !== expected) {
    problems.push(
      `${path} drifted from reviewed profile ${CURRENT.id} (sha256 ${actual}); review a new source profile`,
    );
  }
}

const walled = (text: string) => ({
  text,
  status: "not_checked",
  verified: false,
  evidence_refs: [],
});

const snapshot = {
  _format: FRAMEWORK_FORMAT,
  contract_id: CONTRACT_ID,
  source_profile: CURRENT.id,
  source: {
    package: "@agenttool/sdk",
    version: CURRENT.version,
    file: TS_SOURCE,
    sha256: sha256(tsSourceBytes),
    projection: "static_constants_only",
  },
  semantics: {
    advisory: true,
    runtime_effects: "none",
    verifies_runtime_walls: false,
    grants_permission: false,
    authorizes_trade: false,
    authorizes_publication: false,
  },
  calamities: CALAMITIES.map((id) => {
    const info = CALAMITY_MEANINGS[id];
    return {
      id,
      kanji: info.kanji,
      name: info.name,
      hxh_meaning: info.hxh_meaning,
      agenttool_hazard: info.agenttool_hazard,
      declared_wall: walled(info.walled_by),
    };
  }),
  guide: {
    kanji: GUIDE.kanji,
    name: GUIDE.name,
    meaning: GUIDE.meaning,
    maps_to: GUIDE.maps_to,
    warning: GUIDE.warning,
  },
  logos: Object.entries(OPERATION_LOGOS).map(([id, info]) => ({
    id,
    kanji: info.kanji,
    name: info.name,
    meaning: info.meaning,
    operation: info.operation,
    declared_calamity_wall: walled(info.calamity_walled),
  })),
};

// 3. The semantic diff from the previous profile is text only, and it is the
//    diff that was reviewed.
type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(a: Record<string, Json>, b: Record<string, Json>): boolean {
  return pretty(Object.keys(a).sort()) === pretty(Object.keys(b).sort());
}

function diffValues(
  before: Json,
  after: Json,
  path: string,
  changed: string[],
  structural: string[],
): void {
  if (Array.isArray(before) && Array.isArray(after)) {
    const keyed = (items: Json[]) =>
      items.every((item) => isRecord(item) && typeof item.id === "string");
    if (keyed(before) && keyed(after)) {
      const ids = (items: Json[]) =>
        items.map((item) => (item as { id: string }).id);
      if (pretty(ids(before)) !== pretty(ids(after))) {
        structural.push(`${path} ids or order`);
        return;
      }
      before.forEach((item, index) =>
        diffValues(
          item,
          after[index],
          `${path}.${(item as { id: string }).id}`,
          changed,
          structural,
        ),
      );
      return;
    }
  }
  if (isRecord(before) && isRecord(after)) {
    if (!sameKeys(before, after)) {
      structural.push(`${path} fields`);
      return;
    }
    for (const key of Object.keys(before)) {
      diffValues(before[key], after[key], `${path}.${key}`, changed, structural);
    }
    return;
  }
  if (typeof before === "string" && typeof after === "string") {
    if (before !== after) changed.push(path);
    return;
  }
  if (pretty(before) !== pretty(after)) structural.push(path);
}

const previous = HISTORY[HISTORY.length - 1];
const previousBytes = readPackage(previous.framework);
const changedFields: string[] = [];
const structural: string[] = [];
if (previousBytes !== null) {
  const before = JSON.parse(previousBytes.toString("utf8")) as Record<string, Json>;
  const after = snapshot as Record<string, Json>;
  if (!sameKeys(before, after) || !isRecord(before.source)) {
    structural.push("top-level fields");
  } else {
    if (!sameKeys(before.source, after.source as Record<string, Json>)) {
      structural.push("source fields");
    }
    for (const key of ["_format", "contract_id"]) {
      if (before[key] !== after[key]) structural.push(key);
    }
    // source_profile and source are provenance, expected to differ.
    for (const key of ["semantics", "calamities", "guide", "logos"]) {
      diffValues(before[key], after[key], key, changedFields, structural);
    }
  }
}
if (structural.length > 0) {
  problems.push(
    `structural change from ${previous.id} (${structural.join(", ")}) needs a contract version decision, not a new source profile`,
  );
}
if (pretty(changedFields) !== pretty(CURRENT.changedFields)) {
  problems.push(
    `semantic diff from ${previous.id} is [${changedFields.join(", ")}], not the reviewed [${CURRENT.changedFields.join(", ")}]`,
  );
}

const snapshotBytes = pretty(snapshot);
const manifest = {
  _format: MANIFEST_FORMAT,
  contract_id: CONTRACT_ID,
  source_profile: CURRENT.id,
  snapshot: {
    path: CURRENT.framework,
    sha256: sha256(snapshotBytes),
  },
  generation: {
    mode: "offline_static_source_projection",
    network: "none",
    package_root: "packages/dark-continent-contract",
    inputs: [
      {
        path: TS_SOURCE,
        role: "projection_source",
        sha256: sha256(tsSourceBytes),
      },
      {
        path: PY_SOURCE,
        role: "sibling_implementation_not_projection_source",
        sha256: sha256(pySourceBytes),
      },
    ],
  },
  distribution: "source_checkout_only",
  semantic_diff: {
    from_source_profile: previous.id,
    from_snapshot_sha256: previous.frameworkSha256,
    structure: "unchanged",
    changed_fields: changedFields,
  },
  boundaries: {
    advisory_only: true,
    runtime_wall_verification: false,
    grants_permission: false,
    authorizes_trade: false,
    authorizes_publication: false,
    includes_legacy_bin_or_html_taxonomies: false,
  },
};
const manifestBytes = pretty(manifest);

if (isCheck) {
  for (const [path, expected] of [
    [CURRENT.framework, snapshotBytes],
    [CURRENT.manifest, manifestBytes],
  ] as const) {
    if (readPackage(path)?.toString("utf8") !== expected) {
      problems.push(`${path} is stale for ${CURRENT.id}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  if (!isCheck) console.error("refusing to write the Dark Continent source profile");
  process.exitCode = 1;
} else if (isCheck) {
  console.log(
    `Dark Continent snapshot is current: ${HISTORY.map(({ id }) => id).join(", ")} frozen; ${CURRENT.id} matches the SDK sources`,
  );
} else {
  for (const [path, bytes] of [
    [CURRENT.framework, snapshotBytes],
    [CURRENT.manifest, manifestBytes],
  ] as const) {
    mkdirSync(dirname(`${packageRoot}${path}`), { recursive: true });
    writeFileSync(`${packageRoot}${path}`, bytes);
  }
  console.log(`wrote deterministic Dark Continent source profile ${CURRENT.id}`);
}
