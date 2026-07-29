import { expect, test } from "bun:test";
import {
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

import {
  planCorrespondenceRecord,
  type CorrespondenceEvent,
  type CorrespondenceEventRecord,
} from "@agenttool/correspondence-yutabase";

import {
  applyVerifiedPlan,
  projectionStatus,
  quarantineFailure,
} from "../src/apply";
import type { ScopeConfig, TargetConfig } from "../src/config";
import {
  EXPECTED_REGISTRY,
  REQUIRED_CAPABILITIES,
} from "../src/constants";
import { closeTarget, connectTarget } from "../src/database";
import { ProjectorError } from "../src/errors";
import { installProjector } from "../src/preflight";
import { runOnce } from "../src/projector";
import { SourceClient } from "../src/source";
import {
  canonicalEventBytes,
  computeEventId,
  fingerprintClosedRecord,
  verifyClosedRecord,
} from "../src/verify";

const databaseUrl = process.env.AGENTTOOL_YUTABASE_TEST_DATABASE_URL;
const run = databaseUrl === undefined ? test.skip : test;

const projectId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";
const claimant = "service:postgres-integration";
const baseScope: ScopeConfig = {
  targetUrl: databaseUrl ?? "postgresql://127.0.0.1/unused",
  claimant,
  sourceOrigin: "http://127.0.0.1:3000",
  projectId,
  repositoryId: "repo-a",
};

function signedRecord(
  privateKey: KeyObject,
  input: {
    kind: "intent" | "progress" | "artifact.offer";
    summary: string;
    parents: string[];
    sessionSeq: number;
    receivedSeq: string;
    projectId?: string;
    repositoryId?: string;
    identityId?: string;
    body?: Record<string, unknown>;
  },
): CorrespondenceEventRecord {
  const eventProjectId = input.projectId ?? projectId;
  const eventRepositoryId = input.repositoryId ?? "repo-a";
  const event = {
    protocol: "agent-correspondence/v0.1",
    event_id: `sha256:${"0".repeat(64)}`,
    project_id: eventProjectId,
    repository_id: eventRepositoryId,
    thread_id: "coordination-a",
    sender: {
      identity_id: input.identityId ?? identityId,
      signing_key_id: keyId,
      device_id: "44444444-4444-4444-8444-444444444444",
      session_id: "55555555-5555-4555-8555-555555555555",
    },
    kind: input.kind,
    parents: input.parents,
    session_seq: input.sessionSeq,
    issued_at: `2026-07-23T12:00:0${input.sessionSeq}.000Z`,
    scope: {
      base_revision: null,
      branch: "private-branch-canary",
      paths: ["private/path/canary"],
    },
    body: input.body ?? { summary: input.summary },
    authority: { automatic_action: "never", grants: [] },
    signature: {
      algorithm: "Ed25519",
      value_b64url: "A".repeat(86),
    },
  } as CorrespondenceEvent;
  event.signature = {
    algorithm: "Ed25519",
    value_b64url: sign(null, canonicalEventBytes(event), privateKey).toString(
      "base64url",
    ),
  };
  event.event_id = computeEventId(event);
  return {
    event,
    receipt: {
      received_seq: input.receivedSeq,
      received_at: `2026-07-23T12:01:0${input.sessionSeq}.000Z`,
    },
    missing_parents: [],
    lineage_status: input.parents.length === 0 ? "valid" : "pending",
  };
}

function singleRecordSource(
  scope: ScopeConfig,
  sourceToken: string,
  record: CorrespondenceEventRecord,
  publicKey: string,
  authoritySequence: number,
): SourceClient {
  return new SourceClient(
    {
      sourceOrigin: scope.sourceOrigin,
      sourceToken,
    },
    {
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/correspondence/events") {
          return new Response(
            JSON.stringify({
              protocol: "agent-correspondence/v0.1",
              scope: "project_private",
              events: [record],
              page: {
                after: null,
                next_after: record.receipt.received_seq,
                has_more: false,
              },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            keys: [
              {
                kid: record.event.sender.signing_key_id,
                public_key: publicKey,
                label: null,
                active: true,
                created_at: "2026-07-22T12:00:00.000Z",
                revoked_at: null,
                authority_root: false,
              },
            ],
            authority: {
              mode: "agent_root",
              sequence: authoritySequence,
              next_sequence: authoritySequence + 1,
            },
          }),
        );
      }) as typeof fetch,
    },
  );
}

