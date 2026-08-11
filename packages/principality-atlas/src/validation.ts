import {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  PRINCIPALITY_ATLAS_CLAIM_POSTURES,
  PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES,
  PRINCIPALITY_ATLAS_LIMITS,
} from "./constants.js";
import {
  canonicalJson,
  compareUnicode,
  deepFreeze,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { fail, type PrincipalityAtlasErrorCode } from "./errors.js";
import type {
  AtlasCell,
  AtlasClaim,
  AtlasClaimSubject,
  AtlasCorrespondence,
  AtlasIncidence,
  AtlasRelation,
  ChartBridge,
  PrincipalityChart,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;

export function record(
  value: unknown,
  path: string,
  code: PrincipalityAtlasErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (
    snapshot === null ||
    Array.isArray(snapshot) ||
    typeof snapshot !== "object"
  ) {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: PrincipalityAtlasErrorCode,
): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: PrincipalityAtlasErrorCode,
): T {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return value as Sha256Id;
}

function fixedFalse(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function parseNullableSha256(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

function parseRefList(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
  maximum: number,
  normalize: boolean,
): readonly Sha256Id[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(code, `${path} must be an array of at most ${String(maximum)} refs`);
  }
  const refs = value.map((entry, index) =>
    sha256(entry, `${path}[${String(index)}]`, code),
  );
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate refs`);
  }
  const sorted = [...refs].sort(compareUnicode);
  if (!normalize && refs.some((entry, index) => entry !== sorted[index])) {
    fail(code, `${path} must use canonical Unicode order`);
  }
  return deepFreeze(normalize ? sorted : refs);
}

function parseCell(
  value: JsonValue,
  path: string,
  code: PrincipalityAtlasErrorCode,
): Readonly<AtlasCell> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["cell_ref", "kind_ref"], path, code);
  return deepFreeze({
    cell_ref: sha256(candidate.cell_ref, `${path}.cell_ref`, code),
    kind_ref: sha256(candidate.kind_ref, `${path}.kind_ref`, code),
  });
}

function parseCells(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<AtlasCell>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.cells_per_chart) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.cells_per_chart)} cells`,
    );
  }
  const cells = value.map((entry, index) =>
    parseCell(entry, `${path}[${String(index)}]`, code),
  );
  const refs = cells.map((cell) => cell.cell_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate cell_ref values`);
  }
  const sorted = [...cells].sort((left, right) =>
    compareUnicode(left.cell_ref, right.cell_ref),
  );
  if (!normalize && cells.some((cell, index) => cell.cell_ref !== sorted[index]?.cell_ref)) {
    fail(code, `${path} must be sorted by cell_ref`);
  }
  return deepFreeze(normalize ? sorted : cells);
}

function incidenceKey(value: AtlasIncidence): string {
  return `${value.cell_ref}\u0000${value.role_ref}`;
}

function parseIncidences(
  value: JsonValue | undefined,
  cellRefs: ReadonlySet<Sha256Id>,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<AtlasIncidence>[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > PRINCIPALITY_ATLAS_LIMITS.incidences_per_relation
  ) {
    fail(
      code,
      `${path} must contain 1..${String(PRINCIPALITY_ATLAS_LIMITS.incidences_per_relation)} incidences`,
    );
  }
  const incidences = value.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["cell_ref", "role_ref"], itemPath, code);
    const cellRef = sha256(candidate.cell_ref, `${itemPath}.cell_ref`, code);
    if (!cellRefs.has(cellRef)) {
      fail(code, `${itemPath}.cell_ref is not a cell in this chart`);
    }
    return deepFreeze({
      cell_ref: cellRef,
      role_ref: sha256(candidate.role_ref, `${itemPath}.role_ref`, code),
    });
  });
  const keys = incidences.map(incidenceKey);
  if (new Set(keys).size !== keys.length) {
    fail(code, `${path} must not contain duplicate cell/role incidences`);
  }
  const sorted = [...incidences].sort((left, right) =>
    compareUnicode(incidenceKey(left), incidenceKey(right)),
  );
  if (!normalize && incidences.some((entry, index) => incidenceKey(entry) !== incidenceKey(sorted[index]!))) {
    fail(code, `${path} must use canonical cell/role order`);
  }
  return deepFreeze(normalize ? sorted : incidences);
}

function relationShapeKey(value: AtlasRelation): string {
  return `${value.kind_ref}\u0000${value.incidences.map(incidenceKey).join("\u0001")}`;
}

function parseRelations(
  value: JsonValue | undefined,
  cellRefs: ReadonlySet<Sha256Id>,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<AtlasRelation>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.relations_per_chart) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.relations_per_chart)} relations`,
    );
  }
  const relations = value.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["relation_ref", "kind_ref", "incidences"], itemPath, code);
    return deepFreeze({
      relation_ref: sha256(candidate.relation_ref, `${itemPath}.relation_ref`, code),
      kind_ref: sha256(candidate.kind_ref, `${itemPath}.kind_ref`, code),
      incidences: parseIncidences(
        candidate.incidences,
        cellRefs,
        `${itemPath}.incidences`,
        code,
        normalize,
      ),
    });
  });
  const refs = relations.map((relation) => relation.relation_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate relation_ref values`);
  }
  const shapes = relations.map(relationShapeKey);
  if (new Set(shapes).size !== shapes.length) {
    fail(code, `${path} must not repeat an identical typed incidence relation`);
  }
  const sorted = [...relations].sort((left, right) =>
    compareUnicode(left.relation_ref, right.relation_ref),
  );
  if (!normalize && relations.some((entry, index) => entry.relation_ref !== sorted[index]?.relation_ref)) {
    fail(code, `${path} must be sorted by relation_ref`);
  }
  return deepFreeze(normalize ? sorted : relations);
}

function parseClaimSubject(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
): Readonly<AtlasClaimSubject> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["kind", "ref"], path, code);
  return deepFreeze({
    kind: literal(candidate.kind, ["cell", "relation"], `${path}.kind`, code),
    ref: sha256(candidate.ref, `${path}.ref`, code),
  });
}

function sameSubject(left: AtlasClaimSubject, right: AtlasClaimSubject): boolean {
  return left.kind === right.kind && left.ref === right.ref;
}

function parseClaims(
  value: JsonValue | undefined,
  cellRefs: ReadonlySet<Sha256Id>,
  relationRefs: ReadonlySet<Sha256Id>,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<AtlasClaim>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.claims_per_chart) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.claims_per_chart)} claims`,
    );
  }
  const claims = value.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(
      candidate,
      [
        "claim_ref",
        "subject",
        "perspective_ref",
        "posture",
        "evidence_refs",
        "supersedes_claim_ref",
        "assertion",
        "verified_by_package",
      ],
      itemPath,
      code,
    );
    const subject = parseClaimSubject(candidate.subject, `${itemPath}.subject`, code);
    const known = subject.kind === "cell" ? cellRefs.has(subject.ref) : relationRefs.has(subject.ref);
    if (!known) {
      fail(code, `${itemPath}.subject does not exist in this chart`);
    }
    return deepFreeze({
      claim_ref: sha256(candidate.claim_ref, `${itemPath}.claim_ref`, code),
      subject,
      perspective_ref: sha256(candidate.perspective_ref, `${itemPath}.perspective_ref`, code),
      posture: literal(
        candidate.posture,
        PRINCIPALITY_ATLAS_CLAIM_POSTURES,
        `${itemPath}.posture`,
        code,
      ),
      evidence_refs: parseRefList(
        candidate.evidence_refs,
        `${itemPath}.evidence_refs`,
        code,
        PRINCIPALITY_ATLAS_LIMITS.evidence_refs_per_assertion,
        normalize,
      ),
      supersedes_claim_ref: parseNullableSha256(
        candidate.supersedes_claim_ref,
        `${itemPath}.supersedes_claim_ref`,
        code,
      ),
      assertion: literal(candidate.assertion, ["caller_asserted"], `${itemPath}.assertion`, code),
      verified_by_package: fixedFalse(candidate.verified_by_package, `${itemPath}.verified_by_package`, code),
    });
  });
  const refs = claims.map((claim) => claim.claim_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate claim_ref values`);
  }
  const byRef = new Map(claims.map((claim) => [claim.claim_ref, claim]));
  for (const claim of claims) {
    if (claim.supersedes_claim_ref === null) continue;
    if (claim.supersedes_claim_ref === claim.claim_ref) {
      fail(code, `${path} contains self-supersession`);
    }
    const previous = byRef.get(claim.supersedes_claim_ref);
    if (!previous) {
      fail(code, `${path} contains an unknown supersedes_claim_ref`);
    }
    if (!sameSubject(claim.subject, previous.subject)) {
      fail(code, `${path} supersession must stay on the same subject`);
    }
    if (claim.perspective_ref !== previous.perspective_ref) {
      fail(code, `${path} supersession must stay in the same perspective`);
    }
  }
  for (const origin of claims) {
    const seen = new Set<Sha256Id>();
    let cursor: AtlasClaim | undefined = origin;
    while (cursor?.supersedes_claim_ref !== null && cursor !== undefined) {
      if (seen.has(cursor.claim_ref)) {
        fail(code, `${path} supersession must be acyclic`);
      }
      seen.add(cursor.claim_ref);
      cursor = byRef.get(cursor.supersedes_claim_ref);
    }
  }
  const sorted = [...claims].sort((left, right) =>
    compareUnicode(left.claim_ref, right.claim_ref),
  );
  if (!normalize && claims.some((entry, index) => entry.claim_ref !== sorted[index]?.claim_ref)) {
    fail(code, `${path} must be sorted by claim_ref`);
  }
  return deepFreeze(normalize ? sorted : claims);
}

function parseChart(
  value: JsonValue,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): Readonly<PrincipalityChart> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    ["chart_ref", "principality_ref", "perspective_ref", "cells", "relations", "claims"],
    path,
    code,
  );
  const cells = parseCells(candidate.cells, `${path}.cells`, code, normalize);
  const cellRefs = new Set(cells.map((cell) => cell.cell_ref));
  const relations = parseRelations(candidate.relations, cellRefs, `${path}.relations`, code, normalize);
  const relationRefs = new Set(relations.map((relation) => relation.relation_ref));
  return deepFreeze({
    chart_ref: sha256(candidate.chart_ref, `${path}.chart_ref`, code),
    principality_ref: sha256(candidate.principality_ref, `${path}.principality_ref`, code),
    perspective_ref: sha256(candidate.perspective_ref, `${path}.perspective_ref`, code),
    cells,
    relations,
    claims: parseClaims(candidate.claims, cellRefs, relationRefs, `${path}.claims`, code, normalize),
  });
}

export function parseCharts(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<PrincipalityChart>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.charts) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.charts)} charts`,
    );
  }
  const charts = value.map((entry, index) =>
    parseChart(entry, `${path}[${String(index)}]`, code, normalize),
  );
  const refs = charts.map((chart) => chart.chart_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate chart_ref values`);
  }
  const sorted = [...charts].sort((left, right) =>
    compareUnicode(left.chart_ref, right.chart_ref),
  );
  if (!normalize && charts.some((entry, index) => entry.chart_ref !== sorted[index]?.chart_ref)) {
    fail(code, `${path} must be sorted by chart_ref`);
  }
  return deepFreeze(normalize ? sorted : charts);
}

function correspondenceShapeKey(value: AtlasCorrespondence): string {
  return [
    value.from_cell_ref,
    value.to_cell_ref,
    value.posture,
    value.perspective_ref,
  ].join("\u0000");
}

function parseCorrespondences(
  value: JsonValue | undefined,
  fromCells: ReadonlySet<Sha256Id>,
  toCells: ReadonlySet<Sha256Id>,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<AtlasCorrespondence>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.correspondences_per_bridge) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.correspondences_per_bridge)} correspondences`,
    );
  }
  const correspondences = value.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(
      candidate,
      [
        "correspondence_ref",
        "from_cell_ref",
        "to_cell_ref",
        "posture",
        "perspective_ref",
        "evidence_refs",
        "assertion",
        "verified_by_package",
      ],
      itemPath,
      code,
    );
    const fromCellRef = sha256(candidate.from_cell_ref, `${itemPath}.from_cell_ref`, code);
    const toCellRef = sha256(candidate.to_cell_ref, `${itemPath}.to_cell_ref`, code);
    if (!fromCells.has(fromCellRef) || !toCells.has(toCellRef)) {
      fail(code, `${itemPath} must reference cells in the bridge endpoint charts`);
    }
    return deepFreeze({
      correspondence_ref: sha256(candidate.correspondence_ref, `${itemPath}.correspondence_ref`, code),
      from_cell_ref: fromCellRef,
      to_cell_ref: toCellRef,
      posture: literal(
        candidate.posture,
        PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES,
        `${itemPath}.posture`,
        code,
      ),
      perspective_ref: sha256(candidate.perspective_ref, `${itemPath}.perspective_ref`, code),
      evidence_refs: parseRefList(
        candidate.evidence_refs,
        `${itemPath}.evidence_refs`,
        code,
        PRINCIPALITY_ATLAS_LIMITS.evidence_refs_per_assertion,
        normalize,
      ),
      assertion: literal(candidate.assertion, ["caller_asserted"], `${itemPath}.assertion`, code),
      verified_by_package: fixedFalse(candidate.verified_by_package, `${itemPath}.verified_by_package`, code),
    });
  });
  const refs = correspondences.map((entry) => entry.correspondence_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate correspondence_ref values`);
  }
  const shapes = correspondences.map(correspondenceShapeKey);
  if (new Set(shapes).size !== shapes.length) {
    fail(code, `${path} must not repeat an identical reported correspondence`);
  }
  const sorted = [...correspondences].sort((left, right) =>
    compareUnicode(left.correspondence_ref, right.correspondence_ref),
  );
  if (!normalize && correspondences.some((entry, index) => entry.correspondence_ref !== sorted[index]?.correspondence_ref)) {
    fail(code, `${path} must be sorted by correspondence_ref`);
  }
  return deepFreeze(normalize ? sorted : correspondences);
}

function parseBridge(
  value: JsonValue,
  charts: ReadonlyMap<Sha256Id, PrincipalityChart>,
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): Readonly<ChartBridge> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "bridge_ref",
      "from_chart_ref",
      "to_chart_ref",
      "correspondences",
      "unmapped_from_refs",
      "unmapped_to_refs",
      "coverage",
    ],
    path,
    code,
  );
  const fromChartRef = sha256(candidate.from_chart_ref, `${path}.from_chart_ref`, code);
  const toChartRef = sha256(candidate.to_chart_ref, `${path}.to_chart_ref`, code);
  if (fromChartRef === toChartRef) {
    fail(code, `${path} must connect two distinct charts`);
  }
  const fromChart = charts.get(fromChartRef);
  const toChart = charts.get(toChartRef);
  if (!fromChart || !toChart) {
    fail(code, `${path} must reference charts in this atlas`);
  }
  const fromCells = new Set(fromChart.cells.map((cell) => cell.cell_ref));
  const toCells = new Set(toChart.cells.map((cell) => cell.cell_ref));
  const correspondences = parseCorrespondences(
    candidate.correspondences,
    fromCells,
    toCells,
    `${path}.correspondences`,
    code,
    normalize,
  );
  const unmappedFrom = parseRefList(
    candidate.unmapped_from_refs,
    `${path}.unmapped_from_refs`,
    code,
    PRINCIPALITY_ATLAS_LIMITS.unmapped_refs_per_bridge_side,
    normalize,
  );
  const unmappedTo = parseRefList(
    candidate.unmapped_to_refs,
    `${path}.unmapped_to_refs`,
    code,
    PRINCIPALITY_ATLAS_LIMITS.unmapped_refs_per_bridge_side,
    normalize,
  );
  if (unmappedFrom.some((ref) => !fromCells.has(ref)) || unmappedTo.some((ref) => !toCells.has(ref))) {
    fail(code, `${path} unmapped refs must belong to their endpoint charts`);
  }
  const mappedFrom = new Set(correspondences.map((entry) => entry.from_cell_ref));
  const mappedTo = new Set(correspondences.map((entry) => entry.to_cell_ref));
  if (unmappedFrom.some((ref) => mappedFrom.has(ref)) || unmappedTo.some((ref) => mappedTo.has(ref))) {
    fail(code, `${path} cannot report one cell as both mapped and unmapped`);
  }
  return deepFreeze({
    bridge_ref: sha256(candidate.bridge_ref, `${path}.bridge_ref`, code),
    from_chart_ref: fromChartRef,
    to_chart_ref: toChartRef,
    correspondences,
    unmapped_from_refs: unmappedFrom,
    unmapped_to_refs: unmappedTo,
    coverage: literal(candidate.coverage, ["partial_not_complete"], `${path}.coverage`, code),
  });
}

export function parseBridges(
  value: JsonValue | undefined,
  charts: readonly PrincipalityChart[],
  path: string,
  code: PrincipalityAtlasErrorCode,
  normalize: boolean,
): readonly Readonly<ChartBridge>[] {
  if (!Array.isArray(value) || value.length > PRINCIPALITY_ATLAS_LIMITS.bridges) {
    fail(
      code,
      `${path} must be an array of at most ${String(PRINCIPALITY_ATLAS_LIMITS.bridges)} bridges`,
    );
  }
  const chartMap = new Map(charts.map((chart) => [chart.chart_ref, chart]));
  const bridges = value.map((entry, index) =>
    parseBridge(entry, chartMap, `${path}[${String(index)}]`, code, normalize),
  );
  const refs = bridges.map((bridge) => bridge.bridge_ref);
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate bridge_ref values`);
  }
  const sorted = [...bridges].sort((left, right) =>
    compareUnicode(left.bridge_ref, right.bridge_ref),
  );
  if (!normalize && bridges.some((entry, index) => entry.bridge_ref !== sorted[index]?.bridge_ref)) {
    fail(code, `${path} must be sorted by bridge_ref`);
  }
  return deepFreeze(normalize ? sorted : bridges);
}

export function parseBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityAtlasErrorCode,
): typeof PRINCIPALITY_ATLAS_BOUNDARIES {
  const candidate = record(value, path, code);
  if (canonicalJson(candidate) !== canonicalJson(PRINCIPALITY_ATLAS_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed Principality Atlas boundary`);
  }
  return PRINCIPALITY_ATLAS_BOUNDARIES;
}
