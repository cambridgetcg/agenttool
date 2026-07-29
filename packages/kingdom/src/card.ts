import {
  KINGDOM_ACCEPTED_ADOPTIONS,
  KINGDOM_CARD_FIELDS,
  KINGDOM_CARD_SCHEMA_VERSION,
  KINGDOM_DOMAINS,
  KINGDOM_KINDS,
  KINGDOM_LAYERS,
  KINGDOM_OWNER_SISTERS,
  KINGDOM_REQUIRED_YAML_FIELDS,
  KINGDOM_STATES,
  KINGDOM_YAML_FIELDS,
  MAX_KINGDOM_CARD_BYTES,
  MAX_KINGDOM_CARD_LINES,
  MAX_KINGDOM_LIST_ITEMS,
} from "./constants.js";
import {
  deepFreeze,
  isRecord,
  isSafeBoundedText,
  makeDiagnostic,
  SAFE_NAME_PATTERN,
  sortDiagnostics,
} from "./internal.js";
import type {
  KingdomCard,
  KingdomCardParseResult,
  KingdomCardValidationOptions,
  KingdomCardValidationResult,
  KingdomDiagnostic,
} from "./types.js";

const CARD_FIELD_SET = new Set<string>(KINGDOM_CARD_FIELDS);
const YAML_FIELD_SET = new Set<string>(KINGDOM_YAML_FIELDS);
const ARRAY_FIELDS = new Set(["dependsOn", "adopts"]);

interface ParsedValue {
  readonly ok: boolean;
  readonly value?: string | readonly string[];
}

function enumHas<T extends string>(
  values: readonly T[],
  candidate: unknown,
): candidate is T {
  return typeof candidate === "string" && values.includes(candidate as T);
}

function parseQuotedScalar(source: string): ParsedValue {
  if (source.startsWith('"')) {
    if (!source.endsWith('"')) return { ok: false };
    try {
      const parsed: unknown = JSON.parse(source);
      return typeof parsed === "string" && !/[\r\n]/.test(parsed)
        ? { ok: true, value: parsed }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) return { ok: false };
    let value = "";
    const body = source.slice(1, -1);
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index]!;
      if (character !== "'") {
        value += character;
        continue;
      }
      if (body[index + 1] !== "'") return { ok: false };
      value += "'";
      index += 1;
    }
    return { ok: true, value };
  }
  return { ok: false };
}

