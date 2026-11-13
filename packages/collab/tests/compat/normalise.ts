import { canonicalJson } from "../../src/canonical.js";

/**
 * Normalisation for the golden comparison (spec 8.5). Two runs of the same
 * scenario differ only where the store draws randomness or reads a clock the
 * test cannot inject; everything else must match byte for byte.
 */

/** Ids minted with randomUUID: `report_<uuid>`, `session_<uuid>`, and so on. */
const UUID_ID = /\b([a-z][a-z_]*?)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;

/** Hashes over bytes that contain random ids, so they differ whenever the ids do. */
const ID_DERIVED_HASH_KEYS = new Set(["proposal_sha256"]);

/**
 * Arrays the store sorts by a random id. Once ids become placeholders their
 * order says nothing, so they compare as multisets.
 */
const ID_ORDERED_ARRAY_KEYS = new Set(["voices", "live_session_ids"]);

/**
 * Wall-clock readings the injected clock does not reach: repository checkpoints
 * stamp `captured_at` with `new Date()` (src/repository.ts).
 */
const WALL_CLOCK_KEYS = new Set(["captured_at"]);

export interface EventRow {
  protocol: string;
  type: string;
  entity_id: string;
  actor: string;
  session_id: string | null;
  occurred_at: string;
  payload_json: string;
}

/** Placeholders numbered by first appearance, shared by every value of one journal. */
export class Placeholders {
  private readonly ids = new Map<string, string>();
  private readonly hashes = new Map<string, string>();

  text(value: string): string {
    return value.replace(UUID_ID, (match, prefix: string) => {
      let placeholder = this.ids.get(match);
      if (!placeholder) {
        placeholder = `${prefix}#${this.ids.size + 1}`;
        this.ids.set(match, placeholder);
      }
      return placeholder;
    });
  }

  hash(value: string): string {
    let placeholder = this.hashes.get(value);
    if (!placeholder) {
      placeholder = `sha256#${this.hashes.size + 1}`;
      this.hashes.set(value, placeholder);
    }
    return placeholder;
  }

  value(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
      if (key && WALL_CLOCK_KEYS.has(key)) return "<wall-clock>";
      if (key && ID_DERIVED_HASH_KEYS.has(key) && /^[0-9a-f]{64}$/.test(value)) return this.hash(value);
      return this.text(value);
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => this.value(item));
      return key && ID_ORDERED_ARRAY_KEYS.has(key)
        ? items.map((item) => canonicalJson(item)).sort().map((item) => JSON.parse(item) as unknown)
        : items;
    }
    if (value !== null && typeof value === "object") {
      // Visit keys in canonical order, so "first appearance" is the same in every build.
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      return Object.fromEntries(entries.map(([childKey, child]) => [childKey, this.value(child, childKey)]));
    }
    return value;
  }
}

/** One canonical line per event, as the golden comparison reads it. */
export function normaliseEvents(rows: EventRow[], placeholders = new Placeholders()): string[] {
  return rows.map((row) => canonicalJson(placeholders.value({
    protocol: row.protocol,
    type: row.type,
    entity_id: row.entity_id,
    actor: row.actor,
    session_id: row.session_id,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload_json) as unknown,
  })));
}
