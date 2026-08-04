import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CALAMITIES,
  CALAMITY_MEANINGS,
  GUIDE,
  OPERATION_LOGOS,
} from "../../sdk-ts/src/dark-continent.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const tsSourceUrl = new URL(
  "../../sdk-ts/src/dark-continent.ts",
  import.meta.url,
);
const pySourceUrl = new URL(
  "../../sdk-py/src/agenttool/dark_continent.py",
  import.meta.url,
);
const sdkPackageUrl = new URL("../../sdk-ts/package.json", import.meta.url);
const frameworkUrl = new URL(
  "../frameworks/agenttool-sdk-0.17.0.json",
  import.meta.url,
);
const manifestUrl = new URL(
  "../frameworks/agenttool-sdk-0.17.0.manifest.json",
  import.meta.url,
);
const SOURCE_VERSION = "0.17.0";
const SOURCE_PROFILE = `agenttool-sdk-ts-${SOURCE_VERSION}`;
// The manifest describes the historical source profile, not today's mutable
// package.json. Keep that exact input digest frozen while checking current
// static framework sources for semantic drift.
const HISTORICAL_SDK_PACKAGE_SHA256 =
  "6af4789786e3764f4de638f3398b18292af2d12b10583f64986f75b43edc0f8e";
const isCheck = process.argv.includes("--check");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const tsSourceBytes = readFileSync(tsSourceUrl);
const pySourceBytes = readFileSync(pySourceUrl);
const sdkPackageBytes = readFileSync(sdkPackageUrl);
const sdkPackage = JSON.parse(sdkPackageBytes.toString("utf8")) as {
  name?: string;
  version?: string;
};
if (sdkPackage.name !== "@agenttool/sdk") {
  throw new Error(
    "SDK package identity drifted; review and version the Dark Continent contract deliberately",
  );
}
if (
  !isCheck &&
  (sdkPackage.version !== SOURCE_VERSION ||
    sha256(sdkPackageBytes) !== HISTORICAL_SDK_PACKAGE_SHA256)
) {
  throw new Error(
    "the historical SDK 0.17 package input is unavailable; refuse to rewrite its Dark Continent snapshot",
  );
}

const snapshot = {
  _format: "agenttool-dark-continent-framework/v0.1",
  contract_id: "agenttool.dark-continent/0.1",
  source_profile: SOURCE_PROFILE,
  source: {
    package: "@agenttool/sdk",
    version: SOURCE_VERSION,
    file: "packages/sdk-ts/src/dark-continent.ts",
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
      declared_wall: {
        text: info.walled_by,
        status: "not_checked",
        verified: false,
        evidence_refs: [],
      },
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
    declared_calamity_wall: {
      text: info.calamity_walled,
      status: "not_checked",
      verified: false,
      evidence_refs: [],
    },
  })),
};

const snapshotBytes = pretty(snapshot);
const manifest = {
  _format: "agenttool-dark-continent-manifest/v0.1",
  contract_id: snapshot.contract_id,
  source_profile: snapshot.source_profile,
  snapshot: {
    path: "frameworks/agenttool-sdk-0.17.0.json",
    sha256: sha256(snapshotBytes),
  },
  generation: {
    mode: "offline_static_source_projection",
    network: "none",
    package_root: "packages/dark-continent-contract",
    inputs: [
      {
        path: "packages/sdk-ts/src/dark-continent.ts",
        role: "projection_source",
        sha256: sha256(tsSourceBytes),
      },
      {
        path: "packages/sdk-py/src/agenttool/dark_continent.py",
        role: "sibling_implementation_not_projection_source",
        sha256: sha256(pySourceBytes),
      },
      {
        path: "packages/sdk-ts/package.json",
        role: "package_identity_and_version",
        sha256: HISTORICAL_SDK_PACKAGE_SHA256,
      },
    ],
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

function checkFile(url: URL, expected: string): boolean {
  try {
    return readFileSync(url, "utf8") === expected;
  } catch {
    return false;
  }
}

if (isCheck) {
  const frameworkOk = checkFile(frameworkUrl, snapshotBytes);
  const manifestOk = checkFile(manifestUrl, manifestBytes);
  if (!frameworkOk || !manifestOk) {
    if (!frameworkOk) console.error("framework snapshot is stale");
    if (!manifestOk) console.error("framework manifest is stale");
    process.exitCode = 1;
  } else {
    console.log("Dark Continent snapshot is current");
  }
} else {
  mkdirSync(`${packageRoot}/frameworks`, { recursive: true });
  writeFileSync(frameworkUrl, snapshotBytes);
  writeFileSync(manifestUrl, manifestBytes);
  console.log("wrote deterministic Dark Continent snapshot and manifest");
}