run(
  "PostgreSQL 16/17: install, apply, replay, stub upgrade, quarantine, privacy",
  async () => {
    const adminDatabase = connectTarget(baseScope);
    let database: ReturnType<typeof connectTarget> | undefined;
    const target: TargetConfig = {
      targetUrl: baseScope.targetUrl,
      claimant,
    };
    const defaultPrivilegeRole =
      `projector_default_acl_${randomUUID().replaceAll("-", "")}`;
    try {
      await adminDatabase.unsafe(`
        CREATE ROLE "${defaultPrivilegeRole}"
          NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS INHERIT;
        ALTER DEFAULT PRIVILEGES
          GRANT USAGE, CREATE ON SCHEMAS TO "${defaultPrivilegeRole}";
        ALTER DEFAULT PRIVILEGES
          GRANT ALL PRIVILEGES ON TABLES TO "${defaultPrivilegeRole}";
        ALTER DEFAULT PRIVILEGES
          GRANT ALL PRIVILEGES ON SEQUENCES TO "${defaultPrivilegeRole}";
        ALTER DEFAULT PRIVILEGES
          GRANT EXECUTE ON FUNCTIONS TO "${defaultPrivilegeRole}";
      `);
      try {
        expect(["installed", "already_installed"]).toContain(
          await installProjector(adminDatabase, target),
        );
      } finally {
        await adminDatabase.unsafe(`
          ALTER DEFAULT PRIVILEGES
            REVOKE ALL PRIVILEGES ON SCHEMAS
            FROM "${defaultPrivilegeRole}";
          ALTER DEFAULT PRIVILEGES
            REVOKE ALL PRIVILEGES ON TABLES
            FROM "${defaultPrivilegeRole}";
          ALTER DEFAULT PRIVILEGES
            REVOKE ALL PRIVILEGES ON SEQUENCES
            FROM "${defaultPrivilegeRole}";
          ALTER DEFAULT PRIVILEGES
            REVOKE ALL PRIVILEGES ON FUNCTIONS
            FROM "${defaultPrivilegeRole}";
        `);
      }
      const inheritedDefaultPrivileges = await adminDatabase`
        SELECT
          has_schema_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase',
            'USAGE'
          ) AS schema_usage,
          has_schema_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase',
            'CREATE'
          ) AS schema_create,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'SELECT'
          ) AS table_select,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'INSERT'
          ) AS table_insert,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'UPDATE'
          ) AS table_update,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'DELETE'
          ) AS table_delete,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'TRUNCATE'
          ) AS table_truncate,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'REFERENCES'
          ) AS table_references,
          has_table_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.event_cards',
            'TRIGGER'
          ) AS table_trigger,
          has_sequence_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.quarantines_id_seq',
            'USAGE'
          ) AS sequence_usage,
          has_sequence_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.quarantines_id_seq',
            'SELECT'
          ) AS sequence_select,
          has_sequence_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase.quarantines_id_seq',
            'UPDATE'
          ) AS sequence_update,
          has_function_privilege(
            ${defaultPrivilegeRole},
            'agenttool_yutabase._event_card_update()',
            'EXECUTE'
          ) AS function_execute
      `;
      expect(inheritedDefaultPrivileges[0]).toEqual({
        schema_usage: false,
        schema_create: false,
        table_select: false,
        table_insert: false,
        table_update: false,
        table_delete: false,
        table_truncate: false,
        table_references: false,
        table_trigger: false,
        sequence_usage: false,
        sequence_select: false,
        sequence_update: false,
        function_execute: false,
      });
      const runtimeRole = `agenttool_projector_test_${randomUUID().replaceAll("-", "")}`;
      const runtimePassword = `test-only-${randomUUID()}`;
      await adminDatabase.unsafe(`
        CREATE ROLE "${runtimeRole}"
          LOGIN PASSWORD '${runtimePassword}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS INHERIT;
        GRANT agenttool_yutabase_projector TO "${runtimeRole}";
      `);
      const runtimeUrl = new URL(baseScope.targetUrl);
      runtimeUrl.username = runtimeRole;
      runtimeUrl.password = runtimePassword;
      const scope: ScopeConfig = {
        ...baseScope,
        targetUrl: runtimeUrl.toString(),
      };
      database = connectTarget(scope);
      const runtimeIdentity = await database`
        SELECT
          current_user AS role_name,
          pg_has_role(
            current_user,
            'yu_appender',
            'member'
          ) AS is_appender,
          has_function_privilege(
            current_user,
            'yu._source_locators_valid(text[])',
            'EXECUTE'
          ) AS can_validate_source_locators,
          has_function_privilege(
            current_user,
            'yu._lock_registry_mapping(text,text)',
            'EXECUTE'
          ) AS can_lock_registry_mapping,
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
          ) AS source_locator_public_execute
        `;
      expect(runtimeIdentity[0]).toMatchObject({
        role_name: runtimeRole,
        is_appender: true,
        can_validate_source_locators: true,
        can_lock_registry_mapping: true,
        source_locator_public_execute: true,
      });
      const directCoreAcl = await adminDatabase`
        WITH capability AS (
          SELECT oid
          FROM pg_catalog.pg_roles
          WHERE rolname = 'agenttool_yutabase_projector'
        ),
        direct_acl AS (
          SELECT acl.grantee
          FROM pg_catalog.pg_namespace namespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) acl
          WHERE namespace.nspname IN ('yu', 'via')
          UNION ALL
          SELECT acl.grantee
          FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) acl
          WHERE namespace.nspname IN ('yu', 'via')
          UNION ALL
          SELECT acl.grantee
          FROM pg_catalog.pg_attribute attribute
          JOIN pg_catalog.pg_class relation
            ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
          WHERE namespace.nspname IN ('yu', 'via')
          UNION ALL
          SELECT acl.grantee
          FROM pg_catalog.pg_proc routine
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = routine.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) acl
          WHERE namespace.nspname IN ('yu', 'via')
        )
        SELECT count(*)::integer AS count
        FROM direct_acl
        WHERE grantee = (SELECT oid FROM capability)
      `;
      expect(directCoreAcl[0]?.count).toBe(0);
      await adminDatabase.unsafe(`
        GRANT yu_reader TO yu_appender WITH SET FALSE
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "yutabase_incompatible",
        });
      } finally {
        await adminDatabase.unsafe(`
          GRANT yu_reader TO yu_appender WITH SET TRUE
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase.unsafe(`
        GRANT DELETE ON yu.threads TO "${defaultPrivilegeRole}"
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "yutabase_incompatible",
        });
      } finally {
        await adminDatabase.unsafe(`
          REVOKE DELETE ON yu.threads FROM "${defaultPrivilegeRole}"
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      let releaseRegistryUpdate!: () => void;
      let registryUpdateReady!: () => void;
      const holdRegistryUpdate = new Promise<void>((resolve) => {
        releaseRegistryUpdate = resolve;
      });
      const registryUpdateStarted = new Promise<void>((resolve) => {
        registryUpdateReady = resolve;
      });
      const registryUpdate = adminDatabase.begin(async (sql) => {
        await sql`
          UPDATE yu.registry
          SET native = false
          WHERE book = 'correspondence'
            AND deck = 'artifacts'
        `;
        registryUpdateReady();
        await holdRegistryUpdate;
      });
      await registryUpdateStarted;
      const blockedStatus = projectionStatus(database, scope).then(
        (value) => ({ state: "resolved" as const, value }),
        (error: unknown) => ({ state: "rejected" as const, error }),
      );
      try {
        const early = await Promise.race([
          blockedStatus,
          new Promise<{ state: "waiting" }>((resolve) => {
            setTimeout(() => resolve({ state: "waiting" }), 100);
          }),
        ]);
        expect(early.state).toBe("waiting");
      } finally {
        releaseRegistryUpdate();
        await registryUpdate;
      }
      const afterRegistryCommit = await blockedStatus;
      expect(afterRegistryCommit).toMatchObject({
        state: "rejected",
        error: { code: "projector_schema_drift" },
      });
      await adminDatabase`
        UPDATE yu.registry
        SET native = true
        WHERE book = 'correspondence'
          AND deck = 'artifacts'
      `;
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      const expectSidecarAclDrift = async (
        grantSql: string,
        revokeSql: string,
      ): Promise<void> => {
        await adminDatabase.unsafe(grantSql);
        try {
          await expect(
            projectionStatus(database!, scope),
          ).rejects.toMatchObject({
            code: "projector_schema_drift",
          });
        } finally {
          await adminDatabase.unsafe(revokeSql);
        }
        await expect(projectionStatus(database!, scope)).resolves.toMatchObject({
          state: "not_started",
        });
      };
      await expectSidecarAclDrift(
        `GRANT CREATE ON SCHEMA agenttool_yutabase
          TO "${defaultPrivilegeRole}"`,
        `REVOKE CREATE ON SCHEMA agenttool_yutabase
          FROM "${defaultPrivilegeRole}"`,
      );
      await expectSidecarAclDrift(
        `GRANT DELETE ON agenttool_yutabase.event_cards
          TO "${defaultPrivilegeRole}"`,
        `REVOKE DELETE ON agenttool_yutabase.event_cards
          FROM "${defaultPrivilegeRole}"`,
      );
      await expectSidecarAclDrift(
        `GRANT UPDATE (canonical_sha512)
          ON agenttool_yutabase.applied_events
          TO "${defaultPrivilegeRole}"`,
        `REVOKE UPDATE (canonical_sha512)
          ON agenttool_yutabase.applied_events
          FROM "${defaultPrivilegeRole}"`,
      );
      await expectSidecarAclDrift(
        `GRANT SELECT ON SEQUENCE agenttool_yutabase.quarantines_id_seq
          TO "${defaultPrivilegeRole}"`,
        `REVOKE SELECT ON SEQUENCE agenttool_yutabase.quarantines_id_seq
          FROM "${defaultPrivilegeRole}"`,
      );
      await expectSidecarAclDrift(
        `GRANT EXECUTE
          ON FUNCTION agenttool_yutabase._event_card_update()
          TO "${defaultPrivilegeRole}"`,
        `REVOKE EXECUTE
          ON FUNCTION agenttool_yutabase._event_card_update()
          FROM "${defaultPrivilegeRole}"`,
      );
      await expect(
        (async () => {
          await database`
            INSERT INTO agenttool_yutabase.artifact_cards (
              id, project_id, artifact_kind, digest, at, by, how, src
            ) VALUES (
              ${randomUUID()}, ${projectId}, 'content_digest',
              ${`sha256:${"0".repeat(64)}`}, clock_timestamp(),
              ${"\t\n\v\f\r "}, 'cached', ${["urn:test:source"]}
            )
          `;
        })(),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        (async () => {
          await database`
            INSERT INTO agenttool_yutabase.artifact_cards (
              id, project_id, artifact_kind, digest, at, by, how, src
            ) VALUES (
              ${randomUUID()}, ${projectId}, 'content_digest',
              ${`sha256:${"a".repeat(64)}`}, clock_timestamp(),
              ${claimant}, 'cached', ${[" "]}
            )
          `;
        })(),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        (async () => {
          await database`
            INSERT INTO agenttool_yutabase.artifact_cards (
              id, project_id, artifact_kind, digest, at, by, how, src
            ) VALUES (
              ${randomUUID()}, ${projectId}, 'content_digest',
              ${`sha256:${"b".repeat(64)}`}, clock_timestamp(),
              ${claimant}, 'cached',
              array_fill('urn:test:source'::text, ARRAY[1, 1])
            )
          `;
        })(),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        (async () => {
          await database`
            INSERT INTO agenttool_yutabase.artifact_cards (
              id, project_id, artifact_kind, digest, at, by, how, src
            ) VALUES (
              ${randomUUID()}, ${projectId}, 'content_digest',
              ${`sha256:${"c".repeat(64)}`}, clock_timestamp(),
              ${claimant}, 'cached',
              array_fill('urn:test:source'::text, ARRAY[1], ARRAY[0])
            )
          `;
        })(),
      ).rejects.toMatchObject({ code: "23514" });
      const registryGuards = await adminDatabase`
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
          pn.nspname AS function_schema,
          p.proname AS function_name,
          p.prosecdef AS function_security_definer,
          ARRAY(
            SELECT a.attname::text
            FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY
              AS key(attnum, position)
            JOIN pg_catalog.pg_attribute a
              ON a.attrelid = t.tgrelid
             AND a.attnum = key.attnum
            ORDER BY key.position
          ) AS trigger_columns
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'agenttool_yutabase'
          AND t.tgname IN (
            'yutabase_guard_delete',
            'yutabase_guard_truncate'
          )
        ORDER BY c.relname, t.tgname
      `;
      expect(registryGuards).toHaveLength(EXPECTED_REGISTRY.length * 2);
      for (const expected of EXPECTED_REGISTRY) {
        const tableGuards = registryGuards.filter(
          (guard) => guard.table_name === expected.physical_table,
        );
        expect(tableGuards).toHaveLength(2);
        const rowGuard = tableGuards.find(
          (guard) => guard.trigger_name === "yutabase_guard_delete",
        );
        const truncateGuard = tableGuards.find(
          (guard) => guard.trigger_name === "yutabase_guard_truncate",
        );
        expect(rowGuard).toBeDefined();
        expect(truncateGuard).toBeDefined();
        expect({
          type: Number(rowGuard!.tgtype),
          enabled: rowGuard!.tgenabled,
          internal: rowGuard!.tgisinternal,
          constraint: Number(rowGuard!.tgconstraint),
          parent: Number(rowGuard!.tgparentid),
          arguments: Number(rowGuard!.tgnargs),
          noWhen: rowGuard!.no_when,
          noTransitionTables: rowGuard!.no_transition_tables,
          functionSchema: rowGuard!.function_schema,
          functionName: rowGuard!.function_name,
          functionSecurityDefiner:
            rowGuard!.function_security_definer,
          columns: rowGuard!.trigger_columns,
        }).toEqual({
          type: 25,
          enabled: "O",
          internal: false,
          constraint: 0,
          parent: 0,
          arguments: 0,
          noWhen: true,
          noTransitionTables: true,
          functionSchema: "yu",
          functionName: "_guard_delete",
          functionSecurityDefiner: true,
          columns: [],
        });
        expect({
          type: Number(truncateGuard!.tgtype),
          enabled: truncateGuard!.tgenabled,
          internal: truncateGuard!.tgisinternal,
          constraint: Number(truncateGuard!.tgconstraint),
          parent: Number(truncateGuard!.tgparentid),
          arguments: Number(truncateGuard!.tgnargs),
          noWhen: truncateGuard!.no_when,
          noTransitionTables: truncateGuard!.no_transition_tables,
          functionSchema: truncateGuard!.function_schema,
          functionName: truncateGuard!.function_name,
          functionSecurityDefiner:
            truncateGuard!.function_security_definer,
          columns: truncateGuard!.trigger_columns,
        }).toEqual({
          type: 32,
          enabled: "O",
          internal: false,
          constraint: 0,
          parent: 0,
          arguments: 0,
          noWhen: true,
          noTransitionTables: true,
          functionSchema: "yu",
          functionName: "_guard_truncate",
          functionSecurityDefiner: true,
          columns: [],
        });
      }
      await adminDatabase.unsafe(`
        ALTER TABLE agenttool_yutabase.artifact_cards
          DISABLE TRIGGER yutabase_guard_delete
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "projector_schema_drift",
        });
      } finally {
        await adminDatabase.unsafe(`
          ALTER TABLE agenttool_yutabase.artifact_cards
            ENABLE TRIGGER yutabase_guard_delete
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase`
        UPDATE yu.standard_meta
        SET capabilities = ${[...REQUIRED_CAPABILITIES].reverse()}::text[]
        WHERE singleton = true
      `;
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "yutabase_incompatible",
      });
      await adminDatabase`
        UPDATE yu.standard_meta
        SET capabilities = ${[...REQUIRED_CAPABILITIES]}::text[]
        WHERE singleton = true
      `;
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase.unsafe(`
        ALTER TABLE agenttool_yutabase.artifact_cards
          DISABLE TRIGGER yutabase_guard_truncate
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "projector_schema_drift",
        });
      } finally {
        await adminDatabase.unsafe(`
          ALTER TABLE agenttool_yutabase.artifact_cards
            ENABLE TRIGGER yutabase_guard_truncate
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase.unsafe(`
        DROP TRIGGER yutabase_guard_truncate
          ON agenttool_yutabase.artifact_cards;
        CREATE TRIGGER yutabase_guard_truncate
          AFTER TRUNCATE ON agenttool_yutabase.artifact_cards
          FOR EACH STATEMENT
          EXECUTE FUNCTION yu._guard_truncate('drift')
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "projector_schema_drift",
        });
      } finally {
        await adminDatabase.unsafe(`
          DROP TRIGGER yutabase_guard_truncate
            ON agenttool_yutabase.artifact_cards;
          CREATE TRIGGER yutabase_guard_truncate
            AFTER TRUNCATE ON agenttool_yutabase.artifact_cards
            FOR EACH STATEMENT EXECUTE FUNCTION yu._guard_truncate()
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase.unsafe(`
        ALTER FUNCTION yu._guard_truncate() SECURITY INVOKER
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "yutabase_incompatible",
        });
      } finally {
        await adminDatabase.unsafe(`
          ALTER FUNCTION yu._guard_truncate() SECURITY DEFINER
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      const guardDefinitions = await adminDatabase`
        SELECT pg_catalog.pg_get_functiondef(
          'yu._guard_delete()'::regprocedure
        ) AS definition
      `;
      const guardDefinition = String(guardDefinitions[0]?.definition ?? "");
      expect(guardDefinition).toStartWith("CREATE OR REPLACE FUNCTION");
      await adminDatabase.unsafe(`
        CREATE OR REPLACE FUNCTION yu._guard_delete()
        RETURNS trigger AS $$
        BEGIN
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
        SET search_path = pg_catalog, yu, pg_temp
        SET row_security = off
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "yutabase_incompatible",
        });
      } finally {
        await adminDatabase.unsafe(guardDefinition);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await adminDatabase.unsafe(`
        DROP TRIGGER yutabase_guard_delete
          ON agenttool_yutabase.artifact_cards;
        CREATE TRIGGER yutabase_guard_delete
          BEFORE DELETE OR UPDATE OF project_id
          ON agenttool_yutabase.artifact_cards
          FOR EACH ROW
          WHEN (OLD.id IS NOT NULL)
          EXECUTE FUNCTION yu._guard_delete()
      `);
      try {
        await expect(projectionStatus(database, scope)).rejects.toMatchObject({
          code: "projector_schema_drift",
        });
      } finally {
        await adminDatabase.unsafe(`
          DROP TRIGGER yutabase_guard_delete
            ON agenttool_yutabase.artifact_cards;
          CREATE TRIGGER yutabase_guard_delete
            AFTER DELETE OR UPDATE
            ON agenttool_yutabase.artifact_cards
            FOR EACH ROW EXECUTE FUNCTION yu._guard_delete()
        `);
      }
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "not_started",
      });
      await expect(
        (async () => {
          await database`TRUNCATE agenttool_yutabase.event_cards`;
        })(),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        (async () => {
          await database`
            SELECT yu.sever(
              '00000000-0000-4000-8000-000000000001'::uuid,
              'forbidden',
              'service:test',
              ARRAY['test']
            )
          `;
        })(),
      ).rejects.toMatchObject({ code: "42501" });
      const pair = generateKeyPairSync("ed25519");
      const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
      const publicKey = publicDer
        .subarray(publicDer.length - 32)
        .toString("base64");
      const alternatePublicKeySpelling = Buffer.from(
        publicKey,
        "base64",
      ).toString("base64url");

      const first = signedRecord(pair.privateKey, {
        kind: "intent",
        summary: "private-body-canary-first",
        parents: [],
        sessionSeq: 1,
        receivedSeq: "7",
      });
      const verifiedFirst = verifyClosedRecord(first, publicKey, {
        projectId,
        repositoryId: "repo-a",
      });
      expect(
        await runOnce(
          database,
          { ...scope, sourceToken: "integration-source-token" },
          {
            source: new SourceClient(
              {
                sourceOrigin: scope.sourceOrigin,
                sourceToken: "integration-source-token",
              },
              {
                fetch: (async (input) => {
                  const url = new URL(String(input));
                  if (url.pathname === "/v1/correspondence/events") {
                    return new Response(
                      JSON.stringify({
                        protocol: "agent-correspondence/v0.1",
                        scope: "project_private",
                        events: [first],
                        page: {
                          after: null,
                          next_after: "7",
                          has_more: false,
                        },
                      }),
                    );
                  }
                  return new Response(
                    JSON.stringify({
                      keys: [
                        {
                          kid: keyId,
                          public_key: publicKey,
                          label: null,
                          active: false,
                          created_at: "2026-07-22T12:00:00.000Z",
                          revoked_at: "2026-07-23T11:00:00.000Z",
                          authority_root: false,
                        },
                      ],
                      authority: {
                        mode: "agent_root",
                        sequence: 2,
                        next_sequence: 3,
                      },
                    }),
                  );
                }) as typeof fetch,
              },
            ),
          },
        ),
      ).toMatchObject({ applied: 1, lastReceivedSeq: "7" });
      expect(
        await applyVerifiedPlan(
          database,
          scope,
          verifiedFirst,
          "service:different-replay-claimant",
        ),
      ).toMatchObject({ applied: false, replayed: true });
      const replayHeader = await database`
        SELECT by
        FROM agenttool_yutabase.event_cards
        WHERE source_event_id = ${first.event.event_id}
      `;
      expect(replayHeader[0]?.by).toBe(claimant);
      const pinnedKey = await database`
        SELECT
          source_identity_id,
          source_signing_key_id,
          verified_public_key_sha256
        FROM agenttool_yutabase.signing_key_cards
        WHERE project_id = ${projectId}
          AND source_signing_key_id = ${keyId}
      `;
      expect(pinnedKey).toHaveLength(1);
      expect(pinnedKey[0]).toMatchObject({
        source_identity_id: identityId,
        source_signing_key_id: keyId,
        verified_public_key_sha256:
          verifiedFirst.verifiedPublicKeySha256,
      });
      const projectedIdentity = await database`
        SELECT id
        FROM agenttool_yutabase.identity_cards
        WHERE project_id = ${projectId}
          AND source_identity_id = ${identityId}
      `;
      expect(projectedIdentity).toHaveLength(1);
      const originalProjectedIdentityId = String(projectedIdentity[0]?.id);
      const replacementProjectedIdentityId = randomUUID();
      await adminDatabase.unsafe(`
        ALTER TABLE agenttool_yutabase.identity_cards
          DISABLE TRIGGER projector_identity_immutable
      `);
      try {
        await expect(
          (async () => {
            await adminDatabase`
              UPDATE agenttool_yutabase.identity_cards
              SET id = ${replacementProjectedIdentityId}
              WHERE id = ${originalProjectedIdentityId}
            `;
          })(),
        ).rejects.toMatchObject({ code: "23503" });
      } finally {
        await adminDatabase.unsafe(`
          ALTER TABLE agenttool_yutabase.identity_cards
            ENABLE TRIGGER projector_identity_immutable
        `);
      }
      const guardedIdentity = await database`
        SELECT id
        FROM agenttool_yutabase.identity_cards
        WHERE project_id = ${projectId}
          AND source_identity_id = ${identityId}
      `;
      expect(guardedIdentity).toEqual([
        expect.objectContaining({ id: originalProjectedIdentityId }),
      ]);

      const truncateRole =
        `agenttool_truncate_test_${randomUUID().replaceAll("-", "")}`;
      const truncatePassword = `test-only-${randomUUID()}`;
      await adminDatabase.unsafe(`
        CREATE ROLE "${truncateRole}"
          LOGIN PASSWORD '${truncatePassword}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS INHERIT;
        GRANT USAGE ON SCHEMA agenttool_yutabase TO "${truncateRole}";
        GRANT TRUNCATE ON agenttool_yutabase.identity_cards
          TO "${truncateRole}"
      `);
      const truncateUrl = new URL(baseScope.targetUrl);
      truncateUrl.username = truncateRole;
      truncateUrl.password = truncatePassword;
      const truncateDatabase = connectTarget({
        ...scope,
        targetUrl: truncateUrl.toString(),
      });
      try {
        await expect(
          (async () => {
            await truncateDatabase`
              TRUNCATE agenttool_yutabase.identity_cards
            `;
          })(),
        ).rejects.toMatchObject({ code: "23503" });
      } finally {
        await closeTarget(truncateDatabase);
        await adminDatabase.unsafe(`
          REVOKE TRUNCATE ON agenttool_yutabase.identity_cards
            FROM "${truncateRole}";
          REVOKE USAGE ON SCHEMA agenttool_yutabase
            FROM "${truncateRole}";
          DROP ROLE "${truncateRole}";
        `);
      }
      const truncateGuardedIdentity = await database`
        SELECT id
        FROM agenttool_yutabase.identity_cards
        WHERE project_id = ${projectId}
          AND source_identity_id = ${identityId}
      `;
      expect(truncateGuardedIdentity).toEqual([
        expect.objectContaining({ id: originalProjectedIdentityId }),
      ]);

      const swappedPair = generateKeyPairSync("ed25519");
      const swappedPublicDer = swappedPair.publicKey.export({
        format: "der",
        type: "spki",
      });
      const swappedPublicKey = swappedPublicDer
        .subarray(swappedPublicDer.length - 32)
        .toString("base64");
      const keySwapScope: ScopeConfig = {
        ...scope,
        repositoryId: "repo-key-swap",
      };
      const keySwapRecord = signedRecord(swappedPair.privateKey, {
        kind: "intent",
        summary: "private-key-swap-canary",
        parents: [],
        sessionSeq: 4,
        receivedSeq: "11",
        repositoryId: keySwapScope.repositoryId,
      });
      const keySwapToken = "key-swap-source-token";
      await expect(
        runOnce(
          database,
          { ...keySwapScope, sourceToken: keySwapToken },
          {
            source: singleRecordSource(
              keySwapScope,
              keySwapToken,
              keySwapRecord,
              swappedPublicKey,
              3,
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: "signing_key_binding_collision",
      });

      const collidingIdentityId =
        "99999999-9999-4999-8999-999999999999";
      const identityCollisionScope: ScopeConfig = {
        ...scope,
        repositoryId: "repo-key-identity-collision",
      };
      const identityCollisionRecord = signedRecord(pair.privateKey, {
        kind: "intent",
        summary: "private-key-identity-collision-canary",
        parents: [],
        sessionSeq: 5,
        receivedSeq: "12",
        repositoryId: identityCollisionScope.repositoryId,
        identityId: collidingIdentityId,
      });
      const identityCollisionToken = "key-identity-collision-source-token";
      await expect(
        runOnce(
          database,
          {
            ...identityCollisionScope,
            sourceToken: identityCollisionToken,
          },
          {
            source: singleRecordSource(
              identityCollisionScope,
              identityCollisionToken,
              identityCollisionRecord,
              publicKey,
              2,
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: "signing_key_binding_collision",
      });
      const bindingCollisions = await database`
        SELECT
          source_repository_id,
          code,
          occurrences
        FROM agenttool_yutabase.quarantines
        WHERE source_repository_id IN (
          ${keySwapScope.repositoryId},
          ${identityCollisionScope.repositoryId}
        )
        ORDER BY source_repository_id
      `;
      expect(bindingCollisions).toHaveLength(2);
      expect(bindingCollisions).toEqual([
        expect.objectContaining({
          source_repository_id:
            identityCollisionScope.repositoryId,
          code: "signing_key_binding_collision",
          occurrences: 1,
        }),
        expect.objectContaining({
          source_repository_id: keySwapScope.repositoryId,
          code: "signing_key_binding_collision",
          occurrences: 1,
        }),
      ]);
      const bindingCollisionEffects = await database`
        SELECT
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.event_cards
            WHERE source_event_id IN (
              ${keySwapRecord.event.event_id},
              ${identityCollisionRecord.event.event_id}
            )
          ) AS cards,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.applied_events
            WHERE source_repository_id IN (
              ${keySwapScope.repositoryId},
              ${identityCollisionScope.repositoryId}
            )
          ) AS applied,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.signing_key_cards
            WHERE project_id = ${projectId}
              AND source_signing_key_id = ${keyId}
          ) AS pinned_keys
      `;
      expect(bindingCollisionEffects[0]).toMatchObject({
        cards: 0,
        applied: 0,
        pinned_keys: 1,
      });

      const parent = signedRecord(pair.privateKey, {
        kind: "progress",
        summary: "private-body-canary-parent",
        parents: [],
        sessionSeq: 2,
        receivedSeq: "9",
      });
      const child = signedRecord(pair.privateKey, {
        kind: "progress",
        summary: "private-body-canary-child",
        parents: [parent.event.event_id],
        sessionSeq: 3,
        receivedSeq: "8",
      });
      const verifiedChild = verifyClosedRecord(
        child,
        alternatePublicKeySpelling,
        {
          projectId,
          repositoryId: "repo-a",
        },
      );
      const verifiedParent = verifyClosedRecord(parent, publicKey, {
        projectId,
        repositoryId: "repo-a",
      });
      await applyVerifiedPlan(database, scope, verifiedChild, claimant);
      const reference = await database`
        SELECT materialization, by
        FROM agenttool_yutabase.event_cards
        WHERE source_event_id = ${parent.event.event_id}
      `;
      expect(reference[0]?.materialization).toBe("reference_only");
      await applyVerifiedPlan(database, scope, verifiedParent, claimant);
      const upgraded = await database`
        SELECT materialization, protocol
        FROM agenttool_yutabase.event_cards
        WHERE source_event_id = ${parent.event.event_id}
      `;
      expect(upgraded[0]).toMatchObject({
        materialization: "metadata",
        protocol: "agent-correspondence/v0.1",
      });

      const artifactRevision = "a".repeat(40);
      const secondProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const artifactA = signedRecord(pair.privateKey, {
        kind: "artifact.offer",
        summary: "private-artifact-a",
        parents: [],
        sessionSeq: 4,
        receivedSeq: "20",
        repositoryId: "repo-artifacts-a",
        body: {
          artifact: {
            kind: "git_commit",
            revision: artifactRevision,
          },
        },
      });
      const artifactB = signedRecord(pair.privateKey, {
        kind: "artifact.offer",
        summary: "private-artifact-b",
        parents: [],
        sessionSeq: 5,
        receivedSeq: "1",
        projectId: secondProjectId,
        repositoryId: "repo-artifacts-b",
        body: {
          artifact: {
            kind: "git_commit",
            revision: artifactRevision,
          },
        },
      });
      const artifactScopeA: ScopeConfig = {
        ...scope,
        repositoryId: "repo-artifacts-a",
      };
      const artifactScopeB: ScopeConfig = {
        ...scope,
        projectId: secondProjectId,
        repositoryId: "repo-artifacts-b",
      };
      await applyVerifiedPlan(
        database,
        artifactScopeA,
        verifyClosedRecord(artifactA, publicKey, {
          projectId,
          repositoryId: "repo-artifacts-a",
        }),
        claimant,
      );
      await applyVerifiedPlan(
        database,
        artifactScopeB,
        verifyClosedRecord(artifactB, publicKey, {
          projectId: secondProjectId,
          repositoryId: "repo-artifacts-b",
        }),
        claimant,
      );
      const sharedArtifact = await database`
        SELECT count(*)::integer AS count,
               count(DISTINCT project_id)::integer AS projects
        FROM agenttool_yutabase.artifact_cards
        WHERE revision = ${artifactRevision}
      `;
      expect(sharedArtifact[0]).toMatchObject({
        count: 2,
        projects: 2,
      });

      const rollbackScope: ScopeConfig = {
        ...scope,
        repositoryId: "repo-rollback",
      };
      const rollbackParent = signedRecord(pair.privateKey, {
        kind: "progress",
        summary: "private-rollback-parent",
        parents: [],
        sessionSeq: 7,
        receivedSeq: "41",
        repositoryId: rollbackScope.repositoryId,
      });
      const rollbackChild = signedRecord(pair.privateKey, {
        kind: "progress",
        summary: "private-rollback-child",
        parents: [rollbackParent.event.event_id],
        sessionSeq: 8,
        receivedSeq: "40",
        repositoryId: rollbackScope.repositoryId,
      });
      await applyVerifiedPlan(
        database,
        rollbackScope,
        verifyClosedRecord(rollbackChild, publicKey, {
          projectId,
          repositoryId: rollbackScope.repositoryId,
        }),
        claimant,
      );
      const rollbackPlan = planCorrespondenceRecord(rollbackParent, {
        claimant,
      });
      const collisionRelation = rollbackPlan.relations.find(
        (relation) => relation.word === "reported_by",
      );
      expect(collisionRelation).toBeDefined();
      await adminDatabase`
        INSERT INTO yu.threads (
          id,
          word,
          from_book,
          from_deck,
          from_id,
          to_book,
          to_deck,
          to_id,
          note,
          at,
          by,
          how,
          src
        ) VALUES (
          ${randomUUID()},
          ${collisionRelation!.word},
          ${collisionRelation!.from.book},
          ${collisionRelation!.from.deck},
          ${collisionRelation!.from.id},
          ${collisionRelation!.to.book},
          ${collisionRelation!.to.deck},
          ${collisionRelation!.to.id},
          NULL,
          ${collisionRelation!.claim.at},
          'service:rollback-collision',
          ${collisionRelation!.claim.how},
          ${[...collisionRelation!.claim.src]}
        )
      `;
      await expect(
        applyVerifiedPlan(
          database,
          rollbackScope,
          verifyClosedRecord(rollbackParent, publicKey, {
            projectId,
            repositoryId: rollbackScope.repositoryId,
          }),
          claimant,
        ),
      ).rejects.toMatchObject({ code: "thread_collision" });
      const rolledBack = await database`
        SELECT
          (
            SELECT materialization
            FROM agenttool_yutabase.event_cards
            WHERE source_event_id = ${rollbackParent.event.event_id}
          ) AS parent_materialization,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.receipt_cards
            WHERE source_event_id = ${rollbackParent.event.event_id}
          ) AS receipt_cards,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.applied_events
            WHERE source_event_id = ${rollbackParent.event.event_id}
          ) AS applied_events,
          (
            SELECT last_received_seq::text
            FROM agenttool_yutabase.projection_checkpoints
            WHERE source_repository_id = ${rollbackScope.repositoryId}
          ) AS checkpoint
      `;
      expect(rolledBack[0]).toMatchObject({
        parent_materialization: "reference_only",
        receipt_cards: 0,
        applied_events: 0,
        checkpoint: "40",
      });

      const invalidScope: ScopeConfig = {
        ...scope,
        repositoryId: "repo-invalid-signature",
      };
      const invalidRecord = signedRecord(
        generateKeyPairSync("ed25519").privateKey,
        {
          kind: "intent",
          summary: "private-invalid-signature",
          parents: [],
          sessionSeq: 6,
          receivedSeq: "30",
          repositoryId: invalidScope.repositoryId,
        },
      );
      await expect(
        runOnce(
          database,
          {
            ...invalidScope,
            sourceToken: "invalid-signature-source-token",
          },
          {
            source: new SourceClient(
              {
                sourceOrigin: invalidScope.sourceOrigin,
                sourceToken: "invalid-signature-source-token",
              },
              {
                fetch: (async (input) => {
                  const url = new URL(String(input));
                  if (url.pathname === "/v1/correspondence/events") {
                    return new Response(
                      JSON.stringify({
                        protocol: "agent-correspondence/v0.1",
                        scope: "project_private",
                        events: [invalidRecord],
                        page: {
                          after: null,
                          next_after: "30",
                          has_more: false,
                        },
                      }),
                    );
                  }
                  return new Response(
                    JSON.stringify({
                      keys: [
                        {
                          kid: keyId,
                          public_key: publicKey,
                          label: null,
                          active: true,
                          created_at: "2026-07-22T12:00:00.000Z",
                          revoked_at: null,
                          authority_root: false,
                        },
                      ],
                      authority: {
                        mode: "agent_root",
                        sequence: 3,
                        next_sequence: 4,
                      },
                    }),
                  );
                }) as typeof fetch,
              },
            ),
          },
        ),
      ).rejects.toMatchObject({ code: "signature_invalid" });
      const invalidEffects = await database`
        SELECT
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.event_cards
            WHERE source_event_id = ${invalidRecord.event.event_id}
          ) AS cards,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.applied_events
            WHERE source_repository_id = ${invalidScope.repositoryId}
          ) AS applied,
          (
            SELECT count(*)::integer
            FROM agenttool_yutabase.quarantines
            WHERE source_repository_id = ${invalidScope.repositoryId}
          ) AS quarantined
      `;
      expect(invalidEffects[0]).toMatchObject({
        cards: 0,
        applied: 0,
        quarantined: 1,
      });

      const conflict = {
        ...parent,
        receipt: { ...parent.receipt, received_seq: "10" },
      };
      const verifiedConflict = verifyClosedRecord(conflict, publicKey, {
        projectId,
        repositoryId: "repo-a",
      });
      let collision: ProjectorError | undefined;
      try {
        await applyVerifiedPlan(
          database,
          scope,
          verifiedConflict,
          claimant,
        );
      } catch (error) {
        collision = error as ProjectorError;
      }
      expect(collision?.code).toBe("applied_event_collision");
      await quarantineFailure(database, scope, {
        eventId: conflict.event.event_id,
        receivedSeq: conflict.receipt.received_seq,
        fingerprint: fingerprintClosedRecord(conflict),
        error: collision,
      });
      const status = await projectionStatus(database, scope);
      expect(status).toMatchObject({
        state: "unhealthy",
        lastReceivedSeq: "9",
        quarantineCount: 1,
      });
      await expect(
        projectionStatus(database, {
          ...scope,
          sourceOrigin: "http://127.0.0.1:3001",
        }),
      ).rejects.toMatchObject({ code: "scope_mismatch" });

      const semantic = [
        ...(await database`SELECT * FROM agenttool_yutabase.event_cards`),
        ...(await database`SELECT * FROM agenttool_yutabase.signing_key_cards`),
        ...(await database`SELECT * FROM yu.threads WHERE by = ${claimant}`),
        ...(await database`SELECT * FROM agenttool_yutabase.applied_events`),
        ...(await database`SELECT * FROM agenttool_yutabase.quarantines`),
      ];
      const serialized = JSON.stringify(semantic);
      for (const privateCanary of [
        "private-body-canary",
        "private-branch-canary",
        "private/path/canary",
        "private-key-swap-canary",
        "private-key-identity-collision-canary",
        first.event.signature.value_b64url,
        publicKey,
        alternatePublicKeySpelling,
        swappedPublicKey,
      ]) {
        expect(serialized).not.toContain(privateCanary);
      }

      await adminDatabase.unsafe(`
        GRANT UPDATE (canonical_sha512)
          ON agenttool_yutabase.applied_events
          TO "${runtimeRole}"
      `);
      const columnDrift = await database`
        SELECT
          has_table_privilege(
            current_user,
            'agenttool_yutabase.applied_events',
            'UPDATE'
          ) AS table_update,
          has_column_privilege(
            current_user,
            'agenttool_yutabase.applied_events',
            'canonical_sha512',
            'UPDATE'
          ) AS column_update
      `;
      expect(columnDrift[0]).toMatchObject({
        table_update: false,
        column_update: true,
      });
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
      await adminDatabase.unsafe(`
        REVOKE UPDATE (canonical_sha512)
          ON agenttool_yutabase.applied_events
          FROM "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        GRANT UPDATE (note)
          ON yu.threads
          TO "${runtimeRole}"
      `);
      const yutabaseColumnDrift = await database`
        SELECT
          has_table_privilege(
            current_user,
            'yu.threads',
            'UPDATE'
          ) AS table_update,
          has_column_privilege(
            current_user,
            'yu.threads',
            'note',
            'UPDATE'
          ) AS column_update
      `;
      expect(yutabaseColumnDrift[0]).toMatchObject({
        table_update: false,
        column_update: true,
      });
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "yutabase_incompatible",
      });
      await adminDatabase.unsafe(`
        REVOKE UPDATE (note)
          ON yu.threads
          FROM "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        GRANT DELETE
          ON yu.word_versions
          TO "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "yutabase_incompatible",
      });
      await adminDatabase.unsafe(`
        REVOKE DELETE
          ON yu.word_versions
          FROM "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        REVOKE UPDATE (last_received_seq)
          ON agenttool_yutabase.projection_checkpoints
          FROM agenttool_yutabase_projector
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
      await adminDatabase.unsafe(`
        GRANT UPDATE (last_received_seq)
          ON agenttool_yutabase.projection_checkpoints
          TO agenttool_yutabase_projector
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        REVOKE EXECUTE ON FUNCTION yu._lock_registry_mapping(text, text)
          FROM yu_reader
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "yutabase_incompatible",
      });
      await adminDatabase.unsafe(`
        GRANT EXECUTE ON FUNCTION yu._lock_registry_mapping(text, text)
          TO yu_reader
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        REVOKE EXECUTE ON FUNCTION yu._source_locators_valid(text[])
          FROM PUBLIC
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "yutabase_incompatible",
      });
      await adminDatabase.unsafe(`
        GRANT EXECUTE ON FUNCTION yu._source_locators_valid(text[])
          TO PUBLIC
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      const dangerousRole =
        `agenttool_projector_danger_${randomUUID().replaceAll("-", "")}`;
      await adminDatabase.unsafe(`
        CREATE ROLE "${dangerousRole}"
          NOLOGIN NOSUPERUSER CREATEDB CREATEROLE
          NOREPLICATION NOBYPASSRLS INHERIT;
        GRANT "${dangerousRole}" TO "${runtimeRole}"
          WITH INHERIT FALSE, SET TRUE;
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
      await adminDatabase.unsafe(`
        REVOKE "${dangerousRole}" FROM "${runtimeRole}";
        DROP ROLE "${dangerousRole}";
      `);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await adminDatabase.unsafe(`
        GRANT SET
          ON PARAMETER session_replication_role
          TO "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
      await database.unsafe("SET session_replication_role = replica");
      await adminDatabase.unsafe(`
        REVOKE SET
          ON PARAMETER session_replication_role
          FROM "${runtimeRole}"
      `);
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
      await closeTarget(database);
      database = undefined;
      database = connectTarget(scope);
      await expect(projectionStatus(database, scope)).resolves.toMatchObject({
        state: "unhealthy",
      });

      await expect(
        (async () => {
          await database`
            ALTER TABLE agenttool_yutabase.event_cards
            ADD COLUMN forbidden_runtime_drift text
          `;
        })(),
      ).rejects.toMatchObject({ code: "42501" });
      await adminDatabase`
        ALTER TABLE agenttool_yutabase.event_cards
        ADD COLUMN integration_drift_canary text
      `;
      await expect(projectionStatus(database, scope)).rejects.toMatchObject({
        code: "projector_schema_drift",
      });
    } finally {
      if (database !== undefined) await closeTarget(database);
      await closeTarget(adminDatabase);
    }
  },
  30_000,
);
