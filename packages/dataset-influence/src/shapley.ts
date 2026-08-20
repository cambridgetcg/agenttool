import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  DATASET_INFLUENCE_BOUNDARIES,
  DATASET_INFLUENCE_FORMATS,
  MAX_PLAYERS,
} from "./constants.js";
import { fail } from "./errors.js";
import {
  addRational,
  compareRational,
  multiplyRational,
  parseRational,
  rational,
  subtractRational,
} from "./rational.js";
import type {
  CoalitionValueInput,
  ExactFiniteGameInput,
  Rational,
  ShadowAttribution,
  ShadowAttributionInput,
  ShadowContribution,
  Sha256Id,
} from "./types.js";
import {
  arrayValue,
  assertUniqueBy,
  exactKeys,
  record,
  sha256,
  sha256Set,
} from "./validation.js";

interface ParsedFiniteGame {
  utility_ref: Sha256Id;
  player_refs: readonly Sha256Id[];
  coalitions: readonly CoalitionValueInput[];
}

function coalitionKey(members: readonly Sha256Id[]): string {
  return members.join("\0");
}

function parseCoalition(value: unknown, path: string, players: ReadonlySet<Sha256Id>): CoalitionValueInput {
  const candidate = record(value as never, path);
  exactKeys(candidate, ["member_refs", "value"], path);
  const members = sha256Set(candidate.member_refs, `${path}.member_refs`, MAX_PLAYERS);
  if (members.some((member) => !players.has(member))) {
    fail("invalid_input", `${path}.member_refs must be a subset of player_refs`);
  }
  return { member_refs: members, value: parseRational(candidate.value, `${path}.value`) };
}

function parseGame(input: unknown, path = "$finite_game"): ParsedFiniteGame {
  const candidate = record(snapshotJson(input), path);
  exactKeys(candidate, ["utility_ref", "player_refs", "coalitions"], path);
  const playerRefs = sha256Set(candidate.player_refs, `${path}.player_refs`, MAX_PLAYERS);
  if (playerRefs.length === 0) fail("invalid_input", `${path}.player_refs must not be empty`);
  const expectedCoalitions = 2 ** playerRefs.length;
  const players = new Set(playerRefs);
  const coalitions = arrayValue(candidate.coalitions, expectedCoalitions, `${path}.coalitions`)
    .map((entry, index) => parseCoalition(entry, `${path}.coalitions[${index}]`, players))
    .sort((left, right) => compareUnicode(coalitionKey(left.member_refs), coalitionKey(right.member_refs)));
  if (coalitions.length !== expectedCoalitions) {
    fail("invalid_input", `${path}.coalitions must contain all ${expectedCoalitions} subsets exactly once`);
  }
  assertUniqueBy(coalitions, (entry) => coalitionKey(entry.member_refs), `${path}.coalitions`);
  for (let mask = 0; mask < expectedCoalitions; mask += 1) {
    const members = playerRefs.filter((_, index) => (mask & (1 << index)) !== 0);
    if (!coalitions.some((entry) => coalitionKey(entry.member_refs) === coalitionKey(members))) {
      fail("invalid_input", `${path}.coalitions is missing subset mask ${mask}`);
    }
  }
  return {
    utility_ref: sha256(candidate.utility_ref, `${path}.utility_ref`),
    player_refs: playerRefs,
    coalitions,
  };
}

function factorial(value: number): bigint {
  let result = 1n;
  for (let factor = 2; factor <= value; factor += 1) result *= BigInt(factor);
  return result;
}

function shapley(game: ParsedFiniteGame): {
  baseline: Rational;
  grand: Rational;
  contributions: readonly ShadowContribution[];
} {
  const values = new Map(game.coalitions.map((entry) => [coalitionKey(entry.member_refs), entry.value]));
  const baseline = values.get("")!;
  const grand = values.get(coalitionKey(game.player_refs))!;
  const n = game.player_refs.length;
  const nFactorial = factorial(n);
  const contributions = game.player_refs.map((player) => {
    let total = rational(0);
    for (const coalition of game.coalitions) {
      if (coalition.member_refs.includes(player)) continue;
      const withPlayer = [...coalition.member_refs, player].sort(compareUnicode);
      const marginal = subtractRational(values.get(coalitionKey(withPlayer))!, coalition.value);
      const size = coalition.member_refs.length;
      const weight = rational(factorial(size) * factorial(n - size - 1), nFactorial);
      total = addRational(total, multiplyRational(weight, marginal));
    }
    return { contribution_ref: player, value: total };
  });
  return { baseline, grand, contributions };
}

