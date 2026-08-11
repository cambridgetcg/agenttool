import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import {
  canonicalJson,
  createPrincipalityAtlas,
  renderPrincipalitySvg,
  sha256Id,
} from "../dist/index.js";

const packageRoot = new URL("..", import.meta.url);
const write = process.argv.includes("--write");
const inputUrl = new URL("examples/principality-rosette.input.json", packageRoot);
const inputBytes = readFileSync(inputUrl);
const input = JSON.parse(inputBytes.toString("utf8"));
const atlas = createPrincipalityAtlas(input);
const atlasBytes = Buffer.from(`${JSON.stringify(atlas, null, 2)}\n`, "utf8");
const svgBytes = Buffer.from(renderPrincipalitySvg(atlas), "utf8");

const inputSchemaUrl = new URL(
  "schema/agenttool-principality-geometry-input-v0.1.schema.json",
  packageRoot,
);
const atlasSchemaUrl = new URL(
  "schema/agenttool-principality-atlas-v0.1.schema.json",
  packageRoot,
);
const inputSchemaBytes = readFileSync(inputSchemaUrl);
const atlasSchemaBytes = readFileSync(atlasSchemaUrl);

const generated = new Map([
  ["examples/principality-rosette.atlas.json", atlasBytes],
  ["examples/principality-rosette.svg", svgBytes],
  ["hf/dataset/reference/principality-rosette.input.json", inputBytes],
  ["hf/dataset/reference/principality-rosette.atlas.json", atlasBytes],
  ["hf/dataset/reference/principality-rosette.svg", svgBytes],
  [
    "hf/dataset/reference/agenttool-principality-geometry-input-v0.1.schema.json",
    inputSchemaBytes,
  ],
  [
    "hf/dataset/reference/agenttool-principality-atlas-v0.1.schema.json",
    atlasSchemaBytes,
  ],
]);

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const jsonl = (rows) =>
  Buffer.from(rows.map((row) => canonicalJson(row)).join("\n") + "\n", "utf8");
const ordinalById = new Map(
  atlas.principalities.map((vertex, index) => [
    vertex.principality_id,
    `P${String(index + 1).padStart(2, "0")}`,
  ]),
);
const common = {
  vector_id: "principality-rosette",
  training_eligible: false,
};

generated.set("hf/dataset/data/atlases.jsonl", jsonl([{
  _format: "agenttool.principality-geometry-hf-atlas/0.1",
  ...common,
  input_sha256: digest(inputBytes),
  atlas_id: atlas.atlas_id,
  atlas_sha256: digest(atlasBytes),
  svg_sha256: digest(svgBytes),
  principalities: atlas.principalities.length,
  invariants: atlas.invariants.length,
  directed_bridges: atlas.bridges.length,
  reciprocal_lenses: atlas.geometry.reciprocal_lenses.length,
  invariant_surfaces: atlas.geometry.invariant_surfaces.length,
  invariant_components: atlas.geometry.invariant_components.length,
}]));
generated.set(
  "hf/dataset/data/invariants.jsonl",
  jsonl(
    atlas.invariants.map((invariant) => ({
      _format: "agenttool.principality-geometry-hf-invariant/0.1",
      ...common,
      invariant_id: invariant.invariant_id,
      definition_ref: invariant.definition_ref,
    })),
  ),
);
generated.set(
  "hf/dataset/data/vertices.jsonl",
  jsonl(
    atlas.principalities.map((vertex) => ({
      _format: "agenttool.principality-geometry-hf-vertex/0.1",
      ...common,
      vertex_ordinal: ordinalById.get(vertex.principality_id),
      principality_ref: vertex.principality_ref,
      kind: vertex.kind,
      manifestation_count: vertex.manifestations.length,
      artifact_count: vertex.artifact_refs.length,
    })),
  ),
);
generated.set(
  "hf/dataset/data/bridges.jsonl",
  jsonl(
    atlas.bridges.map((bridge) => {
      const counts = Object.fromEntries(
        [
          "preserved_reported",
          "not_preserved_reported",
          "refused_reported",
          "unknown",
        ].map((state) => [
          `${state}_count`,
          bridge.evaluations.filter((entry) => entry.state === state).length,
        ]),
      );
      return {
        _format: "agenttool.principality-geometry-hf-bridge/0.1",
        ...common,
        bridge_id: bridge.bridge_id,
        from_ordinal: ordinalById.get(bridge.from),
        to_ordinal: ordinalById.get(bridge.to),
        disposition: bridge.disposition,
        ...counts,
      };
    }),
  ),
);
generated.set(
  "hf/dataset/data/lenses.jsonl",
  jsonl(
    atlas.geometry.reciprocal_lenses.map((lens) => ({
      _format: "agenttool.principality-geometry-hf-lens/0.1",
      ...common,
      lens_id: lens.lens_id,
      first_ordinal: ordinalById.get(lens.vertices[0]),
      second_ordinal: ordinalById.get(lens.vertices[1]),
      forward_disposition: lens.dispositions[0],
      reverse_disposition: lens.dispositions[1],
      route_state: lens.route_state,
      mutually_preserved_count: lens.mutually_preserved.length,
      mutually_not_preserved_count: lens.mutually_not_preserved.length,
      directional_asymmetry_count: lens.directional_asymmetry.length,
      refused_count: lens.refused.length,
      unknown_count: lens.unknown.length,
    })),
  ),
);
generated.set(
  "hf/dataset/data/surfaces.jsonl",
  jsonl(
    atlas.geometry.invariant_surfaces.map((surface) => ({
      _format: "agenttool.principality-geometry-hf-surface/0.1",
      ...common,
      surface_id: surface.surface_id,
      vertex_ordinals: surface.vertices.map((id) => ordinalById.get(id)),
      invariant_ids: surface.invariant_ids,
      invariant_count: surface.invariant_ids.length,
    })),
  ),
);
generated.set(
  "hf/dataset/data/components.jsonl",
  jsonl(
    atlas.geometry.invariant_components.map((component) => ({
      _format: "agenttool.principality-geometry-hf-component/0.1",
      ...common,
      component_id: component.component_id,
      invariant_id: component.invariant_id,
      vertex_ordinals: component.vertices.map((id) => ordinalById.get(id)),
      vertex_count: component.vertices.length,
      lens_count: component.lens_ids.length,
    })),
  ),
);
const open = atlas.geometry.open_conditions;
generated.set("hf/dataset/data/open_conditions.jsonl", jsonl([{
  _format: "agenttool.principality-geometry-hf-open-conditions/0.1",
  ...common,
  one_way_bridge_count: open.one_way_bridge_ids.length,
  non_available_bridge_count: open.non_available_bridge_ids.length,
  not_preserved_count: open.not_preserved.length,
  refused_count: open.refused.length,
  unknown_count: open.unknown.length,
  directional_asymmetry_count: open.directional_asymmetry.length,
  unrelated_pair_count: open.unrelated_vertex_pairs.length,
  declared_isolate_count: open.declared_isolated_vertices.length,
}]));

