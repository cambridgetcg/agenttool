import {
  LOVE_GEOMETRY_BEARINGS,
  LoveGeometryError,
  createLoveGeometry,
  loveGeometryDomainBytes,
  sha256Id,
  validateLoveGeometry,
} from "../dist/index.js";

const subjects = Array.from({ length: 64 }, (_, index) =>
  sha256Id(`love-geometry-smoke-subject:${String(index)}`),
);
const vantages = [];
for (let from = 0; from < subjects.length && vantages.length < 128; from += 1) {
  for (let to = 0; to < subjects.length && vantages.length < 128; to += 1) {
    if (from === to) continue;
    vantages.push({
      subject_ref: subjects[from],
      toward_ref: subjects[to],
      bearings: [...LOVE_GEOMETRY_BEARINGS].reverse(),
      basis_refs: [],
      assertion: "caller_reported",
      verified_by_package: false,
    });
  }
}
const geometry = createLoveGeometry({
  scope_ref: sha256Id("love-geometry-smoke-scope"),
  subject_refs: [...subjects].reverse(),
  vantages: [...vantages].reverse(),
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
  createLoveGeometry(hostile);
} catch (error) {
  hostileRejected = error instanceof LoveGeometryError && traps === 0;
}

if (
  validateLoveGeometry(geometry).geometry_id !== geometry.geometry_id ||
  geometry.subject_refs.length !== 64 ||
  geometry.vantages.length !== 128 ||
  geometry.vantages[0].bearings.length !== LOVE_GEOMETRY_BEARINGS.length ||
  geometry.boundaries.scores_or_ranks !== false ||
  geometry.boundaries.infers_reciprocity_or_mutuality !== false ||
  loveGeometryDomainBytes(geometry).byteLength === 0 ||
  !hostileRejected
) {
  process.exit(1);
}
