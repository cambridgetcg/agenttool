import {
  RelationalGeometryError,
  createRelationalComplex,
  createRelationalLens,
  sha256Id,
  validateRelationalLensAgainstComplex,
} from "../dist/index.js";

const points = Array.from({ length: 64 }, (_, index) => ({
  point_ref: sha256Id(`smoke-point:${String(index)}`),
  kind: index % 2 === 0 ? "perspective" : "unknown",
  assertion: "caller_asserted",
  verified_by_package: false,
}));
const witnesses = [];
for (let index = 0; index < 128; index += 1) {
  const from = points[index % points.length].point_ref;
  const to = points[Math.floor(index / points.length)].point_ref;
  witnesses.push({
    witness_ref: sha256Id(`smoke-understanding:${String(index)}`),
    from_ref: from,
    kind: "understanding",
    to_ref: to,
    assertion: "caller_asserted",
    verified_by_package: false,
  });
  witnesses.push({
    witness_ref: sha256Id(`smoke-recognition:${String(index)}`),
    from_ref: from,
    kind: "recognition",
    to_ref: to,
    assertion: "caller_asserted",
    verified_by_package: false,
  });
}
const complex = createRelationalComplex({ points: [...points].reverse(), witnesses: [...witnesses].reverse() });
const incident = complex.principalities.filter((cell) =>
  cell.from_ref === points[0].point_ref || cell.to_ref === points[0].point_ref,
);
const lens = createRelationalLens(complex, {
  perspective_ref: points[0].point_ref,
  selections: incident.slice(0, 4).map((cell, index) => ({
    principality_ref: cell.principality_ref,
    disposition: ["carry", "park", "release", "withdraw"][index],
  })),
});

let traps = 0;
const trap = () => { traps += 1; throw new Error("Proxy trap executed"); };
const hostile = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap });
let hostileRejected = false;
try {
  createRelationalComplex(hostile);
} catch (error) {
  hostileRejected = error instanceof RelationalGeometryError && traps === 0;
}

if (
  complex.points.length !== 64 ||
  complex.witnesses.length !== 256 ||
  complex.principalities.length !== 128 ||
  validateRelationalLensAgainstComplex(lens, complex).lens_id !== lens.lens_id ||
  lens.choice.penalty !== false ||
  lens.boundaries.geometry !== "finite_combinatorial_not_metric" ||
  !hostileRejected
) process.exit(1);

