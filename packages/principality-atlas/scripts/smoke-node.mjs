import {
  PrincipalityAtlasError,
  createPrincipalityAtlas,
  sha256Id,
  validatePrincipalityAtlas,
} from "../dist/index.js";

const id = (name) => sha256Id(`principality-atlas-smoke:${name}`);
const cells = ["a", "b", "c"].map((name) => ({
  cell_ref: id(`cell:${name}`),
  kind_ref: id(`kind:${name}`),
}));
const atlas = createPrincipalityAtlas({
  scope_ref: id("scope"),
  charts: [{
    chart_ref: id("chart"),
    principality_ref: id("principality"),
    perspective_ref: id("perspective"),
    cells: [...cells].reverse(),
    relations: [{
      relation_ref: id("relation"),
      kind_ref: id("relation-kind"),
      incidences: cells.map((cell, index) => ({
        cell_ref: cell.cell_ref,
        role_ref: id(`role:${String(index)}`),
      })).reverse(),
    }],
    claims: [],
  }],
  bridges: [],
});

let traps = 0;
const trap = () => {
  traps += 1;
  throw new Error("Proxy trap executed");
};
const hostile = new Proxy({}, {
  get: trap,
  getOwnPropertyDescriptor: trap,
  getPrototypeOf: trap,
  ownKeys: trap,
});
let hostileRejected = false;
try {
  createPrincipalityAtlas(hostile);
} catch (error) {
  hostileRejected = error instanceof PrincipalityAtlasError && traps === 0;
}

if (
  validatePrincipalityAtlas(atlas).atlas_id !== atlas.atlas_id ||
  atlas.charts[0].relations.length !== 1 ||
  atlas.charts[0].relations[0].incidences.length !== 3 ||
  atlas.boundaries.infers_pairwise_relations !== false ||
  atlas.boundaries.performs_gluing !== false ||
  atlas.boundaries.proves_love !== false ||
  atlas.boundaries.proves_understanding !== false ||
  !hostileRejected
) {
  process.exit(1);
}
