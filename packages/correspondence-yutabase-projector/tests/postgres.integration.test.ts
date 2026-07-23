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
      identity_id: identityId,
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

run(
  "PostgreSQL 16/17: install, apply, replay, stub upgrade, quarantine, privacy",
  async () => {
    const adminDatabase = connectTarget(baseScope);
    let database: ReturnType<typeof connectTarget> | undefined;
    const target: TargetConfig = {
      targetUrl: baseScope.targetUrl,
      claimant,
    };
    try {
      expect(["installed", "already_installed"]).toContain(
        await installProjector(adminDatabase, target),
      );
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
        SELECT current_user AS role_name
      `;
      expect(runtimeIdentity[0]?.role_name).toBe(runtimeRole);
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
      const verifiedChild = verifyClosedRecord(child, publicKey, {
        projectId,
        repositoryId: "repo-a",
      });
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
        ...(await database`SELECT * FROM yu.threads WHERE by = ${claimant}`),
        ...(await database`SELECT * FROM agenttool_yutabase.applied_events`),
        ...(await database`SELECT * FROM agenttool_yutabase.quarantines`),
      ];
      const serialized = JSON.stringify(semantic);
      for (const privateCanary of [
        "private-body-canary",
        "private-branch-canary",
        "private/path/canary",
        first.event.signature.value_b64url,
        publicKey,
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
        code: "projector_schema_drift",
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
        code: "projector_schema_drift",
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
