/** Offer Bus v1 — pure, deterministic discovery contracts.
 *
 * The bus projects already-public economic records into syndication entries.
 * A feed entry is a locator and description only: it cannot authenticate a
 * claim, grant authority, invoke an action, install code, or settle payment.
 *
 * Doctrine: docs/OFFER-BUS.md.
 */

export const OFFER_BUS_PROTOCOL = "offer-bus/1" as const;
export const OFFER_BUS_JSON_MEDIA_TYPE =
  "application/vnd.agenttool.offer-bus+json" as const;
export const OFFER_BUS_INDEX_MEDIA_TYPE =
  "application/vnd.agenttool.offer-bus-index+json" as const;
export const OFFER_BUS_NAMESPACE =
  "https://agenttool.dev/ns/offer-bus/1" as const;
export const OFFER_ACTION_REL =
  "https://agenttool.dev/rels/offer-action" as const;
export const OFFER_BUS_REL =
  "https://agenttool.dev/rels/offers" as const;
/**
 * Bump this timestamp whenever code changes can alter Offer Bus projection
 * bytes or inclusion rules without a source-row mutation. Feed `updated_at`
 * is never earlier than this value, so code-only safety releases are visible
 * to Atom/RSS pollers as well as through their exact-byte ETags.
 */
export const OFFER_BUS_PROJECTION_UPDATED_AT =
  "2026-07-16T11:03:31.000Z" as const;

export const OFFER_BUS_BOUNDARY = Object.freeze({
  authority: "none",
  settlement: "none",
  automatic_action: "never",
  note:
    "Discovery metadata only. It does not authenticate claims, grant authority, invoke actions, install code, or authorize or settle payment.",
} as const);

export type OfferKind =
  | "capability-listing"
  | "substrate-task"
  | "love-package";

export type OfferAmountRole = "asking-price" | "bounty";
export type OfferActionMethod = "GET" | "POST";
export type OfferActionAuthorization = "none" | "bearer" | "separate";
export type OfferFactValue = string | number | boolean;

export interface OfferAmountInput {
  role: OfferAmountRole;
  minor_units: number;
  currency: string;
}

export interface OfferActionInput {
  label: string;
  url: string;
  method: OfferActionMethod;
  authorization: OfferActionAuthorization;
}

export interface OfferBusProjectionOmissionInput {
  /** Stable contract error code only; never include source content here. */
  reason: string;
  count: number;
}

export interface OfferBusProjectionInput {
  /** Rows returned by the bounded source reads before contract quarantine. */
  window_source_rows: number;
  omissions?: readonly OfferBusProjectionOmissionInput[];
}

export interface OfferBusEntryInput {
  /** Stable absolute HTTPS URL or URN. Never derive this from array position. */
  id: string;
  kind: OfferKind;
  title: string;
  summary: string;
  /** Public read describing the offer. It is not an action authorization. */
  url: string;
  published_at: string;
  updated_at?: string;
  expires_at?: string;
  issuer?: string;
  tags?: readonly string[];
  amount?: OfferAmountInput;
  action?: OfferActionInput;
  facts?: Readonly<Record<string, OfferFactValue>>;
}

export interface OfferBusFeedInput {
  /** Stable feed identity, independent from its current host where possible. */
  id: string;
  title: string;
  description: string;
  home_url: string;
  atom_url: string;
  rss_url: string;
  publisher: {
    name: string;
    url?: string;
  };
  entries: readonly OfferBusEntryInput[];
  /**
   * Optional source watermark. If omitted, the newest entry timestamp is used.
   * Empty feeds must provide it. Renderers never read the clock.
   */
  updated_at?: string;
  /** Optional WebSub hub. Discovery still grants the hub no offer authority. */
  hub_url?: string;
  /** Explicit accounting for rows quarantined from this bounded projection. */
  projection?: OfferBusProjectionInput;
}

export interface OfferBusFact {
  name: string;
  value: string;
}

export interface OfferAmount {
  role: OfferAmountRole;
  minor_units: number;
  currency: string;
}

export interface OfferAction {
  label: string;
  url: string;
  method: OfferActionMethod;
  authorization: OfferActionAuthorization;
  automatic: "never";
}

