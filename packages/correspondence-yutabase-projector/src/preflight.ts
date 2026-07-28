import { createHash } from "node:crypto";

import type { TargetConfig } from "./config.js";
import {
  EXPECTED_REGISTRY,
  PLAN_PROFILE,
  PROJECTOR_PROFILE,
  PROJECTOR_RUNTIME_ROLE,
  PROJECTOR_SCHEMA,
  PROJECTOR_SCHEMA_VERSION,
  REQUIRED_CAPABILITIES,
  YUTABASE_IDENTITY,
  YUTABASE_LEXICON,
} from "./constants.js";
import {
  databaseErrorCode,
  isTransientDatabaseError,
  transactionWithRetry,
  type Database,
  type Transaction,
} from "./database.js";
import { ProjectorError } from "./errors.js";
import { INSTALL_SQL } from "./schema.js";

type Executor = Transaction;

interface RoleDefinition extends Record<string, unknown> {
  readonly rolcanlogin: boolean;
  readonly rolinherit: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
}

interface RoleMembership extends Record<string, unknown> {
  readonly rolname: string;
  readonly admin_option: boolean;
  readonly inherit_option: boolean;
  readonly set_option: boolean;
}

const CARD_TABLES = [
  "event_cards",
  "identity_cards",
  "signing_key_cards",
  "repository_cards",
  "coordination_thread_cards",
  "receipt_cards",
  "artifact_cards",
] as const;