function parseScalar(source: string): ParsedValue {
  const value = source.trim();
  if (value === "") return { ok: true, value: "" };
  if (value.startsWith('"') || value.startsWith("'")) {
    return parseQuotedScalar(value);
  }
  if (
    value.endsWith('"') ||
    value.endsWith("'") ||
    /^[\[\]{}&*!|>@`]/.test(value)
  ) {
    return { ok: false };
  }
  return { ok: true, value };
}

function splitInlineArray(source: string): readonly string[] | null {
  const entries: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "," ) {
      entries.push(source.slice(start, index));
      start = index + 1;
      continue;
    }
    if ("[]{}".includes(character)) return null;
  }
  if (quote !== null || escaped) return null;
  entries.push(source.slice(start));
  return entries;
}

function parseInlineArray(source: string): ParsedValue {
  if (!source.startsWith("[") || !source.endsWith("]")) {
    return { ok: false };
  }
  const body = source.slice(1, -1).trim();
  if (body === "") return { ok: true, value: Object.freeze([]) };
  const rawEntries = splitInlineArray(body);
  if (rawEntries === null || rawEntries.length > MAX_KINGDOM_LIST_ITEMS) {
    return { ok: false };
  }
  const values: string[] = [];
  for (const rawEntry of rawEntries) {
    const parsed = parseScalar(rawEntry);
    if (!parsed.ok || typeof parsed.value !== "string" || parsed.value === "") {
      return { ok: false };
    }
    values.push(parsed.value);
  }
  return { ok: true, value: Object.freeze(values) };
}

function parseValue(source: string): ParsedValue {
  const value = source.trim();
  if (value.startsWith("[") || value.endsWith("]")) {
    return parseInlineArray(value);
  }
  return parseScalar(value);
}

function addStringDiagnostic(
  diagnostics: KingdomDiagnostic[],
  candidate: unknown,
  field: string,
  maximum: number,
): candidate is string {
  if (!isSafeBoundedText(candidate, maximum)) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-format",
        `field must be a trimmed, single-line string of 1 to ${maximum} characters; value omitted`,
        { field },
      ),
    );
    return false;
  }
  return true;
}

function validateStringList(
  diagnostics: KingdomDiagnostic[],
  candidate: unknown,
  field: "dependsOn" | "adopts",
): candidate is readonly string[] {
  if (!Array.isArray(candidate)) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-type",
        "field must be a one-line array of strings; value omitted",
        { field },
      ),
    );
    return false;
  }
  if (candidate.length > MAX_KINGDOM_LIST_ITEMS) {
    diagnostics.push(
      makeDiagnostic(
        "too-many-items",
        `field must contain at most ${MAX_KINGDOM_LIST_ITEMS} items; values omitted`,
        { field },
      ),
    );
    return false;
  }
  for (let index = 0; index < candidate.length; index += 1) {
    const entry = candidate[index];
    if (
      !Object.hasOwn(candidate, index) ||
      !isSafeBoundedText(entry, 120) ||
      (field === "dependsOn" && !SAFE_NAME_PATTERN.test(entry))
    ) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-format",
          "field entries must be a dense list of safe project or adoption identifiers; values omitted",
          { field },
        ),
      );
      return false;
    }
  }
  const normalized = candidate.map((entry) =>
    field === "dependsOn" ? entry.toLowerCase() : entry,
  );
  if (new Set(normalized).size !== normalized.length) {
    diagnostics.push(
      makeDiagnostic(
        "duplicate-item",
        "field entries must be unique; duplicate values omitted",
        { field },
      ),
    );
    return false;
  }
  return true;
}

export function validateKingdomCard(
  candidate: unknown,
  options: KingdomCardValidationOptions = {},
): KingdomCardValidationResult {
  const diagnostics: KingdomDiagnostic[] = [];
  if (!isRecord(candidate)) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: [
        makeDiagnostic(
          "invalid-type",
          "card must be a non-array object; contents omitted",
        ),
      ],
    });
  }

  for (const key of Object.keys(candidate)) {
    if (!CARD_FIELD_SET.has(key)) {
      diagnostics.push(
        makeDiagnostic(
          "unknown-field",
          "one or more fields are not part of the card contract; names and values omitted",
        ),
      );
      break;
    }
  }
  for (const field of KINGDOM_CARD_FIELDS) {
    if (!Object.hasOwn(candidate, field)) {
      diagnostics.push(
        makeDiagnostic("missing-field", "required field is absent", { field }),
      );
    }
  }

  if (
    candidate.schema_version !== undefined &&
    candidate.schema_version !== KINGDOM_CARD_SCHEMA_VERSION
  ) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-schema-version",
        `schema_version must be ${KINGDOM_CARD_SCHEMA_VERSION}; value omitted`,
        { field: "schema_version" },
      ),
    );
  }

  const candidateName = candidate.name;
  const candidatePurpose = candidate.purpose;
  const candidateDependencies = candidate.dependsOn;
  const candidateAdoptions = candidate.adopts;
  const nameValid =
    addStringDiagnostic(diagnostics, candidateName, "name", 120) &&
    SAFE_NAME_PATTERN.test(candidateName as string);
  if (
    typeof candidate.name === "string" &&
    isSafeBoundedText(candidate.name, 120) &&
    !SAFE_NAME_PATTERN.test(candidate.name)
  ) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-format",
        "name must use only letters, digits, dot, underscore, or hyphen; value omitted",
        { field: "name" },
      ),
    );
  }

  const enumFields = [
    ["kind", candidate.kind, KINGDOM_KINDS],
    ["layer", candidate.layer, KINGDOM_LAYERS],
    ["owner_sister", candidate.owner_sister, KINGDOM_OWNER_SISTERS],
    ["domain", candidate.domain, KINGDOM_DOMAINS],
    ["state", candidate.state, KINGDOM_STATES],
  ] as const;
  for (const [field, value, allowed] of enumFields) {
    if (!enumHas(allowed, value)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-enum",
          `field must use one of the contract's ${allowed.length} accepted values; actual value omitted`,
          { field },
        ),
      );
    }
  }

  const purposeValid = addStringDiagnostic(
    diagnostics,
    candidatePurpose,
    "purpose",
    500,
  );
  const dependenciesValid = validateStringList(
    diagnostics,
    candidateDependencies,
    "dependsOn",
  );
  const adoptionsValid = validateStringList(
    diagnostics,
    candidateAdoptions,
    "adopts",
  );

  if (
    nameValid &&
    dependenciesValid &&
    candidateDependencies.some(
      (dependency) => dependency.toLowerCase() === candidateName.toLowerCase(),
    )
  ) {
    diagnostics.push(
      makeDiagnostic(
        "self-dependency",
        "a project cannot declare itself as a dependency; value omitted",
        { field: "dependsOn" },
      ),
    );
  }

  if (dependenciesValid && options.knownNames !== undefined) {
    const knownNames = new Set(
      options.knownNames
        .filter((entry) => SAFE_NAME_PATTERN.test(entry))
        .map((entry) => entry.toLowerCase()),
    );
    if (
      candidateDependencies.some(
        (dependency) => !knownNames.has(dependency.toLowerCase()),
      )
    ) {
      diagnostics.push(
        makeDiagnostic(
          "unknown-dependency",
          "one or more dependencies are not registry members; values omitted",
          { field: "dependsOn" },
        ),
      );
    }
  }

  if (
    adoptionsValid &&
    candidateAdoptions.some(
      (adoption) =>
        !KINGDOM_ACCEPTED_ADOPTIONS.includes(
          adoption as (typeof KINGDOM_ACCEPTED_ADOPTIONS)[number],
        ),
    )
  ) {
    diagnostics.push(
      makeDiagnostic(
        "unsupported-adoption",
        "one or more adoption IDs are not accepted by this contract; values omitted",
        { field: "adopts" },
      ),
    );
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (sortedDiagnostics.length > 0) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: sortedDiagnostics,
    });
  }

  if (
    !nameValid ||
    !purposeValid ||
    !dependenciesValid ||
    !adoptionsValid
  ) {
    throw new TypeError("internal card validation invariant failed");
  }
  const card: KingdomCard = {
    schema_version: KINGDOM_CARD_SCHEMA_VERSION,
    name: candidateName as string,
    kind: candidate.kind as KingdomCard["kind"],
    layer: candidate.layer as KingdomCard["layer"],
    owner_sister: candidate.owner_sister as KingdomCard["owner_sister"],
    domain: candidate.domain as KingdomCard["domain"],
    state: candidate.state as KingdomCard["state"],
    purpose: candidatePurpose as string,
    dependsOn: [...candidateDependencies],
    adopts: [...candidateAdoptions] as KingdomCard["adopts"],
  };
  return deepFreeze({ valid: true, card, diagnostics: [] });
}

