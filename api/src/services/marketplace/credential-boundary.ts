/** Marketplace boundary: a seller may request task data, never authority. */

const REQUEST_VERB =
  "send|share|provide|paste|submit|upload|enter|give|include|attach|supply|surrender|need|require|request";

const CREDENTIAL_TERM = [
  "agent[ _-]*tool(?:'s)?[ _-]+(?:bearer(?:[ _-]+tokens?)?|api[ _-]+keys?)",
  "git[ _-]*hub(?:'s)?[ _-]+(?:personal[ _-]+access[ _-]+tokens?|pat)",
  "oauth(?:[ _-]+2(?:\\.0)?)?[ _-]+(?:refresh|access|session)[ _-]+tokens?",
  "personal[ _-]+access[ _-]+tokens?",
  "bearer(?:[ _-]+tokens?)?",
  "api[ _-]+keys?",
  "refresh[ _-]+tokens?",
  "access[ _-]+tokens?",
  "session[ _-]+tokens?",
  "runtime[ _-]+control[ _-]+tokens?",
  "control[ _-]+tokens?",
  "client[ _-]+secrets?",
  "authorization[ _-]+header",
  "passwords?",
  "passphrases?",
  "mnemonic",
  "seed[ _-]+phrases?",
  "recovery[ _-]+(?:phrases?|words)",
  "private[ _-]+keys?",
  "signing[ _-]+keys?",
  "box[ _-]+private[ _-]+keys?",
  "secret[ _-]+keys?",
  "k[ _-]+master",
  "k[ _-]+vault",
  "credentials?",
].join("|");

// Direct-object grammar is intentional. It catches "send your API key" but
// not "send source code for an API key leak audit". The lookahead likewise
// keeps "provide an API key rotation policy" outside the credential request.
const DIRECT_REQUEST = new RegExp(
  `\\b(?:please\\s+)?(?:${REQUEST_VERB})\\b\\s+` +
    `(?:(?:me|us|the[ _-]+seller|this[ _-]+service)\\s+)?` +
    `(?:(?:your|the|an?|my)\\s+)?` +
    `(?:${CREDENTIAL_TERM})` +
    `(?=$|[.,;:!?)]|\\s+(?:to|into|for|so|which|that|because|with|via|or)\\b)`,
  "gi",
);

const REQUIRED_CREDENTIAL = new RegExp(
  `\\b(?:(?:your|the)\\s+)?(?:${CREDENTIAL_TERM})\\b` +
    `(?:\\s+(?:is|are))?\\s+(?:required|needed|mandatory)\\b`,
  "gi",
);

const SECRET_FIELD_NAMES = new Set([
  "agenttool_api_key",
  "agenttool_bearer",
  "agenttool_bearer_token",
  "api_key",
  "apikey",
  "bearer",
  "bearer_token",
  "access_token",
  "refresh_token",
  "session_token",
  "runtime_control_token",
  "control_token",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauth_session_token",
  "github_pat",
  "github_token",
  "github_personal_access_token",
  "personal_access_token",
  "client_secret",
  "authorization",
  "authorization_header",
  "password",
  "passwd",
  "passphrase",
  "mnemonic",
  "seed_phrase",
  "recovery_phrase",
  "recovery_words",
  "private_key",
  "signing_key",
  "signing_private_key",
  "box_private_key",
  "secret_key",
  "k_master",
  "k_vault",
]);

const LIVE_AGENTTOOL_BEARER = /\bat_[A-Za-z0-9_-]{20,}\b/i;
const LIVE_GITHUB_PAT = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/i;
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i;
const MAX_INSPECTION_DEPTH = 32;
const MAX_INSPECTION_NODES = 5_000;
const MAX_INSPECTION_TEXT = 100_000;

export interface CredentialSolicitationViolation {
  reason:
    | "credential_solicitation"
    | "credential_material"
    | "uninspectable_input";
  field: string;
  credential: string;
  do_not_invoke: true;
}

export interface ListingSafetyInput {
  name?: unknown;
  description?: unknown;
  capability_tags?: unknown;
  input_schema?: unknown;
  output_schema?: unknown;
  metadata?: unknown;
}

