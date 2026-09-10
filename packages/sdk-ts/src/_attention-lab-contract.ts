/** FOMOengine v1 wire 邊界；只驗結構／references／null，唔生成 brief 或重算 rates。
 * 對照 producer lib/attention/contract.ts + fixtures/attention-lab/v1.schema.json。
 */
interface Validator<T> { parse(value: unknown): T }
type Value<V> = V extends Validator<infer T> ? T : never;
const refuse = (): never => { throw new TypeError("invalid attention-lab contract"); };
function validator<T>(check: (value: unknown) => boolean): Validator<T> {
  return { parse(value) { if (!check(value)) refuse(); return value as T; } };
}
const string = (max: number, min = 0, pattern?: RegExp) => validator<string>((value) =>
  typeof value === "string" && value.length >= min && value.length <= max
  && (!pattern || pattern.exec(value)?.[0] === value));
const number = (min: number, max: number) => validator<number>((value) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
const boolean = validator<boolean>((value) => typeof value === "boolean");
function literal<const T extends string | number | boolean>(value: T): Validator<T> {
  return validator<T>((candidate) => candidate === value);
}
function enumeration<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return validator<T[number]>((value) => typeof value === "string" && values.includes(value));
}
function nullable<T>(item: Validator<T>): Validator<T | null> {
  return { parse(value) { return value === null ? null : item.parse(value); } };
}
function array<T>(item: Validator<T>, max: number, min = 0): Validator<readonly T[]> {
  return { parse(value) {
    if (!Array.isArray(value) || value.length < min || value.length > max) refuse();
    for (const entry of value as unknown[]) item.parse(entry);
    return value as T[];
  } };
}
function object<S extends Record<string, Validator<unknown>>>(shape: S): Validator<{ readonly [K in keyof S]: Value<S[K]> }> {
  return { parse(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length !== Object.keys(shape).length) refuse();
    for (const [key, item] of Object.entries(shape)) {
      if (!Object.hasOwn(data, key)) refuse();
      item.parse(data[key]);
    }
    return data as { readonly [K in keyof S]: Value<S[K]> };
  } };
}
const id = string(128, 1, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const version = string(64, 1, /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/u);
const text = string(4000, 1);
const lines = array(text, 30);
const ids = array(id, 64, 1);
const longText = string(12000);
const meta = {
  schemaVersion: literal(1), engineVersion: version, catalogueVersion: version,
  catalogueDigest: validator<`sha256:${string}`>((value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.exec(value)?.[0] === value),
};
const metric = object({ name: string(300), numerator: string(1600), denominator: string(1600), caveat: string(3000) });
const briefInput = object({
  topic: string(200), audience: string(600), platformId: id,
  objective: enumeration(["surface-response", "useful-action", "understanding"]),
  mechanismId: id, takeaway: string(1000), action: string(300),
  evidenceStatus: enumeration(["missing", "provided"]), evidence: string(4000),
  constraints: string(2000), verifiedProof: string(2000), realLimit: string(500),
  limitReason: string(500), terms: string(2000), nonpoliticalConfirmed: literal(true),
});
const counts = object({ aOutcomes: string(32), aEligible: string(32), bOutcomes: string(32), bEligible: string(32) });
const plan = object({
  design: enumeration(["observational", "randomized"]), allocation: string(2000), eligibility: string(2000),
  startDate: string(10), endDate: string(10), stoppingRule: string(2000),
  guardrailPlan: string(3000), guardrailResults: string(4000),
});
const comparisonFields = { counts, plan, metric };
const comparisonInput = object(comparisonFields);
const source = object({
  id, title: string(1000, 1), url: string(2048, 1), publisher: string(1000, 1),
  publishedAt: nullable(string(10, 4)), reviewedAt: string(10, 10), context: text, retrievalLimitations: text,
});
const claim = object({
  id, text, kind: enumeration(["official-disclosure", "experimental", "observational", "hypothesis"]),
  sourceIds: ids, context: text, limitations: array(text, 30, 1),
});
const mechanism = object({
  id, name: string(300, 1), summary: text, emotion: text, howItWorks: lines,
  example: object({ honest: text, pressure: text, distinction: text }),
  claims: array(claim, 30, 1), honestUse: lines, countermeasure: text, tradeoffs: lines,
  experiment: object({ question: text, variable: text, control: text, treatment: text, holdConstant: lines, readout: text, limitations: text }),
  compatiblePlatformIds: ids, sourceIds: ids,
});
const platform = object({
  id, name: string(300, 1), channel: enumeration(["social", "search", "email", "offer"]), surface: string(300, 1),
  kind: enumeration(["ranked-surface", "strategy-channel"]), summary: text, rankingDisclosure: text,
  signals: array(claim, 30, 1), practicalChoices: lines, metric, qualityGuardrails: lines, confounders: lines, sourceIds: ids,
});
const catalogue = object({ ...meta, mechanisms: array(mechanism, 32, 1), platforms: array(platform, 32, 1), sources: array(source, 64, 1) });
const generatedBrief = object({
  input: briefInput, title: string(500), sections: array(object({ heading: string(200), body: longText }), 20),
  experiment: object({
    question: longText, variable: string(500), control: longText, treatment: longText, shared: array(longText, 20),
    blocked: boolean, limitations: array(longText, 30),
  }),
  metric, guardrails: array(longText, 20), confounders: array(longText, 20), sourceIds: ids,
});
const selected = object({ id, name: string(300, 1), claimIds: ids });
const briefResult = object({
  ...meta, brief: generatedBrief, mechanism: selected, platform: selected,
  sources: array(source, 64, 1), claims: array(claim, 60, 1), markdown: string(90000, 1),
});
const rates = object({
  aRate: nullable(number(0, 1)), bRate: nullable(number(0, 1)),
  percentagePointDifference: nullable(number(-100, 100)), relativeLift: nullable(number(-1, Number.MAX_SAFE_INTEGER)),
});
const comparisonResult = object({
  ...meta, ...comparisonFields, comparison: nullable(rates), designDescription: text,
  missingRequirements: array(text, 20), interpretation: text,
});

/** wire camelCase 同字串 counts 原樣保留；ID 由 producer 按當前 catalogue 驗。 */
export type AttentionLabBriefInput = Value<typeof briefInput>;
export type AttentionLabRawCounts = Value<typeof counts>;
export type AttentionLabExperimentPlan = Value<typeof plan>;
export type AttentionLabMetricDefinition = Value<typeof metric>;
export type AttentionLabComparisonInput = Value<typeof comparisonInput>;
export type AttentionLabSource = Value<typeof source>;
export type AttentionLabClaim = Value<typeof claim>;
export type AttentionLabMechanism = Value<typeof mechanism>;
export type AttentionLabPlatform = Value<typeof platform>;
export type AttentionLabGeneratedBrief = Value<typeof generatedBrief>;
export type AttentionLabRates = Value<typeof rates>;
export type AttentionLabCatalogueResult = Value<typeof catalogue>;
export type AttentionLabBriefResult = Value<typeof briefResult>;
export type AttentionLabComparisonResult = Value<typeof comparisonResult>;

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
function sourcesValid(sources: readonly AttentionLabSource[]): void {
  for (const entry of sources) {
    let url: URL;
    try { url = new URL(entry.url); } catch { refuse(); }
    if (!/^https?:\/\//u.test(entry.url) || !["https:", "http:"].includes(url!.protocol)
      || !url!.hostname || url!.username || url!.password || !calendarDate(entry.reviewedAt)) refuse();
    const published = entry.publishedAt;
    if (published !== null && (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(published)
      || !calendarDate(published.length === 4 ? `${published}-01-01` : published.length === 7 ? `${published}-01` : published))) refuse();
  }
}
function unique(values: readonly string[]): Set<string> {
  const result = new Set(values);
  if (result.size !== values.length) refuse();
  return result;
}
function refs(values: readonly string[], known: ReadonlySet<string>): void {
  unique(values);
  if (values.some((value) => !known.has(value))) refuse();
}
function claimsClosed(claims: readonly AttentionLabClaim[], sources: ReadonlySet<string>): void {
  unique(claims.map((entry) => entry.id));
  for (const entry of claims) refs(entry.sourceIds, sources);
}
function readyInput(input: AttentionLabBriefInput): void {
  if (!input.topic.trim() || !input.audience.trim() || (input.evidenceStatus === "provided" && !input.evidence.trim())) refuse();
  // 唔複製 mechanism registry 或 compatibility 邏輯；新 request 嘅 current IDs 由 server 驗。
}
function comparisonInputValid(input: AttentionLabComparisonInput): void {
  for (const value of Object.values(input.counts)) {
    if (value !== "" && (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)))) refuse();
  }
  for (const group of ["a", "b"] as const) {
    const outcomes = input.counts[`${group}Outcomes`];
    const eligible = input.counts[`${group}Eligible`];
    if (outcomes !== "" && eligible !== "" && Number(outcomes) > Number(eligible)) refuse();
  }
  if ((input.plan.startDate && !calendarDate(input.plan.startDate)) || (input.plan.endDate && !calendarDate(input.plan.endDate))
    || (input.plan.startDate && input.plan.endDate && input.plan.startDate > input.plan.endDate)) refuse();
}