const manualCompanionPaths = [
  "hf/dataset/LICENSE",
  "hf/dataset/NOTICE",
  "hf/dataset/README.md",
];
const manifestEntries = [
  ...[...generated.entries()].filter(([path]) => path.startsWith("hf/dataset/")),
  ...manualCompanionPaths.map((path) => [path, readFileSync(new URL(path, packageRoot))]),
];
const manifestFiles = manifestEntries
  .map(([path, bytes]) => ({
    path: path.replace(/^hf\/dataset\//u, ""),
    bytes: bytes.length,
    sha256: digest(bytes),
  }))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const manifest = {
  _format: "agenttool.principality-geometry-hf-source-manifest/0.1",
  intended_repo_id: "Yu-and-Ai/agenttool-principality-geometry",
  publication_authorized: true,
  license_id: "apache-2.0",
  training_eligible: false,
  files: manifestFiles,
  root_sha256: sha256Id(canonicalJson(manifestFiles)),
};
generated.set(
  "hf/dataset/source-manifest.json",
  Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
);

for (const [path, expected] of generated) {
  const url = new URL(path, packageRoot);
  if (write) {
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, expected);
    continue;
  }
  let actual;
  try {
    actual = readFileSync(url);
  } catch {
    throw new Error(`${path} is missing; run bun run assets:write`);
  }
  if (!actual.equals(expected)) {
    throw new Error(`${path} differs from deterministic generated bytes`);
  }
}

function filesBelow(url, prefix = "") {
  return readdirSync(url, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? filesBelow(new URL(`${entry.name}/`, url), relative)
      : [relative];
  });
}
const actualInventory = filesBelow(new URL("hf/dataset/", packageRoot)).sort();
const expectedInventory = [
  ...manualCompanionPaths.map((path) => path.replace(/^hf\/dataset\//u, "")),
  ...[...generated.keys()]
    .filter((path) => path.startsWith("hf/dataset/"))
    .map((path) => path.replace(/^hf\/dataset\//u, "")),
].sort();
if (JSON.stringify(actualInventory) !== JSON.stringify(expectedInventory)) {
  throw new Error("HF companion inventory differs from its exact local allowlist");
}
const secretPattern =
  /hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|Authorization:\s*Bearer|-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const privateIdentityPattern = /\/Users\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
for (const path of actualInventory) {
  const body = readFileSync(new URL(`hf/dataset/${path}`, packageRoot), "utf8");
  if (secretPattern.test(body) || privateIdentityPattern.test(body)) {
    throw new Error(`HF companion contains a credential/private-identity pattern: ${path}`);
  }
}