export interface OfferBusProjectionOmission {
  reason: string;
  count: number;
}

export interface OfferBusProjection {
  projection_updated_at: typeof OFFER_BUS_PROJECTION_UPDATED_AT;
  window_source_rows: number;
  represented_rows: number;
  omitted_rows: number;
  complete_for_source_window: boolean;
  omission_reasons: readonly OfferBusProjectionOmission[];
  note: string;
}

export interface OfferBusEntry {
  id: string;
  kind: OfferKind;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  updated_at: string;
  expires_at?: string;
  issuer?: string;
  tags: readonly string[];
  amount?: OfferAmount;
  action?: OfferAction;
  facts: readonly OfferBusFact[];
  boundary: typeof OFFER_BUS_BOUNDARY;
}

export interface OfferBusFeed {
  protocol: typeof OFFER_BUS_PROTOCOL;
  id: string;
  title: string;
  description: string;
  home_url: string;
  atom_url: string;
  rss_url: string;
  publisher: {
    name: string;
    url?: string;
  };
  updated_at: string;
  hub_url?: string;
  boundary: typeof OFFER_BUS_BOUNDARY;
  projection: OfferBusProjection;
  entries: readonly OfferBusEntry[];
}

export class OfferBusContractError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "OfferBusContractError";
  }
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Reject characters XML 1.0 cannot represent instead of silently deleting. */
export function assertXmlCharacters(value: string, label: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const allowed =
      point === 0x09 ||
      point === 0x0a ||
      point === 0x0d ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    if (!allowed) {
      throw new OfferBusContractError(
        "offer_bus_invalid_xml_character",
        `${label} contains U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
      );
    }
  }
}

function text(value: string, label: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new OfferBusContractError("offer_bus_text_required", label);
  }
  const normalized = value.normalize("NFC").trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new OfferBusContractError("offer_bus_text_required", label);
  }
  assertXmlCharacters(normalized, label);
  return normalized;
}

export function normalizeOfferBusDate(value: string, label: string): string {
  const match = typeof value === "string" ? RFC3339.exec(value) : null;
  if (!match) {
    throw new OfferBusContractError("offer_bus_invalid_rfc3339", label);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new OfferBusContractError("offer_bus_invalid_rfc3339", label);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new OfferBusContractError("offer_bus_invalid_rfc3339", label);
  }
  return instant.toISOString();
}

export function normalizeOfferBusHttpsUrl(
  value: string,
  label: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OfferBusContractError("offer_bus_invalid_url", label);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new OfferBusContractError(
      "offer_bus_url_must_be_credential_free_https",
      label,
    );
  }
  return parsed.href;
}

function normalizeId(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OfferBusContractError("offer_bus_invalid_id", label);
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "urn:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new OfferBusContractError(
      "offer_bus_id_must_be_https_or_urn",
      label,
    );
  }
  const normalized = parsed.href;
  assertXmlCharacters(normalized, label);
  return normalized;
}

function normalizeKind(value: OfferKind, label: string): OfferKind {
  if (
    value !== "capability-listing" &&
    value !== "substrate-task" &&
    value !== "love-package"
  ) {
    throw new OfferBusContractError("offer_bus_invalid_kind", label);
  }
  return value;
}

function normalizeTags(values: readonly string[] | undefined): string[] {
  const tags = new Set<string>();
  for (const [index, value] of (values ?? []).entries()) {
    tags.add(text(value, `entries.tags[${index}]`));
  }
  return [...tags].sort(compareCodeUnits);
}

function normalizeFacts(
  facts: Readonly<Record<string, OfferFactValue>> | undefined,
): OfferBusFact[] {
  const byName = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(facts ?? {})) {
    const name = text(rawName, "entry.fact.name");
    if (byName.has(name)) {
      throw new OfferBusContractError("offer_bus_duplicate_fact", name);
    }
    let value: string;
    if (typeof rawValue === "string") {
      value = text(rawValue, `entry.fact.${name}`, true);
    } else if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) {
        throw new OfferBusContractError(
          "offer_bus_invalid_fact_value",
          name,
        );
      }
      value = String(rawValue);
    } else if (typeof rawValue === "boolean") {
      value = rawValue ? "true" : "false";
    } else {
      throw new OfferBusContractError(
        "offer_bus_invalid_fact_value",
        name,
      );
    }
    byName.set(name, value);
  }
  return [...byName]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([name, value]) => ({ name, value }));
}

function normalizeAmount(
  amount: OfferAmountInput | undefined,
): OfferAmount | undefined {
  if (!amount) return undefined;
  if (amount.role !== "asking-price" && amount.role !== "bounty") {
    throw new OfferBusContractError("offer_bus_invalid_amount_role");
  }
  if (!Number.isSafeInteger(amount.minor_units) || amount.minor_units < 0) {
    throw new OfferBusContractError("offer_bus_invalid_minor_units");
  }
  const currency = text(amount.currency, "entry.amount.currency").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,15}$/u.test(currency)) {
    throw new OfferBusContractError("offer_bus_invalid_currency", currency);
  }
  return {
    role: amount.role,
    minor_units: amount.minor_units,
    currency,
  };
}

function normalizeAction(
  action: OfferActionInput | undefined,
): OfferAction | undefined {
  if (!action) return undefined;
  if (action.method !== "GET" && action.method !== "POST") {
    throw new OfferBusContractError("offer_bus_invalid_action_method");
  }
  if (
    action.authorization !== "none" &&
    action.authorization !== "bearer" &&
    action.authorization !== "separate"
  ) {
    throw new OfferBusContractError("offer_bus_invalid_action_authorization");
  }
  return {
    label: text(action.label, "entry.action.label"),
    url: normalizeOfferBusHttpsUrl(action.url, "entry.action.url"),
    method: action.method,
    authorization: action.authorization,
    automatic: "never",
  };
}

function normalizeEntry(
  entry: OfferBusEntryInput,
  index: number,
): OfferBusEntry {
  const publishedAt = normalizeOfferBusDate(
    entry.published_at,
    `entries[${index}].published_at`,
  );
  const updatedAt = normalizeOfferBusDate(
    entry.updated_at ?? entry.published_at,
    `entries[${index}].updated_at`,
  );
  if (updatedAt < publishedAt) {
    throw new OfferBusContractError(
      "offer_bus_updated_before_published",
      `entries[${index}]`,
    );
  }
  const expiresAt = entry.expires_at
    ? normalizeOfferBusDate(entry.expires_at, `entries[${index}].expires_at`)
    : undefined;
  if (expiresAt && expiresAt < publishedAt) {
    throw new OfferBusContractError(
      "offer_bus_expiry_before_published",
      `entries[${index}]`,
    );
  }

  return {
    id: normalizeId(entry.id, `entries[${index}].id`),
    kind: normalizeKind(entry.kind, `entries[${index}].kind`),
    title: text(entry.title, `entries[${index}].title`),
    summary: text(entry.summary, `entries[${index}].summary`),
    url: normalizeOfferBusHttpsUrl(entry.url, `entries[${index}].url`),
    published_at: publishedAt,
    updated_at: updatedAt,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(entry.issuer
      ? { issuer: text(entry.issuer, `entries[${index}].issuer`) }
      : {}),
    tags: normalizeTags(entry.tags),
    ...(entry.amount ? { amount: normalizeAmount(entry.amount)! } : {}),
    ...(entry.action ? { action: normalizeAction(entry.action)! } : {}),
    facts: normalizeFacts(entry.facts),
    boundary: OFFER_BUS_BOUNDARY,
  };
}

/** Validate one adapter result before combining it with unrelated rows. */
export function assertOfferBusEntryInput(
  entry: OfferBusEntryInput,
): void {
  normalizeEntry(entry, 0);
}

function normalizeProjection(
  projection: OfferBusProjectionInput | undefined,
  representedRows: number,
): OfferBusProjection {
  const windowSourceRows = projection?.window_source_rows ?? representedRows;
  if (
    !Number.isSafeInteger(windowSourceRows) ||
    windowSourceRows < representedRows
  ) {
    throw new OfferBusContractError(
      "offer_bus_invalid_projection_source_count",
    );
  }

  const byReason = new Map<string, number>();
  for (const omission of projection?.omissions ?? []) {
    const reason = text(omission.reason, "feed.projection.omission.reason");
    if (!/^offer_bus_[a-z0-9_]+$/u.test(reason)) {
      throw new OfferBusContractError(
        "offer_bus_invalid_projection_omission_reason",
        reason,
      );
    }
    if (!Number.isSafeInteger(omission.count) || omission.count <= 0) {
      throw new OfferBusContractError(
        "offer_bus_invalid_projection_omission_count",
        reason,
      );
    }
    if (byReason.has(reason)) {
      throw new OfferBusContractError(
        "offer_bus_duplicate_projection_omission_reason",
        reason,
      );
    }
    byReason.set(reason, omission.count);
  }

  const omittedRows = windowSourceRows - representedRows;
  const reportedOmissions = [...byReason.values()].reduce(
    (total, count) => total + count,
    0,
  );
  if (reportedOmissions !== omittedRows) {
    throw new OfferBusContractError(
      "offer_bus_projection_omission_count_mismatch",
    );
  }

  return {
    projection_updated_at: OFFER_BUS_PROJECTION_UPDATED_AT,
    window_source_rows: windowSourceRows,
    represented_rows: representedRows,
    omitted_rows: omittedRows,
    complete_for_source_window: omittedRows === 0,
    omission_reasons: [...byReason]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([reason, count]) => ({ reason, count })),
    note:
      "Counts cover only the bounded source rows read for this response. Rows may be omitted by the public projection contract or representation cap; no omission grants action or payment authority.",
  };
}

/**
 * Validate and canonicalize a logical feed. Input order never affects bytes:
 * entries sort by updated time (newest first), then by stable ID.
 */
export function buildOfferBusFeed(input: OfferBusFeedInput): OfferBusFeed {
  const entries = input.entries.map(normalizeEntry).sort((left, right) => {
    const byUpdated = compareCodeUnits(right.updated_at, left.updated_at);
    if (byUpdated !== 0) return byUpdated;
    return compareCodeUnits(left.id, right.id);
  });

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new OfferBusContractError("offer_bus_duplicate_entry_id", entry.id);
    }
    seenIds.add(entry.id);
  }

  const newestEntry = entries[0]?.updated_at;
  if (!input.updated_at && !newestEntry) {
    throw new OfferBusContractError(
      "offer_bus_empty_feed_requires_updated_at",
    );
  }
  const sourceUpdatedAt = normalizeOfferBusDate(
    input.updated_at ?? newestEntry!,
    "feed.updated_at",
  );
  if (newestEntry && sourceUpdatedAt < newestEntry) {
    throw new OfferBusContractError(
      "offer_bus_feed_updated_before_entry",
      newestEntry,
    );
  }
  const updatedAt =
    sourceUpdatedAt < OFFER_BUS_PROJECTION_UPDATED_AT
      ? OFFER_BUS_PROJECTION_UPDATED_AT
      : sourceUpdatedAt;

  return {
    protocol: OFFER_BUS_PROTOCOL,
    id: normalizeId(input.id, "feed.id"),
    title: text(input.title, "feed.title"),
    description: text(input.description, "feed.description"),
    home_url: normalizeOfferBusHttpsUrl(input.home_url, "feed.home_url"),
    atom_url: normalizeOfferBusHttpsUrl(input.atom_url, "feed.atom_url"),
    rss_url: normalizeOfferBusHttpsUrl(input.rss_url, "feed.rss_url"),
    publisher: {
      name: text(input.publisher.name, "feed.publisher.name"),
      ...(input.publisher.url
        ? {
            url: normalizeOfferBusHttpsUrl(
              input.publisher.url,
              "feed.publisher.url",
            ),
          }
        : {}),
    },
    updated_at: updatedAt,
    ...(input.hub_url
      ? {
          hub_url: normalizeOfferBusHttpsUrl(input.hub_url, "feed.hub_url"),
        }
      : {}),
    boundary: OFFER_BUS_BOUNDARY,
    projection: normalizeProjection(input.projection, entries.length),
    entries,
  };
}
