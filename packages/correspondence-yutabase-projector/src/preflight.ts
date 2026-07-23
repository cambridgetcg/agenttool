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
    ["source_signing_key_id", "uuid", "NO"],
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
  "db45756077091f24dcb8412d1854dd067a61472ec4f441fa44c785915ed0f147";

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

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export async function preflightYutabase(sql: Executor): Promise<void> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await sql`
      SELECT standard, profile, version, revision, capabilities
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
    !sameArray(row.capabilities as string[], REQUIRED_CAPABILITIES)
  ) {
    throw new ProjectorError("yutabase_incompatible");
  }
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
    typeof membership.set_option === "boolean"
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
    "can_use_yu",
    "can_use_projector",
    "can_select_threads",
    "can_insert_threads",
    "can_select_thread_ids",
    "can_lock_thread_context",
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
  const reader = await runtimeRoleDefinition(sql, "yu_reader");
  assertCapabilityRoleDefinition(reader);
  const readerMemberships = await runtimeRoleMemberships(sql, "yu_reader");
  if (
    memberships.length !== 1 ||
    !isSafeMembership(memberships[0], "yu_reader") ||
    readerMemberships.length !== 0 ||
    (await protectedOwnershipCount(sql, PROJECTOR_RUNTIME_ROLE)) !== 0 ||
    (await protectedOwnershipCount(sql, "yu_reader")) !== 0
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
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
    memberships.length !== 1 ||
    !isSafeMembership(memberships[0], PROJECTOR_RUNTIME_ROLE) ||
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
      memberships.length > 1 ||
      (memberships.length === 1 &&
        !isSafeMembership(memberships[0], "yu_reader")) ||
      (await protectedOwnershipCount(sql, PROJECTOR_RUNTIME_ROLE)) !== 0
    ) {
      throw new ProjectorError("projector_schema_drift");
    }
  }
  await sql.unsafe(
    "GRANT yu_reader TO agenttool_yutabase_projector WITH INHERIT TRUE",
  );
}

async function configureRuntimeGrants(sql: Executor): Promise<void> {
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

    GRANT INSERT ON yu.threads TO agenttool_yutabase_projector;
    GRANT EXECUTE ON FUNCTION
      yu._lock_thread_context(text, text, text, uuid, text, text, uuid)
      TO agenttool_yutabase_projector;
    REVOKE EXECUTE ON FUNCTION yu.sever(uuid, text, text, text[])
      FROM agenttool_yutabase_projector;
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
      pn.nspname AS function_schema,
      p.proname AS function_name
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${EXPECTED_TABLES}::text[])
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  ` as unknown as Array<Record<string, unknown>>;
  for (const table of CARD_TABLES) {
    const actual = projectorTriggers.filter(
      (row) => row.table_name === table,
    );
    const expected =
      table === "event_cards"
        ? [
            [
              "projector_event_no_delete",
              11,
              "_refuse_card_mutation",
            ],
            [
              "projector_event_upgrade_only",
              19,
              "_event_card_update",
            ],
            ["yutabase_guard_delete", 11, "_guard_delete"],
          ]
        : [
            [
              `projector_${table
                .replace(/_cards$/, "")
                .replace("coordination_thread", "coordination_thread")}_immutable`,
              27,
              "_refuse_card_mutation",
            ],
            ["yutabase_guard_delete", 11, "_guard_delete"],
          ];
    if (
      actual.length !== expected.length ||
      expected.some(([name, type, functionName]) => {
        const row = actual.find((candidate) => candidate.trigger_name === name);
        return (
          row === undefined ||
          Number(row.tgtype) !== type ||
          row.tgenabled !== "O" ||
          row.function_name !== functionName ||
          row.function_schema !==
            (name === "yutabase_guard_delete" ? "yu" : PROJECTOR_SCHEMA)
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
  const registryGuards = await sql`
    SELECT c.relname AS table_name, count(*)::integer AS guard_count
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_trigger t
      ON t.tgrelid = c.oid
      AND t.tgname = 'yutabase_guard_delete'
      AND NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure('yu._guard_delete()')
      AND t.tgtype = 11
    WHERE n.nspname = ${PROJECTOR_SCHEMA}
      AND c.relname = ANY(${CARD_TABLES}::text[])
    GROUP BY c.relname
  ` as unknown as Array<Record<string, unknown>>;
  if (
    registryGuards.length !== CARD_TABLES.length ||
    registryGuards.some((row) => Number(row.guard_count) !== 1)
  ) {
    throw new ProjectorError("projector_schema_drift");
  }
}

export async function preflightProjector(sql: Executor): Promise<void> {
  await preflightYutabase(sql);
  await preflightInstallation(sql);
  await preflightRegistry(sql);
  await preflightLexicon(sql);
  await preflightCardTables(sql);
  await preflightRuntimeCapabilityRole(sql);
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
    await sql.unsafe(`
      CREATE TRIGGER yutabase_guard_delete
      BEFORE DELETE ON agenttool_yutabase.${deck.physical_table}
      FOR EACH ROW EXECUTE FUNCTION yu._guard_delete()
    `);
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
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
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