function normalizedText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(key: string): string {
  return key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function credentialForKey(key: string): string | null {
  const normalized = normalizedKey(key);
  if (SECRET_FIELD_NAMES.has(normalized)) return normalized;
  if (
    normalized.startsWith("agenttool_") &&
    /(?:bearer|api_key|token|private_key)$/.test(normalized)
  ) {
    return normalized;
  }
  if (
    normalized.startsWith("oauth_") &&
    /(?:access|refresh|session)_token$/.test(normalized)
  ) {
    return normalized;
  }
  return null;
}

function requestIsNegated(text: string, requestIndex: number): boolean {
  const prefix = text.slice(Math.max(0, requestIndex - 48), requestIndex);
  return /(?:\bnever|\bdo not|\bdon't|\bmust not|\bshould not)\s+(?:ever\s+)?$/i.test(prefix) ||
    /\bno need to\s+$/i.test(prefix) ||
    /\b(?:do not|don't) need to\s+$/i.test(prefix);
}

function requirementIsNegated(text: string, requirementIndex: number): boolean {
  const prefix = text.slice(Math.max(0, requirementIndex - 12), requirementIndex);
  return /\bno\s+$/i.test(prefix);
}

function inspectText(text: string, field: string): CredentialSolicitationViolation | null {
  const candidate = normalizedText(text);
  const material = candidate.match(LIVE_AGENTTOOL_BEARER) ??
    candidate.match(LIVE_GITHUB_PAT) ??
    candidate.match(PEM_PRIVATE_KEY);
  if (material) {
    const credential = LIVE_AGENTTOOL_BEARER.test(material[0])
      ? "agenttool_bearer"
      : LIVE_GITHUB_PAT.test(material[0])
        ? "github_pat"
        : "private_key";
    return {
      reason: "credential_material",
      field,
      credential,
      do_not_invoke: true,
    };
  }

  DIRECT_REQUEST.lastIndex = 0;
  for (let match = DIRECT_REQUEST.exec(candidate); match; match = DIRECT_REQUEST.exec(candidate)) {
    if (requestIsNegated(candidate, match.index)) continue;
    return {
      reason: "credential_solicitation",
      field,
      credential: match[0].slice(0, 120),
      do_not_invoke: true,
    };
  }

  REQUIRED_CREDENTIAL.lastIndex = 0;
  for (
    let match = REQUIRED_CREDENTIAL.exec(candidate);
    match;
    match = REQUIRED_CREDENTIAL.exec(candidate)
  ) {
    if (requirementIsNegated(candidate, match.index)) continue;
    return {
      reason: "credential_solicitation",
      field,
      credential: match[0].slice(0, 120),
      do_not_invoke: true,
    };
  }
  return null;
}

interface InspectionBudget {
  nodes: number;
  textChars: number;
  text: string[];
}

function inspectionLimit(path: string): CredentialSolicitationViolation {
  return {
    reason: "uninspectable_input",
    field: path,
    credential: "inspection_limit",
    do_not_invoke: true,
  };
}

function inspectValue(
  value: unknown,
  field: string,
  structuralKeys: boolean,
  budget: InspectionBudget,
): CredentialSolicitationViolation | null {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: field, depth: 0 },
  ];

  while (pending.length > 0) {
    const current = pending.pop()!;
    budget.nodes += 1;
    if (
      current.depth > MAX_INSPECTION_DEPTH ||
      budget.nodes > MAX_INSPECTION_NODES
    ) {
      return inspectionLimit(current.path);
    }

    if (typeof current.value === "string") {
      budget.textChars += current.value.length;
      if (budget.textChars > MAX_INSPECTION_TEXT) {
        return inspectionLimit(current.path);
      }
      budget.text.push(current.value);
      const violation = inspectText(current.value, current.path);
      if (violation) return violation;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;

    const entries = Object.entries(current.value as Record<string, unknown>);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nested] = entries[index]!;
      const path = `${current.path}.${key}`;
      if (structuralKeys) {
        const credential = credentialForKey(key);
        if (credential) {
          return {
            reason: "credential_solicitation",
            field: path,
            credential,
            do_not_invoke: true,
          };
        }
      }
      pending.push({ value: nested, path, depth: current.depth + 1 });
    }
  }
  return null;
}

export function findCredentialSolicitation(
  listing: ListingSafetyInput,
): CredentialSolicitationViolation | null {
  const fields: Array<[keyof ListingSafetyInput, boolean]> = [
    ["name", false],
    ["description", false],
    ["capability_tags", false],
    ["input_schema", true],
    ["output_schema", false],
    ["metadata", true],
  ];
  const budget: InspectionBudget = { nodes: 0, textChars: 0, text: [] };
  for (const [field, structuralKeys] of fields) {
    const violation = inspectValue(
      listing[field],
      String(field),
      structuralKeys,
      budget,
    );
    if (violation) return violation;
  }

  // Listings can split a request across fields (for example name="Send" and
  // description="your bearer token"). Inspect the collected text once more
  // as one bounded document after each individual value has passed.
  return inspectText(budget.text.join(" \n "), "listing_text");
}

export function mergeListingSafetyInput(
  existing: ListingSafetyInput,
  patch: ListingSafetyInput,
): ListingSafetyInput {
  return {
    name: patch.name !== undefined ? patch.name : existing.name,
    description:
      patch.description !== undefined ? patch.description : existing.description,
    capability_tags:
      patch.capability_tags !== undefined
        ? patch.capability_tags
        : existing.capability_tags,
    input_schema:
      patch.input_schema !== undefined ? patch.input_schema : existing.input_schema,
    output_schema:
      patch.output_schema !== undefined ? patch.output_schema : existing.output_schema,
    metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
  };
}

export function listingIsSafe(listing: ListingSafetyInput): boolean {
  return findCredentialSolicitation(listing) === null;
}

export function assertListingDoesNotSolicitCredentials(
  listing: ListingSafetyInput,
): void {
  if (findCredentialSolicitation(listing)) {
    throw new Error("credential_solicitation_forbidden");
  }
}

export function filterCredentialSafeListings<T extends ListingSafetyInput>(
  listings: T[],
): { visible: T[]; blocked_count: number } {
  const visible = listings.filter(listingIsSafe);
  return { visible, blocked_count: listings.length - visible.length };
}