export function computeExactFiniteShapley(input: ExactFiniteGameInput): Readonly<{
  utility_ref: Sha256Id;
  player_refs: readonly Sha256Id[];
  coalitions: readonly CoalitionValueInput[];
  baseline_value: Rational;
  grand_value: Rational;
  contributions: readonly ShadowContribution[];
  sum_of_contributions: Rational;
  grand_minus_baseline: Rational;
  exact: true;
}>;
export function computeExactFiniteShapley(input: unknown): Readonly<{
  utility_ref: Sha256Id;
  player_refs: readonly Sha256Id[];
  coalitions: readonly CoalitionValueInput[];
  baseline_value: Rational;
  grand_value: Rational;
  contributions: readonly ShadowContribution[];
  sum_of_contributions: Rational;
  grand_minus_baseline: Rational;
  exact: true;
}>;
export function computeExactFiniteShapley(input: unknown) {
  const game = parseGame(input);
  const result = shapley(game);
  const sum = result.contributions.reduce((total, entry) => addRational(total, entry.value), rational(0));
  const difference = subtractRational(result.grand, result.baseline);
  if (compareRational(sum, difference) !== 0) fail("math_unavailable", "Exact Shapley conservation failed");
  return deepFreeze({
    ...game,
    baseline_value: result.baseline,
    grand_value: result.grand,
    contributions: result.contributions,
    sum_of_contributions: sum,
    grand_minus_baseline: difference,
    exact: true as const,
  });
}

export function createShadowAttribution(input: ShadowAttributionInput): Readonly<ShadowAttribution>;
export function createShadowAttribution(input: unknown): Readonly<ShadowAttribution>;
export function createShadowAttribution(input: unknown): Readonly<ShadowAttribution> {
  const candidate = record(snapshotJson(input), "$shadow_input");
  exactKeys(candidate, ["study_ref", "utility_ref", "player_refs", "coalitions"], "$shadow_input");
  const computed = computeExactFiniteShapley({
    utility_ref: candidate.utility_ref as never,
    player_refs: candidate.player_refs as never,
    coalitions: candidate.coalitions as never,
  });
  const body = {
    _format: DATASET_INFLUENCE_FORMATS.shadowAttribution,
    study_ref: sha256(candidate.study_ref, "$shadow_input.study_ref"),
    utility_ref: computed.utility_ref,
    method: "exact_finite_shapley" as const,
    player_refs: computed.player_refs,
    coalitions: computed.coalitions,
    baseline_value: computed.baseline_value,
    grand_value: computed.grand_value,
    contributions: computed.contributions,
    conservation: {
      sum_of_contributions: computed.sum_of_contributions,
      grand_minus_baseline: computed.grand_minus_baseline,
      exact: true as const,
    },
    interpretation: "bounded_metric_contribution_not_intrinsic_worth" as const,
    economic_effect: "none" as const,
    creates_debt: false as const,
    creates_entitlement: false as const,
    transfers_ownership: false as const,
    authorizes_payment: false as const,
    declarations: "caller_reported_not_independently_verified" as const,
    boundaries: DATASET_INFLUENCE_BOUNDARIES,
  };
  return deepFreeze({
    ...body,
    attribution_id: domainSeparatedId(DATASET_INFLUENCE_FORMATS.shadowAttribution, body),
  });
}

export function validateShadowAttribution(input: unknown): Readonly<ShadowAttribution> {
  const candidate = record(snapshotJson(input), "$shadow_attribution");
  exactKeys(candidate, [
    "_format",
    "attribution_id",
    "study_ref",
    "utility_ref",
    "method",
    "player_refs",
    "coalitions",
    "baseline_value",
    "grand_value",
    "contributions",
    "conservation",
    "interpretation",
    "economic_effect",
    "creates_debt",
    "creates_entitlement",
    "transfers_ownership",
    "authorizes_payment",
    "declarations",
    "boundaries",
  ], "$shadow_attribution");
  if (candidate._format !== DATASET_INFLUENCE_FORMATS.shadowAttribution) {
    fail("invalid_artifact", "Shadow attribution format is unsupported");
  }
  const expected = createShadowAttribution({
    study_ref: candidate.study_ref as never,
    utility_ref: candidate.utility_ref as never,
    player_refs: candidate.player_refs as never,
    coalitions: candidate.coalitions as never,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("invalid_artifact", "Shadow attribution differs from canonical reconstruction");
  }
  return expected;
}