const EXPECTED_COLUMNS = {
  installation: [
    ["singleton", "bool", "NO"],
    ["schema_version", "int4", "NO"],
    ["projector_profile", "text", "NO"],
    ["plan_profile", "text", "NO"],
    ["yutabase_standard", "text", "NO"],
    ["yutabase_profile", "text", "NO"],
    ["yutabase_version", "text", "NO"],
    ["yutabase_revision", "int4", "NO"],
    ["local_environment", "bool", "NO"],
    ["bound_source_origin", "text", "YES"],
    ["installed_at", "timestamptz", "NO"],
    ["installed_by", "text", "NO"],
  ],
  event_cards: [
    ["id", "uuid", "NO"],
    ["materialization", "text", "NO"],
    ["source_event_id", "text", "NO"],
    ["protocol", "text", "YES"],
    ["project_id", "uuid", "YES"],
    ["kind", "text", "YES"],
    ["issued_at", "timestamptz", "YES"],
    ["session_seq", "int8", "YES"],
    ["device_id", "uuid", "YES"],
    ["session_id", "uuid", "YES"],
    ["parent_count", "int4", "YES"],
    ["scope_path_count", "int4", "YES"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  identity_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["source_identity_id", "uuid", "NO"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  signing_key_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["source_identity_id", "uuid", "NO"],
    ["source_signing_key_id", "uuid", "NO"],
    ["verified_public_key_sha256", "text", "NO"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  repository_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["source_repository_id", "text", "NO"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  coordination_thread_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["source_repository_id", "text", "NO"],
    ["source_thread_id", "text", "NO"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  receipt_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["source_event_id", "text", "NO"],
    ["received_seq", "int8", "NO"],
    ["received_at", "timestamptz", "NO"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  artifact_cards: [
    ["id", "uuid", "NO"],
    ["project_id", "uuid", "NO"],
    ["artifact_kind", "text", "NO"],
    ["revision", "text", "YES"],
    ["digest", "text", "YES"],
    ["at", "timestamptz", "NO"],
    ["by", "text", "NO"],
    ["how", "text", "NO"],
    ["src", "_text", "NO"],
  ],
  projection_checkpoints: [
    ["source_origin", "text", "NO"],
    ["source_project_id", "uuid", "NO"],
    ["source_repository_id", "text", "NO"],
    ["plan_profile", "text", "NO"],
    ["last_received_seq", "int8", "NO"],
    ["last_event_id", "text", "YES"],
    ["state", "text", "NO"],
    ["last_poll_at", "timestamptz", "YES"],
    ["caught_up_at", "timestamptz", "YES"],
    ["last_success_at", "timestamptz", "YES"],
    ["last_error_at", "timestamptz", "YES"],
    ["last_error_code", "text", "YES"],
  ],
  applied_events: [
    ["source_origin", "text", "NO"],
    ["source_project_id", "uuid", "NO"],
    ["source_repository_id", "text", "NO"],
    ["source_event_id", "text", "NO"],
    ["received_seq", "int8", "NO"],
    ["received_at", "timestamptz", "NO"],
    ["canonical_sha512", "text", "NO"],
    ["verified_key_id", "uuid", "NO"],
    ["verified_public_key_sha256", "text", "NO"],
    ["card_count", "int4", "NO"],
    ["relation_count", "int4", "NO"],
    ["projected_at", "timestamptz", "NO"],
  ],
  quarantines: [
    ["id", "int8", "NO"],
    ["source_origin", "text", "NO"],
    ["source_project_id", "uuid", "NO"],
    ["source_repository_id", "text", "NO"],
    ["plan_profile", "text", "NO"],
    ["source_event_id", "text", "YES"],
    ["received_seq", "int8", "YES"],
    ["fingerprint", "text", "NO"],
    ["code", "text", "NO"],
    ["first_seen_at", "timestamptz", "NO"],
    ["last_seen_at", "timestamptz", "NO"],
    ["occurrences", "int4", "NO"],
  ],
} as const;

const EXPECTED_TABLES = Object.keys(EXPECTED_COLUMNS);

const EXPECTED_UNIQUE_KEYS = {
  installation: [["singleton"]],
  event_cards: [["id"], ["source_event_id"]],
  identity_cards: [["id"], ["project_id", "source_identity_id"]],
  signing_key_cards: [["id"], ["project_id", "source_signing_key_id"]],
  repository_cards: [["id"], ["project_id", "source_repository_id"]],
  coordination_thread_cards: [
    ["id"],
    ["project_id", "source_repository_id", "source_thread_id"],
  ],
  receipt_cards: [
    ["id"],
    ["project_id", "source_event_id", "received_seq"],
    ["project_id", "received_seq"],
  ],
  artifact_cards: [
    ["id"],
    ["project_id", "artifact_kind", "revision"],
    ["project_id", "artifact_kind", "digest"],
  ],
  projection_checkpoints: [
    [
      "source_origin",
      "source_project_id",
      "source_repository_id",
      "plan_profile",
    ],
  ],
  applied_events: [
    [
      "source_origin",
      "source_project_id",
      "source_repository_id",
      "source_event_id",
    ],
    [
      "source_origin",
      "source_project_id",
      "source_repository_id",
      "received_seq",
    ],
  ],
  quarantines: [
    ["id"],
    [
      "source_origin",
      "source_project_id",
      "source_repository_id",
      "plan_profile",
      "fingerprint",
      "code",
    ],
  ],
} as const;

const EXPECTED_PRIMARY_KEYS = {
  installation: ["singleton"],
  event_cards: ["id"],
  identity_cards: ["id"],
  signing_key_cards: ["id"],
  repository_cards: ["id"],
  coordination_thread_cards: ["id"],
  receipt_cards: ["id"],
  artifact_cards: ["id"],
  projection_checkpoints: [
    "source_origin",
    "source_project_id",
    "source_repository_id",
    "plan_profile",
  ],
  applied_events: [
    "source_origin",
    "source_project_id",
    "source_repository_id",
    "source_event_id",
  ],
  quarantines: ["id"],
} as const;

const EXPECTED_CHECK_CONSTRAINTS = {
  installation: [
    "installation_claimant_nonempty",
    "installation_local_only",
    "installation_singleton_true",
  ],
  event_cards: [
    "event_cards_claimant_nonempty",
    "event_cards_how_cached",
    "event_cards_materialization",
    "event_cards_materialization_shape",
    "event_cards_source_event_id",
    "event_cards_sources_nonempty",
  ],
  identity_cards: [
    "identity_cards_claimant_nonempty",
    "identity_cards_how_cached",
    "identity_cards_sources_nonempty",
  ],
  signing_key_cards: [
    "signing_key_cards_claimant_nonempty",
    "signing_key_cards_how_cached",
    "signing_key_cards_public_key_sha256",
    "signing_key_cards_sources_nonempty",
  ],
  repository_cards: [
    "repository_cards_claimant_nonempty",
    "repository_cards_how_cached",
    "repository_cards_sources_nonempty",
  ],
  coordination_thread_cards: [
    "coordination_thread_cards_claimant_nonempty",
    "coordination_thread_cards_how_cached",
    "coordination_thread_cards_sources_nonempty",
  ],
  receipt_cards: [
    "receipt_cards_claimant_nonempty",
    "receipt_cards_how_cached",
    "receipt_cards_sequence_positive",
    "receipt_cards_source_event_id",
    "receipt_cards_sources_nonempty",
  ],
  artifact_cards: [
    "artifact_cards_claimant_nonempty",
    "artifact_cards_how_cached",
    "artifact_cards_identity_shape",
    "artifact_cards_kind",
    "artifact_cards_sources_nonempty",
  ],
  projection_checkpoints: [
    "projection_checkpoints_event_id",
    "projection_checkpoints_sequence_nonnegative",
    "projection_checkpoints_state",
  ],
  applied_events: [
    "applied_events_canonical_sha512",
    "applied_events_card_count_nonnegative",
    "applied_events_public_key_sha256",
    "applied_events_relation_count_nonnegative",
    "applied_events_sequence_positive",
    "applied_events_source_event_id",
  ],
  quarantines: [
    "quarantines_code_nonempty",
    "quarantines_fingerprint",
    "quarantines_occurrences_positive",
    "quarantines_sequence_positive",
    "quarantines_source_event_id",
  ],
} as const;

const OPERATIONAL_TABLES = [
  "installation",
  "projection_checkpoints",
  "applied_events",
  "quarantines",
] as const;

const INSERT_TABLES = new Set<string>([
  ...CARD_TABLES,
  "projection_checkpoints",
  "applied_events",
  "quarantines",
]);

const UPDATE_COLUMNS = new Set<string>([
  "installation.bound_source_origin",
  "event_cards.materialization",
  "event_cards.protocol",
  "event_cards.project_id",
  "event_cards.kind",
  "event_cards.issued_at",
  "event_cards.session_seq",
  "event_cards.device_id",
  "event_cards.session_id",
  "event_cards.parent_count",
  "event_cards.scope_path_count",
  "event_cards.at",
  "event_cards.by",
  "event_cards.how",
  "event_cards.src",
  "projection_checkpoints.last_received_seq",
  "projection_checkpoints.last_event_id",
  "projection_checkpoints.state",
  "projection_checkpoints.last_poll_at",
  "projection_checkpoints.caught_up_at",
  "projection_checkpoints.last_success_at",
  "projection_checkpoints.last_error_at",
  "projection_checkpoints.last_error_code",
  "quarantines.last_seen_at",
  "quarantines.occurrences",
]);

const CHECK_CONSTRAINT_MANIFEST_SHA256 =
  "788f2f97facd8f14a0e5d89f1151753769aaa27b46b9cde66dfea17b0c715170";

const YUTABASE_FUNCTION_SIGNATURES = Object.freeze([
  "yu._begin_word_insert()",
  "yu._begin_word_version()",
  "yu._capture_word_version()",
  "yu._card_exists(text,text,uuid)",
  "yu._card_lock_key(text,text,uuid)",
  "yu._deck_matches(text,text,text)",
  "yu._guard_delete()",
  "yu._lock_thread_context(text,text,text,uuid,text,text,uuid)",
  "yu._refuse_sever_log_mutation()",
  "yu._refuse_thread_mutation()",
  "yu._refuse_word_version_mutation()",
  "yu._registry_referenced_ids(text,text)",
  "yu._reserve_thread_id()",
  "yu._validate_registry_mapping()",
  "yu._validate_thread()",
  "yu._version_gloss()",
  "yu.doctor()",
  "yu.refresh_via()",
  "yu.sever(uuid,text,text,text[])",
  "yu.stale()",
  "yu._guard_truncate()",
  "yu._maintain_registry_guard()",
  "yu._nonblank_text(text)",
  "yu._lock_registry_mapping(text,text)",
  "yu._source_locators_valid(text[])",
]);

const YUTABASE_FUNCTION_DEFINITION_FINGERPRINT =
  "4393bda5bb321f1a18cf4bdbbbd34519";

const YUTABASE_CAPABILITY_ROLES = Object.freeze([
  "yu_reader",
  "yu_appender",
  "yu_writer",
  "yu_lexicographer",
]);

const YUTABASE_INTERNAL_MEMBERSHIPS = Object.freeze([
  ["yu_reader", "yu_appender"],
  ["yu_reader", "yu_writer"],
  ["yu_reader", "yu_lexicographer"],
] as const);

const YUTABASE_RELATION_PRIVILEGES = Object.freeze([
  ["yu", "threads", "yu_writer", "INSERT"],
  ["yu", "threads", "yu_appender", "INSERT"],
  ["yu", "lexicon", "yu_lexicographer", "INSERT"],
  ["yu", "lexicon", "yu_lexicographer", "UPDATE"],
  ["yu", "registry", "yu_lexicographer", "INSERT"],
  ["yu", "registry", "yu_lexicographer", "UPDATE"],
  ["yu", "registry", "yu_lexicographer", "DELETE"],
] as const);

const YUTABASE_FUNCTION_PRIVILEGES = Object.freeze([
  ["yu._card_exists(text,text,uuid)", "yu_reader", "EXECUTE"],
  ["yu.stale()", "yu_reader", "EXECUTE"],
  ["yu.doctor()", "yu_reader", "EXECUTE"],
  [
    "yu._lock_thread_context(text,text,text,uuid,text,text,uuid)",
    "yu_writer",
    "EXECUTE",
  ],
  ["yu.sever(uuid,text,text,text[])", "yu_writer", "EXECUTE"],
  [
    "yu._registry_referenced_ids(text,text)",
    "yu_lexicographer",
    "EXECUTE",
  ],
  ["yu.refresh_via()", "yu_lexicographer", "EXECUTE"],
  [
    "yu._lock_thread_context(text,text,text,uuid,text,text,uuid)",
    "yu_appender",
    "EXECUTE",
  ],
  ["yu._lock_registry_mapping(text,text)", "yu_reader", "EXECUTE"],
  ["yu._guard_delete()", "yu_lexicographer", "EXECUTE"],
  ["yu._guard_truncate()", "yu_lexicographer", "EXECUTE"],
  ["yu._nonblank_text(text)", "PUBLIC", "EXECUTE"],
  ["yu._source_locators_valid(text[])", "PUBLIC", "EXECUTE"],
] as const);

const EVENT_UPDATE_BODY = `
BEGIN
  IF OLD.materialization = 'reference_only'
     AND NEW.materialization = 'metadata'
     AND NEW.id = OLD.id
     AND NEW.source_event_id = OLD.source_event_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PROJECTOR CARD IMMUTABLE'
    USING ERRCODE = 'check_violation';
END;
`;

const REFUSE_MUTATION_BODY = `
BEGIN
  RAISE EXCEPTION 'PROJECTOR CARD IMMUTABLE'
    USING ERRCODE = 'check_violation';
END;
`;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sameArray(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function preflightRegistryMappingLockFunction(
  sql: Executor,
): Promise<void> {
  const rows = await sql`
    SELECT
      mapping_lock.prokind = 'f' AS is_function,
      mapping_lock.proowner = core_owner.proowner AS owner_matches,
      language.lanname = 'sql' AS language_matches,
      mapping_lock.prosecdef AS security_definer,
      mapping_lock.provolatile = 'v' AS volatile,
      mapping_lock.proparallel = 'u' AS parallel_unsafe,
      mapping_lock.proconfig IS NOT DISTINCT FROM ARRAY[
        'search_path=pg_catalog, yu, pg_temp',
        'row_security=off'
      ]::text[] AS config_matches,
      pg_catalog.pg_get_function_result(mapping_lock.oid) =
        'TABLE(physical_schema text, physical_table text, id_col text, at_col text, by_col text, how_col text, src_col text)'
        AS result_matches,
      (
        SELECT count(*) = 2
          AND count(*) FILTER (
            WHERE mapping_acl.grantor = mapping_lock.proowner
              AND mapping_acl.grantee = mapping_lock.proowner
              AND mapping_acl.privilege_type = 'EXECUTE'
              AND NOT mapping_acl.is_grantable
          ) = 1
          AND count(*) FILTER (
            WHERE mapping_acl.grantor = mapping_lock.proowner
              AND mapping_acl.grantee = reader_role.oid
              AND mapping_acl.privilege_type = 'EXECUTE'
              AND NOT mapping_acl.is_grantable
          ) = 1
        FROM pg_catalog.aclexplode(
          coalesce(
            mapping_lock.proacl,
            pg_catalog.acldefault('f', mapping_lock.proowner)
          )
        ) AS mapping_acl
      ) AS acl_matches
    FROM pg_catalog.pg_proc mapping_lock
    JOIN pg_catalog.pg_language language
      ON language.oid = mapping_lock.prolang
    CROSS JOIN LATERAL (
      SELECT owner_function.proowner
      FROM pg_catalog.pg_proc owner_function
      WHERE owner_function.oid = to_regprocedure('yu.refresh_via()')
    ) AS core_owner
    CROSS JOIN LATERAL (
      SELECT role.oid
      FROM pg_catalog.pg_roles role
      WHERE role.rolname = 'yu_reader'
    ) AS reader_role
    WHERE mapping_lock.oid =
          to_regprocedure('yu._lock_registry_mapping(text,text)')
  ` as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.is_function !== true ||
    row.owner_matches !== true ||
    row.language_matches !== true ||
    row.security_definer !== true ||
    row.volatile !== true ||
    row.parallel_unsafe !== true ||
    row.config_matches !== true ||
    row.result_matches !== true ||
    row.acl_matches !== true
  ) {
    throw new ProjectorError("yutabase_incompatible");
  }
}

async function preflightYutabaseFunctionSurface(
  sql: Executor,
): Promise<void> {
  const rows = await sql`
    WITH expected(signature) AS (
      SELECT unnest(${[...YUTABASE_FUNCTION_SIGNATURES]}::text[])
    ),
    expected_owner AS (
      SELECT function_object.proowner
      FROM pg_catalog.pg_proc function_object
      WHERE function_object.oid = to_regprocedure('yu.refresh_via()')
    ),
    definition_surface AS (
      SELECT pg_catalog.format(
        '%s|%s|%s|%s|%s|%s',
        expected.signature,
        function_object.prosecdef,
        function_object.provolatile,
        function_object.proparallel,
        coalesce(
          pg_catalog.array_to_string(function_object.proconfig, ','),
          ''
        ),
        pg_catalog.md5(
          pg_catalog.pg_get_functiondef(function_object.oid)
        )
      ) AS item
      FROM expected
      LEFT JOIN pg_catalog.pg_proc function_object
        ON function_object.oid = to_regprocedure(expected.signature)
    )
    SELECT
      (SELECT count(*) FROM expected_owner) = 1
        AND (
          SELECT count(*)
          FROM pg_catalog.pg_proc function_object
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function_object.pronamespace
          WHERE namespace.nspname = 'yu'
            AND function_object.prokind = 'f'
        ) = (SELECT count(*) FROM expected)
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc function_object
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function_object.pronamespace
          WHERE namespace.nspname = 'yu'
            AND function_object.prokind <> 'f'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc routine
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'via'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM expected
          LEFT JOIN pg_catalog.pg_proc function_object
            ON function_object.oid = to_regprocedure(expected.signature)
          WHERE function_object.oid IS NULL
             OR function_object.prokind <> 'f'
             OR function_object.proowner IS DISTINCT FROM (
               SELECT proowner FROM expected_owner
             )
        )
        AND (
          SELECT pg_catalog.md5(
            pg_catalog.string_agg(item, E'\n' ORDER BY item)
          )
          FROM definition_surface
        ) = ${YUTABASE_FUNCTION_DEFINITION_FINGERPRINT}
        AS complete
  ` as unknown as Array<Record<string, unknown>>;
  if (rows.length !== 1 || rows[0]?.complete !== true) {
    throw new ProjectorError("yutabase_incompatible");
  }
}

async function preflightYutabasePrivilegeSurface(
  sql: Executor,
): Promise<void> {
  const functionSignatures = YUTABASE_FUNCTION_PRIVILEGES.map(
    ([signature]) => signature,
  );
  const functionGrantees = YUTABASE_FUNCTION_PRIVILEGES.map(
    ([, grantee]) => grantee,
  );
  const functionPrivileges = YUTABASE_FUNCTION_PRIVILEGES.map(
    ([, , privilege]) => privilege,
  );
  const relationSchemas = YUTABASE_RELATION_PRIVILEGES.map(
    ([schema]) => schema,
  );
  const relationNames = YUTABASE_RELATION_PRIVILEGES.map(
    ([, relation]) => relation,
  );
  const relationGrantees = YUTABASE_RELATION_PRIVILEGES.map(
    ([, , grantee]) => grantee,
  );
  const relationPrivileges = YUTABASE_RELATION_PRIVILEGES.map(
    ([, , , privilege]) => privilege,
  );
  const membershipParents = YUTABASE_INTERNAL_MEMBERSHIPS.map(
    ([parent]) => parent,
  );
  const membershipMembers = YUTABASE_INTERNAL_MEMBERSHIPS.map(
    ([, member]) => member,
  );

  const rows = await sql`
    WITH expected_owner AS (
      SELECT function_object.proowner
      FROM pg_catalog.pg_proc function_object
      WHERE function_object.oid = to_regprocedure('yu.refresh_via()')
    ),
    capability_roles AS (
      SELECT role.*
      FROM pg_catalog.pg_roles role
      WHERE role.rolname = ANY(${[...YUTABASE_CAPABILITY_ROLES]}::text[])
    ),
    expected_memberships(parent_name, member_name) AS (
      SELECT *
      FROM unnest(
        ${membershipParents}::text[],
        ${membershipMembers}::text[]
      )
    ),
    actual_internal_memberships AS (
      SELECT DISTINCT
        parent.rolname AS parent_name,
        member.rolname AS member_name
      FROM pg_catalog.pg_auth_members membership
      JOIN capability_roles parent ON parent.oid = membership.roleid
      JOIN capability_roles member ON member.oid = membership.member
    ),
    standard_relations AS (
      SELECT
        relation.oid,
        relation.relowner,
        relation.relkind,
        namespace.nspname,
        relation.relname
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE (
        namespace.nspname = 'yu'
        AND relation.relname IN (
          'standard_meta',
          'lexicon',
          'lexicon_versions',
          'word_versions',
          'registry',
          'threads',
          'thread_ids',
          'sever_log',
          'lexicon_versions_version_id_seq'
        )
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      ) OR (
        namespace.nspname = 'via'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      )
    ),
    expected_function_privileges(
      signature,
      grantee_name,
      privilege_type
    ) AS (
      SELECT *
      FROM unnest(
        ${functionSignatures}::text[],
        ${functionGrantees}::text[],
        ${functionPrivileges}::text[]
      )
    ),
    expected_relation_privileges(
      schema_name,
      relation_name,
      grantee_name,
      privilege_type
    ) AS (
      SELECT *
      FROM unnest(
        ${relationSchemas}::text[],
        ${relationNames}::text[],
        ${relationGrantees}::text[],
        ${relationPrivileges}::text[]
      )
    ),
    expected (
      object_class,
      object_oid,
      sub_id,
      grantee,
      privilege_type,
      is_grantable
    ) AS (
      SELECT
        'schema'::text,
        namespace.oid,
        0::integer,
        to_regrole('yu_reader')::oid,
        'USAGE'::text,
        false
      FROM pg_catalog.pg_namespace namespace
      WHERE namespace.nspname IN ('yu', 'via')
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        to_regrole('yu_reader')::oid,
        'SELECT'::text,
        false
      FROM standard_relations relation
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        to_regrole(required.grantee_name)::oid,
        required.privilege_type,
        false
      FROM expected_relation_privileges required
      JOIN standard_relations relation
        ON relation.nspname = required.schema_name
       AND relation.relname = required.relation_name
      UNION ALL
      SELECT
        'function'::text,
        to_regprocedure(required.signature)::oid,
        0::integer,
        CASE required.grantee_name
          WHEN 'PUBLIC' THEN 0::oid
          ELSE to_regrole(required.grantee_name)::oid
        END,
        required.privilege_type,
        false
      FROM expected_function_privileges required
    ),
    actual (
      object_class,
      object_oid,
      sub_id,
      grantee,
      privilege_type,
      is_grantable
    ) AS (
      SELECT
        'schema'::text,
        namespace.oid,
        0::integer,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          namespace.nspacl,
          pg_catalog.acldefault('n', namespace.nspowner)
        )
      ) acl
      WHERE namespace.nspname IN ('yu', 'via')
        AND acl.grantee <> namespace.nspowner
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM standard_relations relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          (
            SELECT relation_acl.relacl
            FROM pg_catalog.pg_class relation_acl
            WHERE relation_acl.oid = relation.oid
          ),
          pg_catalog.acldefault(
            CASE
              WHEN relation.relkind = 'S' THEN 'S'::"char"
              ELSE 'r'::"char"
            END,
            relation.relowner
          )
        )
      ) acl
      WHERE acl.grantee <> relation.relowner
      UNION ALL
      SELECT
        'column'::text,
        relation.oid,
        attribute.attnum::integer,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM standard_relations relation
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
      WHERE acl.grantee <> relation.relowner
      UNION ALL
      SELECT
        'function'::text,
        function_object.oid,
        0::integer,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_proc function_object
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = function_object.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          function_object.proacl,
          pg_catalog.acldefault('f', function_object.proowner)
        )
      ) acl
      WHERE namespace.nspname IN ('yu', 'via')
        AND acl.grantee <> function_object.proowner
    ),
    acl_difference AS (
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      UNION ALL
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    ),
    membership_difference AS (
      (
        SELECT * FROM actual_internal_memberships
        EXCEPT
        SELECT * FROM expected_memberships
      )
      UNION ALL
      (
        SELECT * FROM expected_memberships
        EXCEPT
        SELECT * FROM actual_internal_memberships
      )
    )
    SELECT
      (SELECT count(*) FROM expected_owner) = 1
        AND (SELECT count(*) FROM capability_roles) =
          cardinality(${[...YUTABASE_CAPABILITY_ROLES]}::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM capability_roles role
          WHERE role.rolcanlogin
             OR role.rolsuper
             OR role.rolcreatedb
             OR role.rolcreaterole
             OR NOT role.rolinherit
             OR role.rolreplication
             OR role.rolbypassrls
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_auth_members membership
          JOIN capability_roles parent ON parent.oid = membership.roleid
          JOIN capability_roles member ON member.oid = membership.member
          WHERE membership.admin_option
             OR NOT membership.inherit_option
             OR NOT membership.set_option
        )
        AND NOT EXISTS (SELECT 1 FROM membership_difference)
        AND NOT EXISTS (
          SELECT 1
          FROM capability_roles role
          WHERE EXISTS (
            SELECT 1
            FROM pg_catalog.pg_database database_object
            WHERE database_object.datname = current_database()
              AND database_object.datdba = role.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace namespace
            WHERE namespace.nspname IN ('yu', 'via')
              AND namespace.nspowner = role.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('yu', 'via')
              AND relation.relowner = role.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc routine
            JOIN pg_catalog.pg_namespace namespace
              ON namespace.oid = routine.pronamespace
            WHERE namespace.nspname IN ('yu', 'via')
              AND routine.proowner = role.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_type type_object
            JOIN pg_catalog.pg_namespace namespace
              ON namespace.oid = type_object.typnamespace
            WHERE namespace.nspname IN ('yu', 'via')
              AND type_object.typowner = role.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_extension extension_object
            WHERE extension_object.extowner = role.oid
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname IN ('yu', 'via')
            AND namespace.nspowner IS DISTINCT FROM (
              SELECT proowner FROM expected_owner
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM standard_relations relation
          WHERE relation.relowner IS DISTINCT FROM (
            SELECT proowner FROM expected_owner
          )
        )
        AND NOT EXISTS (SELECT 1 FROM acl_difference)
        AS complete
  ` as unknown as Array<Record<string, unknown>>;
  if (rows.length !== 1 || rows[0]?.complete !== true) {
    throw new ProjectorError("yutabase_incompatible");
  }
}

export async function preflightYutabase(sql: Executor): Promise<void> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await sql`
      SELECT
        standard,
        profile,
        version,
        revision,
        capabilities,
        to_regprocedure('yu._lock_registry_mapping(text,text)') IS NOT NULL
          AS has_registry_mapping_lock
      FROM yu.standard_meta
    ` as unknown as Array<Record<string, unknown>>;
  } catch (error) {
    if (isTransientDatabaseError(error)) throw error;
    const code = databaseErrorCode(error);
    if (code !== "42P01" && code !== "3F000" && code !== "42704") {
      throw error;
    }
    throw new ProjectorError("yutabase_incompatible");
  }
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.standard !== YUTABASE_IDENTITY.standard ||
    row.profile !== YUTABASE_IDENTITY.profile ||
    row.version !== YUTABASE_IDENTITY.version ||
    Number(row.revision) !== YUTABASE_IDENTITY.revision ||
    !Array.isArray(row.capabilities) ||
    !sameArray(row.capabilities as string[], REQUIRED_CAPABILITIES) ||
    row.has_registry_mapping_lock !== true
  ) {
    throw new ProjectorError("yutabase_incompatible");
  }
  await preflightYutabaseFunctionSurface(sql);
  await preflightYutabasePrivilegeSurface(sql);
  await preflightRegistryMappingLockFunction(sql);
}

async function runtimeRoleDefinition(
  sql: Executor,
  roleName: string,
): Promise<RoleDefinition | undefined> {
  const rows = await sql`
    SELECT
      rolcanlogin,
      rolinherit,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolreplication,
      rolbypassrls
    FROM pg_catalog.pg_roles
    WHERE rolname = ${roleName}
  ` as unknown as RoleDefinition[];
  if (rows.length > 1) {
    throw new ProjectorError("projector_schema_drift");
  }
  return rows[0];
}

function assertCapabilityRoleDefinition(
  role: RoleDefinition | undefined,
): asserts role is RoleDefinition {
  if (
    role === undefined ||
    role.rolcanlogin ||
    !role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

async function runtimeRoleMemberships(
  sql: Executor,
  roleName: string,
): Promise<RoleMembership[]> {
  const rows = await sql`
    SELECT
      parent.rolname,
      membership.admin_option,
      membership.inherit_option,
      membership.set_option
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member
      ON member.oid = membership.member
    JOIN pg_catalog.pg_roles parent
      ON parent.oid = membership.roleid
    WHERE member.rolname = ${roleName}
    ORDER BY parent.rolname
  ` as unknown as RoleMembership[];
  return rows;
}

function isSafeMembership(
  membership: RoleMembership | undefined,
  expectedParent: string,
): boolean {
  return (
    membership !== undefined &&
    membership.rolname === expectedParent &&
    membership.admin_option === false &&
    membership.inherit_option === true &&
    membership.set_option === true
  );
}

function hasOnlySafeMemberships(
  memberships: readonly RoleMembership[],
  expectedParent: string,
): boolean {
  return (
    memberships.length > 0 &&
    memberships.every((membership) =>
      isSafeMembership(membership, expectedParent)
    )
  );
}

async function protectedOwnershipCount(
  sql: Executor,
  roleName: string,
): Promise<number> {
  const rows = await sql`
    WITH protected_owner AS (
      SELECT database_owner.oid
      FROM pg_catalog.pg_database database_object
      JOIN pg_catalog.pg_roles database_owner
        ON database_owner.oid = database_object.datdba
      WHERE database_object.datname = current_database()
        AND database_owner.rolname = ${roleName}
      UNION ALL
      SELECT schema_owner.oid
      FROM pg_catalog.pg_namespace schema_object
      JOIN pg_catalog.pg_roles schema_owner
        ON schema_owner.oid = schema_object.nspowner
      WHERE schema_object.nspname IN ('yu', 'via', ${PROJECTOR_SCHEMA})
        AND schema_owner.rolname = ${roleName}
      UNION ALL
      SELECT relation_owner.oid
      FROM pg_catalog.pg_class relation_object
      JOIN pg_catalog.pg_namespace relation_schema
        ON relation_schema.oid = relation_object.relnamespace
      JOIN pg_catalog.pg_roles relation_owner
        ON relation_owner.oid = relation_object.relowner
      WHERE relation_schema.nspname IN ('yu', 'via', ${PROJECTOR_SCHEMA})
        AND relation_owner.rolname = ${roleName}
      UNION ALL
      SELECT function_owner.oid
      FROM pg_catalog.pg_proc function_object
      JOIN pg_catalog.pg_namespace function_schema
        ON function_schema.oid = function_object.pronamespace
      JOIN pg_catalog.pg_roles function_owner
        ON function_owner.oid = function_object.proowner
      WHERE function_schema.nspname IN ('yu', 'via', ${PROJECTOR_SCHEMA})
        AND function_owner.rolname = ${roleName}
      UNION ALL
      SELECT type_owner.oid
      FROM pg_catalog.pg_type type_object
      JOIN pg_catalog.pg_namespace type_schema
        ON type_schema.oid = type_object.typnamespace
      JOIN pg_catalog.pg_roles type_owner
        ON type_owner.oid = type_object.typowner
      WHERE type_schema.nspname IN ('yu', 'via', ${PROJECTOR_SCHEMA})
        AND type_owner.rolname = ${roleName}
      UNION ALL
      SELECT extension_owner.oid
      FROM pg_catalog.pg_extension extension_object
      JOIN pg_catalog.pg_roles extension_owner
        ON extension_owner.oid = extension_object.extowner
      WHERE extension_owner.rolname = ${roleName}
    )
    SELECT count(*)::integer AS count
    FROM protected_owner
  `;
  return Number(rows[0]?.count ?? -1);
}

async function preflightExactColumnPrivileges(
  sql: Executor,
  roleName: string,
): Promise<void> {
  const columnRows = await sql`
    SELECT
      relation.relname AS table_name,
      attribute.attname AS column_name,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'INSERT'
      ) AS can_insert,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'INSERT WITH GRANT OPTION'
      ) AS can_grant_insert,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'UPDATE'
      ) AS can_update,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'UPDATE WITH GRANT OPTION'
      ) AS can_grant_update,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'REFERENCES'
      ) AS can_reference,
      has_table_privilege(
        ${roleName}::text,
        relation.oid,
        'DELETE,TRUNCATE,TRIGGER'
      ) AS has_forbidden_table_privilege
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = ${PROJECTOR_SCHEMA}
      AND relation.relname = ANY(${EXPECTED_TABLES}::text[])
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY relation.relname, attribute.attnum
  ` as unknown as Array<Record<string, unknown>>;
  const expectedCount = Object.values(EXPECTED_COLUMNS).reduce(
    (count, columns) => count + columns.length,
    0,
  );
  const seen = new Set<string>();
  if (
    columnRows.length !== expectedCount ||
    columnRows.some((row) => {
      const tableName = row.table_name;
      const columnName = row.column_name;
      if (
        typeof tableName !== "string" ||
        typeof columnName !== "string"
      ) {
        return true;
      }
      const key = `${tableName}.${columnName}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return (
        row.can_insert !== INSERT_TABLES.has(tableName) ||
        row.can_grant_insert !== false ||
        row.can_update !== UPDATE_COLUMNS.has(key) ||
        row.can_grant_update !== false ||
        row.can_reference !== false ||
        row.has_forbidden_table_privilege !== false
      );
    })
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

async function preflightYutabaseColumnPrivileges(
  sql: Executor,
  roleName: string,
): Promise<void> {
  const columnRows = await sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'SELECT WITH GRANT OPTION'
      ) AS can_grant_select,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'INSERT'
      ) AS can_insert,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'INSERT WITH GRANT OPTION'
      ) AS can_grant_insert,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'UPDATE'
      ) AS can_update,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'UPDATE WITH GRANT OPTION'
      ) AS can_grant_update,
      has_column_privilege(
        ${roleName}::text,
        relation.oid,
        attribute.attnum,
        'REFERENCES'
      ) AS can_reference,
      has_table_privilege(
        ${roleName}::text,
        relation.oid,
        'DELETE,TRUNCATE,TRIGGER'
      ) AS has_forbidden_table_privilege
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relation.oid
    WHERE namespace.nspname IN ('yu', 'via')
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY namespace.nspname, relation.relname, attribute.attnum
  ` as unknown as Array<Record<string, unknown>>;
  const requiredRelations = new Set([
    "yu.lexicon",
    "yu.registry",
    "yu.thread_ids",
    "yu.threads",
  ]);
  const seenRelations = new Set<string>();
  if (
    columnRows.length === 0 ||
    columnRows.some((row) => {
      const schemaName = row.schema_name;
      const tableName = row.table_name;
      const columnName = row.column_name;
      if (
        typeof schemaName !== "string" ||
        typeof tableName !== "string" ||
        typeof columnName !== "string"
      ) {
        return true;
      }
      const relation = `${schemaName}.${tableName}`;
      seenRelations.add(relation);
      const canInsert = relation === "yu.threads";
      return (
        row.can_grant_select !== false ||
        row.can_insert !== canInsert ||
        row.can_grant_insert !== false ||
        row.can_update !== false ||
        row.can_grant_update !== false ||
        row.can_reference !== false ||
        row.has_forbidden_table_privilege !== false
      );
    }) ||
    [...requiredRelations].some((relation) => !seenRelations.has(relation))
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

async function preflightEffectiveRuntimePrivileges(
  sql: Executor,
  roleName: string,
): Promise<void> {
  const appTableRows = await sql`
    SELECT
      table_name,
      has_table_privilege(
        ${roleName}::text,
        format('%I.%I', ${PROJECTOR_SCHEMA}::text, table_name),
        'SELECT'
      ) AS can_select,
      has_table_privilege(
        ${roleName}::text,
        format('%I.%I', ${PROJECTOR_SCHEMA}::text, table_name),
        'DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS has_forbidden
    FROM unnest(${EXPECTED_TABLES}::text[]) AS tables(table_name)
  ` as unknown as Array<Record<string, unknown>>;
  if (
    appTableRows.length !== EXPECTED_TABLES.length ||
    appTableRows.some(
      (row) => row.can_select !== true || row.has_forbidden !== false,
    )
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
  await preflightExactColumnPrivileges(sql, roleName);
  await preflightYutabaseColumnPrivileges(sql, roleName);

  const privileges = (await sql`
    SELECT
      pg_has_role(${roleName}::text, 'yu_reader', 'member') AS is_reader,
      pg_has_role(${roleName}::text, 'yu_appender', 'member') AS is_appender,
      pg_has_role(${roleName}::text, 'yu_writer', 'member') AS is_writer,
      pg_has_role(${roleName}::text, 'yu_lexicographer', 'member')
        AS is_lexicographer,
      has_database_privilege(${roleName}::text, current_database(), 'CREATE')
        AS can_create_database_objects,
      has_parameter_privilege(
        ${roleName}::text,
        'session_replication_role',
        'SET'
      ) AS can_disable_triggers,
      has_parameter_privilege(
        ${roleName}::text,
        'session_replication_role',
        'ALTER SYSTEM'
      ) AS can_persist_disabled_triggers,
      current_setting('session_replication_role')
        AS session_replication_role,
      has_schema_privilege(${roleName}::text, 'yu', 'USAGE')
        AS can_use_yu,
      has_schema_privilege(${roleName}::text, 'yu', 'CREATE')
        AS can_create_yu,
      has_schema_privilege(
        ${roleName}::text,
        ${PROJECTOR_SCHEMA}::text,
        'USAGE'
      )
        AS can_use_projector,
      has_schema_privilege(
        ${roleName}::text,
        ${PROJECTOR_SCHEMA}::text,
        'CREATE'
      )
        AS can_create_projector,
      has_table_privilege(${roleName}::text, 'yu.threads', 'SELECT')
        AS can_select_threads,
      has_table_privilege(${roleName}::text, 'yu.threads', 'INSERT')
        AS can_insert_threads,
      has_table_privilege(
        ${roleName}::text,
        'yu.threads',
        'UPDATE,DELETE,TRUNCATE'
      )
        AS can_mutate_threads,
      has_table_privilege(${roleName}::text, 'yu.thread_ids', 'SELECT')
        AS can_select_thread_ids,
      has_table_privilege(
        ${roleName}::text,
        'yu.thread_ids',
        'INSERT,UPDATE,DELETE,TRUNCATE'
      ) AS can_mutate_thread_ids,
      has_table_privilege(
        ${roleName}::text,
        'yu.registry',
        'INSERT,UPDATE,DELETE,TRUNCATE'
      ) AS can_mutate_registry,
      has_table_privilege(
        ${roleName}::text,
        'yu.lexicon',
        'INSERT,UPDATE,DELETE,TRUNCATE'
      ) AS can_mutate_lexicon,
      has_function_privilege(
        ${roleName}::text,
        'yu._lock_thread_context(text,text,text,uuid,text,text,uuid)',
        'EXECUTE'
      ) AS can_lock_thread_context,
      has_function_privilege(
        ${roleName}::text,
        'yu._lock_registry_mapping(text,text)',
        'EXECUTE'
      ) AS can_lock_registry_mapping,
      has_function_privilege(
        ${roleName}::text,
        'yu._source_locators_valid(text[])',
        'EXECUTE'
      ) AS can_validate_source_locators,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc source_function
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(
            source_function.proacl,
            pg_catalog.acldefault('f', source_function.proowner)
          )
        ) AS source_acl
        WHERE source_function.oid =
              to_regprocedure('yu._source_locators_valid(text[])')
          AND source_acl.grantee = 0
          AND source_acl.privilege_type = 'EXECUTE'
          AND NOT source_acl.is_grantable
      ) AS source_locator_public_execute,
      has_function_privilege(
        ${roleName}::text,
        'yu.sever(uuid,text,text,text[])',
        'EXECUTE'
      ) AS can_sever,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.installation',
        'INSERT,UPDATE'
      ) AS can_mutate_installation_table,
      has_column_privilege(
        ${roleName}::text,
        'agenttool_yutabase.installation',
        'bound_source_origin',
        'UPDATE'
      ) AS can_bind_source,
      has_column_privilege(
        ${roleName}::text,
        'agenttool_yutabase.installation',
        'schema_version',
        'UPDATE'
      ) AS can_rewrite_installation,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.event_cards',
        'INSERT'
      ) AS can_insert_event_cards,
      has_column_privilege(
        ${roleName}::text,
        'agenttool_yutabase.event_cards',
        'materialization',
        'UPDATE'
      ) AS can_upgrade_event_cards,
      has_column_privilege(
        ${roleName}::text,
        'agenttool_yutabase.event_cards',
        'id',
        'UPDATE'
      ) AS can_rewrite_event_id,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.identity_cards',
        'INSERT'
      ) AS can_insert_identity_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.identity_cards',
        'UPDATE'
      ) AS can_update_identity_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.signing_key_cards',
        'INSERT'
      ) AS can_insert_signing_key_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.signing_key_cards',
        'UPDATE'
      ) AS can_update_signing_key_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.repository_cards',
        'INSERT'
      ) AS can_insert_repository_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.repository_cards',
        'UPDATE'
      ) AS can_update_repository_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.coordination_thread_cards',
        'INSERT'
      ) AS can_insert_coordination_thread_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.coordination_thread_cards',
        'UPDATE'
      ) AS can_update_coordination_thread_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.receipt_cards',
        'INSERT'
      ) AS can_insert_receipt_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.receipt_cards',
        'UPDATE'
      ) AS can_update_receipt_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.artifact_cards',
        'INSERT'
      ) AS can_insert_artifact_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.artifact_cards',
        'UPDATE'
      ) AS can_update_artifact_cards,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.projection_checkpoints',
        'INSERT'
      ) AS can_insert_checkpoints,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.applied_events',
        'INSERT'
      ) AS can_insert_applied_events,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.applied_events',
        'UPDATE'
      ) AS can_update_applied_events,
      has_table_privilege(
        ${roleName}::text,
        'agenttool_yutabase.quarantines',
        'INSERT'
      ) AS can_insert_quarantines,
      has_sequence_privilege(
        ${roleName}::text,
        'agenttool_yutabase.quarantines_id_seq',
        'USAGE'
      ) AS can_use_quarantine_sequence
  ` as unknown as Array<Record<string, unknown>>)[0];
  const requiredTrue = [
    "is_reader",
    "is_appender",
    "can_use_yu",
    "can_use_projector",
    "can_select_threads",
    "can_insert_threads",
    "can_select_thread_ids",
    "can_lock_thread_context",
    "can_lock_registry_mapping",
    "can_validate_source_locators",
    "source_locator_public_execute",
    "can_bind_source",
    "can_insert_event_cards",
    "can_upgrade_event_cards",
    "can_insert_identity_cards",
    "can_insert_signing_key_cards",
    "can_insert_repository_cards",
    "can_insert_coordination_thread_cards",
    "can_insert_receipt_cards",
    "can_insert_artifact_cards",
    "can_insert_checkpoints",
    "can_insert_applied_events",
    "can_insert_quarantines",
    "can_use_quarantine_sequence",
  ];
  const requiredFalse = [
    "is_writer",
    "is_lexicographer",
    "can_create_database_objects",
    "can_disable_triggers",
    "can_persist_disabled_triggers",
    "can_create_yu",
    "can_create_projector",
    "can_mutate_threads",
    "can_mutate_thread_ids",
    "can_mutate_registry",
    "can_mutate_lexicon",
    "can_sever",
    "can_mutate_installation_table",
    "can_rewrite_installation",
    "can_rewrite_event_id",
    "can_update_identity_cards",
    "can_update_signing_key_cards",
    "can_update_repository_cards",
    "can_update_coordination_thread_cards",
    "can_update_receipt_cards",
    "can_update_artifact_cards",
    "can_update_applied_events",
  ];
  if (
    privileges === undefined ||
    privileges.session_replication_role !== "origin" ||
    requiredTrue.some((key) => privileges[key] !== true) ||
    requiredFalse.some((key) => privileges[key] !== false)
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

async function preflightExactProjectorPrivilegeSurface(
  sql: Executor,
): Promise<void> {
  const rows = await sql`
    WITH app_schema AS (
      SELECT namespace.oid, namespace.nspowner
      FROM pg_catalog.pg_namespace namespace
      WHERE namespace.nspname = ${PROJECTOR_SCHEMA}
    ),
    capability AS (
      SELECT role.oid
      FROM pg_catalog.pg_roles role
      WHERE role.rolname = ${PROJECTOR_RUNTIME_ROLE}
    ),
    ownership_mismatch AS (
      SELECT 1
      FROM app_schema
      WHERE app_schema.nspowner = (SELECT oid FROM capability)
      UNION ALL
      SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      WHERE relation.relowner <> app_schema.nspowner
      UNION ALL
      SELECT 1
      FROM pg_catalog.pg_proc routine
      JOIN app_schema ON app_schema.oid = routine.pronamespace
      WHERE routine.proowner <> app_schema.nspowner
      UNION ALL
      SELECT 1
      FROM pg_catalog.pg_type type_object
      JOIN app_schema ON app_schema.oid = type_object.typnamespace
      WHERE type_object.typowner <> app_schema.nspowner
    ),
    actual (
      object_class,
      object_oid,
      sub_id,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) AS (
      SELECT
        'schema'::text,
        app_schema.oid,
        0::integer,
        acl.grantor,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM app_schema
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          (
            SELECT namespace.nspacl
            FROM pg_catalog.pg_namespace namespace
            WHERE namespace.oid = app_schema.oid
          ),
          pg_catalog.acldefault('n', app_schema.nspowner)
        )
      ) acl
      WHERE acl.grantee <> app_schema.nspowner
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        acl.grantor,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault(
            (
              CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END
            )::"char",
            relation.relowner
          )
        )
      ) acl
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND acl.grantee <> relation.relowner
      UNION ALL
      SELECT
        'column'::text,
        relation.oid,
        attribute.attnum::integer,
        acl.grantor,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = relation.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          attribute.attacl,
          pg_catalog.acldefault('c', relation.relowner)
        )
      ) acl
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.grantee <> relation.relowner
      UNION ALL
      SELECT
        'function'::text,
        routine.oid,
        0::integer,
        acl.grantor,
        acl.grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_proc routine
      JOIN app_schema ON app_schema.oid = routine.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          routine.proacl,
          pg_catalog.acldefault('f', routine.proowner)
        )
      ) acl
      WHERE routine.prokind = 'f'
        AND acl.grantee <> routine.proowner
    ),
    expected (
      object_class,
      object_oid,
      sub_id,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) AS (
      SELECT
        'schema'::text,
        app_schema.oid,
        0::integer,
        app_schema.nspowner,
        capability.oid,
        'USAGE'::text,
        false
      FROM app_schema
      CROSS JOIN capability
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        relation.relowner,
        capability.oid,
        'SELECT'::text,
        false
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      CROSS JOIN capability
      WHERE relation.relname = ANY(${EXPECTED_TABLES}::text[])
        AND relation.relkind = 'r'
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        relation.relowner,
        capability.oid,
        'INSERT'::text,
        false
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      CROSS JOIN capability
      WHERE relation.relname = ANY(${[...INSERT_TABLES]}::text[])
        AND relation.relkind = 'r'
      UNION ALL
      SELECT
        'column'::text,
        relation.oid,
        attribute.attnum::integer,
        relation.relowner,
        capability.oid,
        'UPDATE'::text,
        false
      FROM unnest(${[...UPDATE_COLUMNS]}::text[]) expected_column(key)
      JOIN pg_catalog.pg_class relation
        ON relation.relname = split_part(expected_column.key, '.', 1)
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attname = split_part(expected_column.key, '.', 2)
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      CROSS JOIN capability
      UNION ALL
      SELECT
        'relation'::text,
        relation.oid,
        0::integer,
        relation.relowner,
        capability.oid,
        'USAGE'::text,
        false
      FROM pg_catalog.pg_class relation
      JOIN app_schema ON app_schema.oid = relation.relnamespace
      CROSS JOIN capability
      WHERE relation.relname = 'quarantines_id_seq'
        AND relation.relkind = 'S'
    ),
    difference AS (
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      UNION ALL
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    )
    SELECT
      (SELECT count(*) FROM app_schema) = 1
        AND (SELECT count(*) FROM capability) = 1
        AS identities_match,
      NOT EXISTS (SELECT 1 FROM ownership_mismatch) AS owners_match,
      NOT EXISTS (SELECT 1 FROM difference) AS acl_matches
  ` as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.identities_match !== true ||
    row.owners_match !== true ||
    row.acl_matches !== true
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

async function preflightRuntimeCapabilityRole(
  sql: Executor,
): Promise<void> {
  assertCapabilityRoleDefinition(
    await runtimeRoleDefinition(sql, PROJECTOR_RUNTIME_ROLE),
  );
  const memberships = await runtimeRoleMemberships(
    sql,
    PROJECTOR_RUNTIME_ROLE,
  );
  const appender = await runtimeRoleDefinition(sql, "yu_appender");
  assertCapabilityRoleDefinition(appender);
  const appenderMemberships = await runtimeRoleMemberships(
    sql,
    "yu_appender",
  );
  const reader = await runtimeRoleDefinition(sql, "yu_reader");
  assertCapabilityRoleDefinition(reader);
  const readerMemberships = await runtimeRoleMemberships(sql, "yu_reader");
  if (
    !hasOnlySafeMemberships(memberships, "yu_appender") ||
    !hasOnlySafeMemberships(appenderMemberships, "yu_reader") ||
    readerMemberships.length !== 0 ||
    (await protectedOwnershipCount(sql, PROJECTOR_RUNTIME_ROLE)) !== 0 ||
    (await protectedOwnershipCount(sql, "yu_appender")) !== 0 ||
    (await protectedOwnershipCount(sql, "yu_reader")) !== 0
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
  await preflightExactProjectorPrivilegeSurface(sql);
  await preflightEffectiveRuntimePrivileges(sql, PROJECTOR_RUNTIME_ROLE);
}

export async function preflightRuntimeAccess(
  sql: Executor,
): Promise<void> {
  const rows = await sql`
    SELECT current_user AS role_name
  ` as unknown as Array<{ role_name: string }>;
  const roleName = rows[0]?.role_name;
  if (rows.length !== 1 || roleName === undefined) {
    throw new ProjectorError("projector_schema_drift");
  }
  const role = await runtimeRoleDefinition(sql, roleName);
  const memberships = await runtimeRoleMemberships(sql, roleName);
  if (
    role === undefined ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    !role.rolcanlogin ||
    !role.rolinherit ||
    !hasOnlySafeMemberships(memberships, PROJECTOR_RUNTIME_ROLE) ||
    (await protectedOwnershipCount(sql, roleName)) !== 0
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
  await preflightEffectiveRuntimePrivileges(sql, roleName);
}

async function ensureRuntimeCapabilityRole(sql: Executor): Promise<void> {
  const existing = await runtimeRoleDefinition(sql, PROJECTOR_RUNTIME_ROLE);
  if (existing === undefined) {
    await sql.unsafe(`
      CREATE ROLE agenttool_yutabase_projector
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS INHERIT
    `);
  } else {
    assertCapabilityRoleDefinition(existing);
    const memberships = await runtimeRoleMemberships(
      sql,
      PROJECTOR_RUNTIME_ROLE,
    );
    if (
      (
        memberships.length > 0 &&
        !hasOnlySafeMemberships(memberships, "yu_appender")
      ) ||
      (await protectedOwnershipCount(sql, PROJECTOR_RUNTIME_ROLE)) !== 0
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }
  const memberships = await runtimeRoleMemberships(
    sql,
    PROJECTOR_RUNTIME_ROLE,
  );
  if (memberships.length === 0) {
    await sql.unsafe(
      "GRANT yu_appender TO agenttool_yutabase_projector WITH ADMIN FALSE, INHERIT TRUE, SET TRUE",
    );
  }
}

async function normalizeProjectorPrivilegeSurface(
  sql: Executor,
): Promise<void> {
  await sql.unsafe(`
    DO $projector_acl$
    DECLARE
      target record;
    BEGIN
      FOR target IN
        SELECT DISTINCT
          namespace.nspname,
          CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.format('%I', grantee.rolname)
          END AS grantee_sql
        FROM pg_catalog.pg_namespace namespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(
            namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner)
          )
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee
          ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'agenttool_yutabase'
          AND acl.grantee <> namespace.nspowner
      LOOP
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %s',
          target.nspname,
          target.grantee_sql
        );
      END LOOP;

      FOR target IN
        SELECT DISTINCT
          namespace.nspname,
          relation.relname,
          relation.relkind,
          CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.format('%I', grantee.rolname)
          END AS grantee_sql
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(
            relation.relacl,
            pg_catalog.acldefault(
              (
                CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END
              )::"char",
              relation.relowner
            )
          )
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee
          ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'agenttool_yutabase'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND acl.grantee <> relation.relowner
      LOOP
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON %s %I.%I FROM %s',
          CASE WHEN target.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
          target.nspname,
          target.relname,
          target.grantee_sql
        );
      END LOOP;

      FOR target IN
        SELECT DISTINCT
          namespace.nspname,
          relation.relname,
          attribute.attname,
          CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.format('%I', grantee.rolname)
          END AS grantee_sql
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = relation.oid
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(
            attribute.attacl,
            pg_catalog.acldefault('c', relation.relowner)
          )
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee
          ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'agenttool_yutabase'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee <> relation.relowner
      LOOP
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s',
          target.attname,
          target.nspname,
          target.relname,
          target.grantee_sql
        );
      END LOOP;

      FOR target IN
        SELECT DISTINCT
          namespace.nspname,
          routine.proname,
          pg_catalog.pg_get_function_identity_arguments(routine.oid)
            AS identity_arguments,
          CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.format('%I', grantee.rolname)
          END AS grantee_sql
        FROM pg_catalog.pg_proc routine
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = routine.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(
            routine.proacl,
            pg_catalog.acldefault('f', routine.proowner)
          )
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee
          ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'agenttool_yutabase'
          AND routine.prokind = 'f'
          AND acl.grantee <> routine.proowner
      LOOP
        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON FUNCTION %I.%I(%s) FROM %s',
          target.nspname,
          target.proname,
          target.identity_arguments,
          target.grantee_sql
        );
      END LOOP;
    END
    $projector_acl$;
  `);
}

async function configureRuntimeGrants(sql: Executor): Promise<void> {
  await normalizeProjectorPrivilegeSurface(sql);
  await sql.unsafe(`
    REVOKE ALL PRIVILEGES ON SCHEMA agenttool_yutabase
      FROM PUBLIC, agenttool_yutabase_projector;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA agenttool_yutabase
      FROM PUBLIC, agenttool_yutabase_projector;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA agenttool_yutabase
      FROM PUBLIC, agenttool_yutabase_projector;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA agenttool_yutabase
      FROM PUBLIC, agenttool_yutabase_projector;

    GRANT USAGE ON SCHEMA agenttool_yutabase
      TO agenttool_yutabase_projector;
    GRANT SELECT ON ALL TABLES IN SCHEMA agenttool_yutabase
      TO agenttool_yutabase_projector;
    GRANT INSERT ON
      agenttool_yutabase.event_cards,
      agenttool_yutabase.identity_cards,
      agenttool_yutabase.signing_key_cards,
      agenttool_yutabase.repository_cards,
      agenttool_yutabase.coordination_thread_cards,
      agenttool_yutabase.receipt_cards,
      agenttool_yutabase.artifact_cards
      TO agenttool_yutabase_projector;
    GRANT UPDATE (
      materialization,
      protocol,
      project_id,
      kind,
      issued_at,
      session_seq,
      device_id,
      session_id,
      parent_count,
      scope_path_count,
      at,
      by,
      how,
      src
    ) ON agenttool_yutabase.event_cards
      TO agenttool_yutabase_projector;
    GRANT UPDATE (bound_source_origin)
      ON agenttool_yutabase.installation
      TO agenttool_yutabase_projector;
    GRANT INSERT
      ON agenttool_yutabase.projection_checkpoints
      TO agenttool_yutabase_projector;
    GRANT UPDATE (
      last_received_seq,
      last_event_id,
      state,
      last_poll_at,
      caught_up_at,
      last_success_at,
      last_error_at,
      last_error_code
    ) ON agenttool_yutabase.projection_checkpoints
      TO agenttool_yutabase_projector;
    GRANT INSERT
      ON agenttool_yutabase.applied_events
      TO agenttool_yutabase_projector;
    GRANT INSERT
      ON agenttool_yutabase.quarantines
      TO agenttool_yutabase_projector;
    GRANT UPDATE (last_seen_at, occurrences)
      ON agenttool_yutabase.quarantines
      TO agenttool_yutabase_projector;
    GRANT USAGE
      ON SEQUENCE agenttool_yutabase.quarantines_id_seq
      TO agenttool_yutabase_projector;

  `);
}

async function schemaExists(sql: Executor): Promise<boolean> {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace
      WHERE nspname = ${PROJECTOR_SCHEMA}
    ) AS present
  `;
  return rows[0]?.present === true;
}

async function preflightInstallation(sql: Executor): Promise<void> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await sql`
      SELECT
        singleton,
        schema_version,
        projector_profile,
        plan_profile,
        yutabase_standard,
        yutabase_profile,
        yutabase_version,
        yutabase_revision,
        local_environment,
        bound_source_origin
      FROM agenttool_yutabase.installation
    ` as unknown as Array<Record<string, unknown>>;
  } catch (error) {
    if (isTransientDatabaseError(error)) throw error;
    const code = databaseErrorCode(error);
    if (code !== "42P01" && code !== "3F000") throw error;
    throw new ProjectorError("projector_not_installed");
  }
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.singleton !== true ||
    Number(row.schema_version) !== PROJECTOR_SCHEMA_VERSION ||
    row.projector_profile !== PROJECTOR_PROFILE ||
    row.plan_profile !== PLAN_PROFILE ||
    row.yutabase_standard !== YUTABASE_IDENTITY.standard ||
    row.yutabase_profile !== YUTABASE_IDENTITY.profile ||
    row.yutabase_version !== YUTABASE_IDENTITY.version ||
    Number(row.yutabase_revision) !== YUTABASE_IDENTITY.revision ||
    row.local_environment !== true
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

export async function ensureSourceBinding(
  sql: Executor,
  sourceOrigin: string,
  options: { bind: boolean },
): Promise<void> {
  const rows = await sql`
    SELECT bound_source_origin
    FROM agenttool_yutabase.installation
    WHERE singleton = true
    FOR UPDATE
  ` as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new ProjectorError("projector_schema_drift");
  }
  if (row.bound_source_origin === null) {
    if (!options.bind) return;
    await sql`
      UPDATE agenttool_yutabase.installation
      SET bound_source_origin = ${sourceOrigin}
      WHERE singleton = true
        AND bound_source_origin IS NULL
    `;
    return;
  }
  if (row.bound_source_origin !== sourceOrigin) {
    throw new ProjectorError("scope_mismatch");
  }
}

export async function checkSourceBinding(
  sql: Executor,
  sourceOrigin: string,
): Promise<void> {
  const rows = await sql`
    SELECT bound_source_origin
    FROM agenttool_yutabase.installation
    WHERE singleton = true
  ` as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    (row.bound_source_origin !== null &&
      row.bound_source_origin !== sourceOrigin)
  ) {
    throw new ProjectorError(
      row?.bound_source_origin === undefined
        ? "projector_schema_drift"
        : "scope_mismatch",
    );
  }
}

async function preflightRegistry(sql: Executor): Promise<void> {
  const orderedMappings = [...EXPECTED_REGISTRY].sort(
    (left, right) =>
      compareAscii(left.book, right.book) ||
      compareAscii(left.deck, right.deck),
  );
  for (const expected of orderedMappings) {
    const lockedRows = await sql`
      SELECT
        physical_schema,
        physical_table,
        id_col,
        at_col,
        by_col,
        how_col,
        src_col
      FROM yu._lock_registry_mapping(${expected.book}, ${expected.deck})
    ` as unknown as Array<Record<string, unknown>>;
    const locked = lockedRows[0];
    if (
      lockedRows.length !== 1 ||
      locked === undefined ||
      (
        [
          "physical_schema",
          "physical_table",
          "id_col",
          "at_col",
          "by_col",
          "how_col",
          "src_col",
        ] as const
      ).some((key) => locked[key] !== expected[key])
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }

  // The owner-rights helper locks every expected registry row. Under the
  // required READ COMMITTED isolation, this second statement sees any change
  // that committed while a lock call was waiting, including native/ttl.
  const rows = await sql`
    SELECT
      book, deck, physical_schema, physical_table,
      id_col, at_col, by_col, how_col, src_col,
      native, ttl::text AS ttl
    FROM yu.registry
    WHERE book = 'correspondence'
    ORDER BY deck
  ` as unknown as Array<Record<string, unknown>>;
  if (rows.length !== EXPECTED_REGISTRY.length) {
    throw new ProjectorError("projector_schema_drift");
  }
  for (const expected of EXPECTED_REGISTRY) {
    const row = rows.find((candidate) => candidate.deck === expected.deck);
    if (
      row === undefined ||
      Object.entries(expected).some(
        ([key, value]) => row[key] !== value,
      )
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }
}

async function preflightLexicon(sql: Executor): Promise<void> {
  const expectedWords = YUTABASE_LEXICON.map((entry) => entry.word);
  const rows = await sql`
    SELECT
      word, gloss, inverse, from_deck, to_deck, to_one,
      ttl::text AS ttl, status, current_version
    FROM yu.lexicon
    WHERE word = ANY(${expectedWords}::text[])
    ORDER BY word
  ` as unknown as Array<Record<string, unknown>>;
  if (rows.length !== YUTABASE_LEXICON.length) {
    throw new ProjectorError("projector_schema_drift");
  }
  for (const expected of YUTABASE_LEXICON) {
    const row = rows.find((candidate) => candidate.word === expected.word);
    if (
      row === undefined ||
      row.gloss !== expected.gloss ||
      row.inverse !== expected.inverse ||
      row.from_deck !== expected.from_deck ||
      row.to_deck !== expected.to_deck ||
      row.to_one !== expected.to_one ||
      row.ttl !== expected.ttl ||
      row.status !== expected.status ||
      Number(row.current_version) < 1
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
    const versions = await sql`
      SELECT
        gloss, inverse, from_deck, to_deck, to_one, ttl::text AS ttl, status
      FROM yu.word_versions
      WHERE word = ${expected.word}
        AND word_version = ${Number(row.current_version)}
    ` as unknown as Array<Record<string, unknown>>;
    const version = versions[0];
    if (
      versions.length !== 1 ||
      version === undefined ||
      version.gloss !== expected.gloss ||
      version.inverse !== expected.inverse ||
      version.from_deck !== expected.from_deck ||
      version.to_deck !== expected.to_deck ||
      version.to_one !== expected.to_one ||
      version.ttl !== expected.ttl ||
      version.status !== expected.status
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }
}

async function preflightCardTables(sql: Executor): Promise<void> {
  const tables = await sql`
    SELECT
      c.relname AS table_name,
      c.relkind,
      c.relpersistence,
      c.relispartition,
      c.relrowsecurity,
      c.relforcerowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
    ORDER BY c.relname
  ` as unknown as Array<Record<string, unknown>>;
  if (
    tables.length !== EXPECTED_TABLES.length ||
    tables.some(
      (row) =>
        row.relkind !== "r" ||
        row.relpersistence !== "p" ||
        row.relispartition !== false ||
        row.relrowsecurity !== false ||
        row.relforcerowsecurity !== false,
    )
  ) {
    throw new ProjectorError("projector_schema_drift");
  }

  const columns = await sql`
    SELECT table_name, column_name, udt_name, is_nullable, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = ${PROJECTOR_SCHEMA}
      AND table_name = ANY(${EXPECTED_TABLES}::text[])
    ORDER BY table_name, ordinal_position
  ` as unknown as Array<Record<string, unknown>>;
  for (const [tableName, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = columns.filter((row) => row.table_name === tableName);
    if (
      actual.length !== expected.length ||
      expected.some((column, index) => {
        const row = actual[index];
        return (
          row === undefined ||
          row.column_name !== column[0] ||
          row.udt_name !== column[1] ||
          row.is_nullable !== column[2]
        );
      })
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }

  const primaryKeys = await sql`
    SELECT c.relname AS table_name, array_agg(a.attname ORDER BY k.ordinality) AS columns
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
      AND con.contype = 'p'
    GROUP BY c.relname
  ` as unknown as Array<Record<string, unknown>>;
  if (primaryKeys.length !== EXPECTED_TABLES.length) {
    throw new ProjectorError("projector_schema_drift");
  }
  for (const [tableName, expected] of Object.entries(
    EXPECTED_PRIMARY_KEYS,
  )) {
    const row = primaryKeys.find(
      (candidate) => candidate.table_name === tableName,
    );
    if (
      row === undefined ||
      !Array.isArray(row.columns) ||
      row.columns.length !== expected.length ||
      row.columns.some((column, index) => column !== expected[index])
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }

  const uniqueIndexes = await sql`
    SELECT
      c.relname AS table_name,
      array_agg(a.attname ORDER BY k.ordinality) AS columns,
      bool_and(i.indnullsnotdistinct = false) AS nulls_distinct,
      bool_and(i.indimmediate) AS immediate,
      bool_and(i.indnatts = i.indnkeyatts) AS no_included_columns,
      min(am.amname) AS access_method
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey)
      WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND k.ordinality <= i.indnkeyatts
    GROUP BY c.relname, i.indexrelid
  ` as unknown as Array<Record<string, unknown>>;
  if (
    uniqueIndexes.some(
      (row) =>
        row.nulls_distinct !== true ||
        row.immediate !== true ||
        row.no_included_columns !== true ||
        row.access_method !== "btree",
    )
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
  for (const [tableName, expectedKeys] of Object.entries(
    EXPECTED_UNIQUE_KEYS,
  )) {
    const actual = uniqueIndexes
      .filter((row) => row.table_name === tableName)
      .map((row) => (row.columns as string[]).join("\0"))
      .sort();
    const expected = expectedKeys.map((key) => key.join("\0")).sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }

  const identityColumns = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = ${PROJECTOR_SCHEMA}
      AND is_identity = 'YES'
  ` as unknown as Array<Record<string, unknown>>;
  if (
    identityColumns.length !== 1 ||
    identityColumns[0]?.table_name !== "quarantines" ||
    identityColumns[0]?.column_name !== "id"
  ) {
    throw new ProjectorError("projector_schema_drift");
  }

  const unexpectedConstraints = await sql`
    SELECT count(*)::integer AS count
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
      AND con.contype NOT IN ('p', 'u', 'c')
  `;
  if (Number(unexpectedConstraints[0]?.count ?? -1) !== 0) {
    throw new ProjectorError("projector_schema_drift");
  }

  const checks = await sql`
    SELECT
      c.relname AS table_name,
      con.conname,
      con.convalidated,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
      AND con.contype = 'c'
    ORDER BY c.relname, con.conname
  ` as unknown as Array<Record<string, unknown>>;
  for (const [tableName, expectedNames] of Object.entries(
    EXPECTED_CHECK_CONSTRAINTS,
  )) {
    const actual = checks
      .filter((row) => row.table_name === tableName)
      .map((row) => {
        if (row.convalidated !== true) {
          throw new ProjectorError("projector_schema_drift");
        }
        return String(row.conname);
      })
      .sort();
    const expected = [...expectedNames].sort();
    if (
      actual.length !== expected.length ||
      actual.some((name, index) => name !== expected[index])
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }
  const checkManifest = checks
    .map(
      (row) =>
        `${String(row.table_name)}|${String(row.conname)}|${String(
          row.definition,
        )}`,
    )
    .join("\n");
  if (
    createHash("sha256").update(checkManifest).digest("hex") !==
    CHECK_CONSTRAINT_MANIFEST_SHA256
  ) {
    throw new ProjectorError("projector_schema_drift");
  }

  const functions = await sql`
    SELECT p.proname, p.prosrc, l.lanname, p.prosecdef, p.provolatile
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND p.proname IN ('_event_card_update', '_refuse_card_mutation')
  ` as unknown as Array<Record<string, unknown>>;
  const eventFunction = functions.find(
    (row) => row.proname === "_event_card_update",
  );
  const refuseFunction = functions.find(
    (row) => row.proname === "_refuse_card_mutation",
  );
  if (
    functions.length !== 2 ||
    eventFunction === undefined ||
    refuseFunction === undefined ||
    eventFunction.lanname !== "plpgsql" ||
    refuseFunction.lanname !== "plpgsql" ||
    eventFunction.prosecdef !== false ||
    refuseFunction.prosecdef !== false ||
    eventFunction.provolatile !== "v" ||
    refuseFunction.provolatile !== "v" ||
    normalizeSql(String(eventFunction.prosrc)) !==
      normalizeSql(EVENT_UPDATE_BODY) ||
    normalizeSql(String(refuseFunction.prosrc)) !==
      normalizeSql(REFUSE_MUTATION_BODY)
  ) {
    throw new ProjectorError("projector_schema_drift");
  }

  const projectorTriggers = await sql`
    SELECT
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgtype,
      t.tgenabled,
      t.tgisinternal,
      t.tgconstraint,
      t.tgparentid,
      t.tgnargs,
      t.tgqual IS NULL AS no_when,
      t.tgoldtable IS NULL AND t.tgnewtable IS NULL
        AS no_transition_tables,
      ARRAY(
        SELECT a.attname::text
        FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY
          AS key(attnum, position)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = t.tgrelid
         AND a.attnum = key.attnum
        ORDER BY key.position
      ) AS trigger_columns,
      pn.nspname AS function_schema,
      p.proname AS function_name,
      p.prosecdef AS function_security_definer
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
    ORDER BY c.relname, t.tgname
  ` as unknown as Array<Record<string, unknown>>;
  for (const table of CARD_TABLES) {
    const registryEntry = EXPECTED_REGISTRY.find(
      (entry) => entry.physical_table === table,
    );
    if (registryEntry === undefined) {
      throw new ProjectorError("projector_schema_drift");
    }
    const actual = projectorTriggers.filter(
      (row) => row.table_name === table,
    );
    const expected: Array<{
      readonly name: string;
      readonly type: number;
      readonly functionName: string;
      readonly functionSchema: string;
      readonly securityDefiner: boolean;
      readonly columns: readonly string[];
    }> =
      table === "event_cards"
        ? [
            {
              name: "projector_event_no_delete",
              type: 11,
              functionName: "_refuse_card_mutation",
              functionSchema: PROJECTOR_SCHEMA,
              securityDefiner: false,
              columns: [],
            },
            {
              name: "projector_event_upgrade_only",
              type: 19,
              functionName: "_event_card_update",
              functionSchema: PROJECTOR_SCHEMA,
              securityDefiner: false,
              columns: [],
            },
            {
              name: "yutabase_guard_delete",
              type: 25,
              functionName: "_guard_delete",
              functionSchema: "yu",
              securityDefiner: true,
              columns: [],
            },
            {
              name: "yutabase_guard_truncate",
              type: 32,
              functionName: "_guard_truncate",
              functionSchema: "yu",
              securityDefiner: true,
              columns: [],
            },
          ]
        : [
            {
              name: `projector_${table
                .replace(/_cards$/, "")
                .replace("coordination_thread", "coordination_thread")}_immutable`,
              type: 27,
              functionName: "_refuse_card_mutation",
              functionSchema: PROJECTOR_SCHEMA,
              securityDefiner: false,
              columns: [],
            },
            {
              name: "yutabase_guard_delete",
              type: 25,
              functionName: "_guard_delete",
              functionSchema: "yu",
              securityDefiner: true,
              columns: [],
            },
            {
              name: "yutabase_guard_truncate",
              type: 32,
              functionName: "_guard_truncate",
              functionSchema: "yu",
              securityDefiner: true,
              columns: [],
            },
          ];
    if (
      actual.length !== expected.length ||
      expected.some((trigger) => {
        const row = actual.find(
          (candidate) => candidate.trigger_name === trigger.name,
        );
        return (
          row === undefined ||
          Number(row.tgtype) !== trigger.type ||
          row.tgenabled !== "O" ||
          row.tgisinternal !== false ||
          Number(row.tgconstraint) !== 0 ||
          Number(row.tgparentid) !== 0 ||
          Number(row.tgnargs) !== 0 ||
          row.no_when !== true ||
          row.no_transition_tables !== true ||
          !sameArray(row.trigger_columns, trigger.columns) ||
          row.function_name !== trigger.functionName ||
          row.function_schema !== trigger.functionSchema ||
          row.function_security_definer !== trigger.securityDefiner
        );
      })
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }

  if (
    projectorTriggers.some((row) =>
      OPERATIONAL_TABLES.includes(
        row.table_name as (typeof OPERATIONAL_TABLES)[number],
      ),
    )
  ) {
    throw new ProjectorError("projector_schema_drift");
  }

  const rows = await sql`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = ${PROJECTOR_SCHEMA}
      AND table_name = ANY(${CARD_TABLES}::text[])
    ORDER BY table_name
  ` as unknown as Array<Record<string, unknown>>;
  if (
    rows.length !== CARD_TABLES.length ||
    rows.some((row) => row.table_type !== "BASE TABLE")
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

export async function preflightProjector(sql: Executor): Promise<void> {
  await preflightYutabase(sql);
  await preflightInstallation(sql);
  await preflightRuntimeCapabilityRole(sql);
  await preflightRegistry(sql);
  await preflightLexicon(sql);
  await preflightCardTables(sql);
}

async function registerDecks(sql: Executor, claimant: string): Promise<void> {
  for (const deck of EXPECTED_REGISTRY) {
    await sql`
      INSERT INTO yu.registry (
        book, deck, physical_schema, physical_table,
        id_col, at_col, by_col, how_col, src_col,
        native, ttl, by
      ) VALUES (
        ${deck.book}, ${deck.deck},
        ${deck.physical_schema}, ${deck.physical_table},
        ${deck.id_col}, ${deck.at_col}, ${deck.by_col},
        ${deck.how_col}, ${deck.src_col},
        ${deck.native}, NULL, ${claimant}
      )
      ON CONFLICT (book, deck) DO NOTHING
    `;
  }
}

async function registerWords(sql: Executor, claimant: string): Promise<void> {
  for (const word of YUTABASE_LEXICON) {
    await sql`
      INSERT INTO yu.lexicon (
        word, gloss, inverse, from_deck, to_deck,
        to_one, ttl, status, at, by, how, src
      ) VALUES (
        ${word.word}, ${word.gloss}, ${word.inverse},
        ${word.from_deck}, ${word.to_deck}, ${word.to_one},
        NULL, ${word.status}, clock_timestamp(), ${claimant},
        'declared', NULL
      )
      ON CONFLICT (word) DO NOTHING
    `;
  }
  await sql`SELECT yu.refresh_via()`;
}

/**
 * Installs only the application-owned projection schema. YUTABASE Core must
 * already advertise the exact supported database identity.
 */
export async function installProjector(
  database: Database,
  config: TargetConfig,
): Promise<"installed" | "already_installed"> {
  try {
    return await transactionWithRetry(database, async (sql) => {
      // Registry insertion installs the revision-5 physical guard pair and
      // therefore participates in YUTABASE's READ COMMITTED lock protocol.
      await sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`;
      await sql`SET LOCAL lock_timeout = '5s'`;
      await sql`SET LOCAL statement_timeout = '30s'`;
      await preflightYutabase(sql);
      if (await schemaExists(sql)) {
        await preflightProjector(sql);
        return "already_installed" as const;
      }
      await ensureRuntimeCapabilityRole(sql);
      await sql.unsafe(INSTALL_SQL);
      await registerDecks(sql, config.claimant);
      await registerWords(sql, config.claimant);
      await configureRuntimeGrants(sql);
      await sql`
        INSERT INTO agenttool_yutabase.installation (
          singleton,
          schema_version,
          projector_profile,
          plan_profile,
          yutabase_standard,
          yutabase_profile,
          yutabase_version,
          yutabase_revision,
          local_environment,
          installed_at,
          installed_by
        ) VALUES (
          true,
          ${PROJECTOR_SCHEMA_VERSION},
          ${PROJECTOR_PROFILE},
          ${PLAN_PROFILE},
          ${YUTABASE_IDENTITY.standard},
          ${YUTABASE_IDENTITY.profile},
          ${YUTABASE_IDENTITY.version},
          ${YUTABASE_IDENTITY.revision},
          true,
          clock_timestamp(),
          ${config.claimant}
        )
      `;
      await preflightProjector(sql);
      return "installed" as const;
    });
  } catch (error) {
    if (error instanceof ProjectorError) throw error;
    throw new ProjectorError("target_unavailable");
  }
}