export function validateAttentionInput(operation: "briefs" | "comparisons", value: unknown): void {
  if (operation === "briefs") readyInput(briefInput.parse(value));
  else comparisonInputValid(comparisonInput.parse(value));
}

export function validateAttentionResult(operation: "catalogue" | "briefs" | "comparisons", value: unknown): void {
  if (operation === "catalogue") {
    const result = catalogue.parse(value);
    sourcesValid(result.sources);
    const sourceIds = unique(result.sources.map((entry) => entry.id));
    const platformIds = unique(result.platforms.map((entry) => entry.id));
    unique(result.mechanisms.map((entry) => entry.id));
    unique([...result.mechanisms.flatMap((entry) => entry.claims), ...result.platforms.flatMap((entry) => entry.signals)].map((entry) => entry.id));
    for (const entry of result.mechanisms) {
      refs(entry.compatiblePlatformIds, platformIds);
      refs(entry.sourceIds, sourceIds);
      claimsClosed(entry.claims, new Set(entry.sourceIds));
    }
    for (const entry of result.platforms) {
      refs(entry.sourceIds, sourceIds);
      claimsClosed(entry.signals, new Set(entry.sourceIds));
    }
  } else if (operation === "briefs") {
    const result = briefResult.parse(value);
    readyInput(result.brief.input);
    sourcesValid(result.sources);
    const sourceIds = unique(result.sources.map((entry) => entry.id));
    refs(result.brief.sourceIds, sourceIds);
    refs([...sourceIds], new Set(result.brief.sourceIds));
    claimsClosed(result.claims, sourceIds);
    const claimIds = new Set(result.claims.map((entry) => entry.id));
    refs(result.mechanism.claimIds, claimIds);
    refs(result.platform.claimIds, claimIds);
    refs([...claimIds], new Set([...result.mechanism.claimIds, ...result.platform.claimIds]));
    if (result.brief.input.mechanismId !== result.mechanism.id || result.brief.input.platformId !== result.platform.id) refuse();
  } else {
    const result = comparisonResult.parse(value);
    comparisonInputValid(result);
    const incomplete = Object.values(result.counts).some((count) => count === "");
    if (incomplete !== (result.comparison === null)) refuse();
    if (result.comparison) {
      const aUnknown = Number(result.counts.aEligible) === 0;
      const bUnknown = Number(result.counts.bEligible) === 0;
      const baselineZero = Number(result.counts.aOutcomes) === 0;
      const nulls = { aRate: aUnknown, bRate: bUnknown, percentagePointDifference: aUnknown || bUnknown, relativeLift: aUnknown || bUnknown || baselineZero };
      for (const key of Object.keys(nulls) as (keyof typeof nulls)[]) {
        if ((result.comparison[key] === null) !== nulls[key]) refuse();
      }
    }
  }
}