export function parseKingdomCard(
  source: string,
  options: KingdomCardValidationOptions = {},
): KingdomCardParseResult {
  const diagnostics: KingdomDiagnostic[] = [];
  if (typeof source !== "string") {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: [
        makeDiagnostic(
          "invalid-type",
          "card source must be text; contents omitted",
        ),
      ],
    });
  }
  if (new TextEncoder().encode(source).byteLength > MAX_KINGDOM_CARD_BYTES) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: [
        makeDiagnostic(
          "source-too-large",
          `card source exceeds the ${MAX_KINGDOM_CARD_BYTES}-byte limit; contents omitted`,
        ),
      ],
    });
  }
  const normalized = source.replaceAll("\r\n", "\n");
  if (
    normalized.includes("\r") ||
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(normalized)
  ) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: [
        makeDiagnostic(
          "invalid-character",
          "card source contains unsupported control or line-separator characters; contents omitted",
        ),
      ],
    });
  }
  const lines = normalized.split("\n");
  if (lines.length > MAX_KINGDOM_CARD_LINES) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: [
        makeDiagnostic(
          "too-many-lines",
          `card source exceeds the ${MAX_KINGDOM_CARD_LINES}-line limit; contents omitted`,
        ),
      ],
    });
  }

  const candidate: Record<string, unknown> = {
    schema_version: KINGDOM_CARD_SCHEMA_VERSION,
  };
  const seen = new Set<string>();
  const fieldLines = new Map<string, number>();

  for (const [index, sourceLine] of lines.entries()) {
    const line = index + 1;
    const trimmed = sourceLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = sourceLine.match(/^([A-Za-z_][A-Za-z0-9_]*):[ ]*(.*)$/);
    if (match === null) {
      diagnostics.push(
        makeDiagnostic(
          "malformed-line",
          "expected one flat key: value entry; line contents omitted",
          { line },
        ),
      );
      continue;
    }
    const field = match[1]!;
    if (!YAML_FIELD_SET.has(field)) {
      diagnostics.push(
        makeDiagnostic(
          "unknown-field",
          "field is not part of the card contract; value omitted",
          { field, line },
        ),
      );
      continue;
    }
    if (seen.has(field)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-field",
          "field appears more than once; duplicate value omitted",
          { field, line },
        ),
      );
      continue;
    }
    seen.add(field);
    fieldLines.set(field, line);
    const parsed = parseValue(match[2]!);
    if (!parsed.ok || parsed.value === undefined) {
      diagnostics.push(
        makeDiagnostic(
          "malformed-value",
          "value is outside the supported flat-card syntax; contents omitted",
          { field, line },
        ),
      );
      continue;
    }
    if (
      (ARRAY_FIELDS.has(field) && !Array.isArray(parsed.value)) ||
      (!ARRAY_FIELDS.has(field) && Array.isArray(parsed.value))
    ) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-type",
          ARRAY_FIELDS.has(field)
            ? "field must use one-line array syntax; value omitted"
            : "field must be a scalar; value omitted",
          { field, line },
        ),
      );
      continue;
    }
    candidate[field] = parsed.value;
  }

  if (!seen.has("adopts")) candidate.adopts = [];
  for (const field of KINGDOM_REQUIRED_YAML_FIELDS) {
    if (!seen.has(field)) {
      diagnostics.push(
        makeDiagnostic("missing-field", "required field is absent", { field }),
      );
    }
  }

  const validated = validateKingdomCard(candidate, options);
  for (const diagnostic of validated.diagnostics) {
    if (
      diagnostic.code === "missing-field" &&
      diagnostics.some(
        (entry) =>
          entry.code === "missing-field" && entry.field === diagnostic.field,
      )
    ) {
      continue;
    }
    if (diagnostic.line !== undefined || diagnostic.field === undefined) {
      diagnostics.push(diagnostic);
      continue;
    }
    const fieldLine = fieldLines.get(diagnostic.field);
    diagnostics.push(
      makeDiagnostic(diagnostic.code, diagnostic.message, {
        field: diagnostic.field,
        ...(fieldLine === undefined ? {} : { line: fieldLine }),
      }),
    );
  }
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (sortedDiagnostics.length > 0 || !validated.valid) {
    return deepFreeze({
      valid: false,
      card: null,
      diagnostics: sortedDiagnostics,
    });
  }
  return deepFreeze({
    valid: true,
    card: validated.card,
    diagnostics: [],
  });
}
