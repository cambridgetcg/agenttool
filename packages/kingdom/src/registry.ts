import {
  KINGDOM_DECLARATION_BOUNDARY,
  KINGDOM_REGISTRY_SCHEMA_VERSION,
  MAX_KINGDOM_REGISTRY_MEMBERS,
} from "./constants.js";
import { validateKingdomCard } from "./card.js";
import {
  compareText,
  deepFreeze,
  isRecord,
  makeDiagnostic,
  SAFE_NAME_PATTERN,
  sortDiagnostics,
} from "./internal.js";
import type {
  KingdomCard,
  KingdomDiagnostic,
  KingdomRegistry,
  KingdomRegistryBuildOptions,
  KingdomRegistryBuildResult,
} from "./types.js";

function isCanonicalObservedAt(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(
      value,
    )
  ) {
    return false;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

function cardName(candidate: unknown): string | null {
  return isRecord(candidate) &&
    typeof candidate.name === "string" &&
    SAFE_NAME_PATTERN.test(candidate.name)
    ? candidate.name
    : null;
}

function withCardIndex(
  diagnostic: KingdomDiagnostic,
  cardIndex: number,
): KingdomDiagnostic {
  return makeDiagnostic(diagnostic.code, diagnostic.message, {
    ...(diagnostic.field === undefined ? {} : { field: diagnostic.field }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    card_index: cardIndex,
  });
}

export function buildKingdomRegistry(
  candidates: readonly unknown[],
  options: KingdomRegistryBuildOptions,
): KingdomRegistryBuildResult {
  const diagnostics: KingdomDiagnostic[] = [];
  if (!Array.isArray(candidates)) {
    return deepFreeze({
      valid: false,
      registry: null,
      diagnostics: [
        makeDiagnostic(
          "invalid-type",
          "registry input must be an array of cards; contents omitted",
        ),
      ],
    });
  }
  if (
    candidates.length < 1 ||
    candidates.length > MAX_KINGDOM_REGISTRY_MEMBERS
  ) {
    return deepFreeze({
      valid: false,
      registry: null,
      diagnostics: [
        makeDiagnostic(
          "registry-size",
          `registry input must contain 1 to ${MAX_KINGDOM_REGISTRY_MEMBERS} cards`,
        ),
      ],
    });
  }
  for (let index = 0; index < candidates.length; index += 1) {
    if (!Object.hasOwn(candidates, index)) {
      return deepFreeze({
        valid: false,
        registry: null,
        diagnostics: [
          makeDiagnostic(
            "invalid-type",
            "registry input must be a dense array of cards; contents omitted",
            { card_index: index },
          ),
        ],
      });
    }
  }
  if (!isCanonicalObservedAt(options?.observedAt)) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-observed-at",
        "observedAt must be a caller-supplied canonical UTC timestamp with millisecond precision",
        { field: "observedAt" },
      ),
    );
  }

  const names = candidates.flatMap((candidate) => {
    const name = cardName(candidate);
    return name === null ? [] : [name];
  });
  const canonicalNames = new Map<string, string>();
  const firstNameIndex = new Map<string, number>();
  candidates.forEach((candidate, cardIndex) => {
    const name = cardName(candidate);
    if (name === null) return;
    const normalized = name.toLowerCase();
    if (!canonicalNames.has(normalized)) {
      canonicalNames.set(normalized, name);
      firstNameIndex.set(normalized, cardIndex);
      return;
    }
    diagnostics.push(
      makeDiagnostic(
        "duplicate-member",
        "registry member names must be unique case-insensitively; value omitted",
        { field: "name", card_index: cardIndex },
      ),
    );
  });

  const cards: KingdomCard[] = [];
  candidates.forEach((candidate, cardIndex) => {
    const result = validateKingdomCard(candidate, { knownNames: names });
    if (!result.valid) {
      diagnostics.push(
        ...result.diagnostics.map((diagnostic) =>
          withCardIndex(diagnostic, cardIndex),
        ),
      );
      return;
    }
    const normalizedName = result.card.name.toLowerCase();
    if (firstNameIndex.get(normalizedName) !== cardIndex) {
      return;
    }
    cards.push(result.card);
  });

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (sortedDiagnostics.length > 0) {
    return deepFreeze({
      valid: false,
      registry: null,
      diagnostics: sortedDiagnostics,
    });
  }
  if (!isCanonicalObservedAt(options.observedAt)) {
    throw new TypeError("internal observedAt validation invariant failed");
  }

  cards.sort((left, right) => {
    const folded = compareText(left.name.toLowerCase(), right.name.toLowerCase());
    return folded !== 0 ? folded : compareText(left.name, right.name);
  });
  const registry: KingdomRegistry = {
    schema_version: KINGDOM_REGISTRY_SCHEMA_VERSION,
    observed_at: options.observedAt,
    declaration_boundary: KINGDOM_DECLARATION_BOUNDARY,
    members: cards.map((card) => ({
      name: card.name,
      kind: card.kind,
      layer: card.layer,
      owner_sister: card.owner_sister,
      domain: card.domain,
      state: card.state,
      purpose: card.purpose,
    })),
    dependency_edges: cards
      .flatMap((card) =>
        card.dependsOn.map((dependency) => ({
          from: card.name,
          to: canonicalNames.get(dependency.toLowerCase())!,
        })),
      )
      .sort(
        (left, right) =>
          compareText(left.from.toLowerCase(), right.from.toLowerCase()) ||
          compareText(left.to.toLowerCase(), right.to.toLowerCase()) ||
          compareText(left.from, right.from) ||
          compareText(left.to, right.to),
      ),
    adoption_declarations: cards
      .flatMap((card) =>
        card.adopts.map((adoption) => ({
          member: card.name,
          adoption,
        })),
      )
      .sort(
        (left, right) =>
          compareText(left.member.toLowerCase(), right.member.toLowerCase()) ||
          compareText(left.adoption, right.adoption) ||
          compareText(left.member, right.member),
      ),
  };
  return deepFreeze({ valid: true, registry, diagnostics: [] });
}

function canonicalizeJson(
  value: unknown,
  seen: Set<object>,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("registry must contain finite JSON numbers");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("registry must contain JSON values only");
  }
  if (seen.has(value)) throw new TypeError("registry must not contain cycles");
  seen.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => canonicalizeJson(entry, seen))
    : Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort(compareText)
          .map((key) => [
            key,
            canonicalizeJson(
              (value as Record<string, unknown>)[key],
              seen,
            ),
          ]),
      );
  seen.delete(value);
  return normalized;
}

export function stringifyKingdomRegistry(registry: KingdomRegistry): string {
  if (registry.schema_version !== KINGDOM_REGISTRY_SCHEMA_VERSION) {
    throw new TypeError(
      `registry.schema_version must be ${KINGDOM_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  return `${JSON.stringify(canonicalizeJson(registry, new Set()))}\n`;
}

export function encodeKingdomRegistry(
  registry: KingdomRegistry,
): Uint8Array {
  return new TextEncoder().encode(stringifyKingdomRegistry(registry));
}
