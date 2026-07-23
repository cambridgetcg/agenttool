import {
  PLAN_PROFILE,
  YUTABASE_BOOK,
  YUTABASE_DECKS,
  YUTABASE_LEXICON,
} from "@agenttool/correspondence-yutabase";

export const PROJECTOR_SCHEMA = "agenttool_yutabase" as const;
export const PROJECTOR_SCHEMA_VERSION = 1 as const;
export const PROJECTOR_PROFILE =
  "agenttool-correspondence-yutabase-projector/v0.1" as const;
export const PROJECTOR_RUNTIME_ROLE =
  "agenttool_yutabase_projector" as const;
export const SOURCE_SCOPE = "project_private" as const;

export const YUTABASE_IDENTITY = Object.freeze({
  standard: "YUTABASE",
  profile: "postgres",
  version: "0.1.0-candidate.1",
  revision: 4,
});

export const REQUIRED_CAPABILITIES = Object.freeze([
  "row-claims",
  "logical-physical-registry",
  "word-version-pinning",
  "global-thread-id-ledger",
  "endpoint-existence-on-insert",
  "concurrency-safe-to-one",
  "role-scoped-functions",
]);

const PHYSICAL_TABLES = Object.freeze({
  events: "event_cards",
  identities: "identity_cards",
  signing_keys: "signing_key_cards",
  repositories: "repository_cards",
  coordination_threads: "coordination_thread_cards",
  receipts: "receipt_cards",
  artifacts: "artifact_cards",
});

export const EXPECTED_REGISTRY = Object.freeze(
  YUTABASE_DECKS.map((deck) =>
    Object.freeze({
      book: YUTABASE_BOOK,
      deck,
      physical_schema: PROJECTOR_SCHEMA,
      physical_table: PHYSICAL_TABLES[deck],
      id_col: "id",
      at_col: "at",
      by_col: "by",
      how_col: "how",
      src_col: "src",
      native: true,
      ttl: null,
    }),
  ),
);

export {
  PLAN_PROFILE,
  YUTABASE_BOOK,
  YUTABASE_DECKS,
  YUTABASE_LEXICON,
};
