import { readFileSync } from "node:fs";

import {
  canonicalJson,
  createPrincipalityAtlas,
  encodePrincipalityAtlas,
  renderPrincipalitySvg,
  sha256Id,
} from "../dist/index.js";

const input = JSON.parse(
  readFileSync(
    new URL("../examples/principality-rosette.input.json", import.meta.url),
    "utf8",
  ),
);
const atlas = createPrincipalityAtlas(input);
const vector = {
  atlas_id: atlas.atlas_id,
  atlas_bytes_sha256: sha256Id(encodePrincipalityAtlas(atlas)),
  svg_sha256: sha256Id(renderPrincipalitySvg(atlas)),
};
process.stdout.write(`${canonicalJson(vector)}\n`);
