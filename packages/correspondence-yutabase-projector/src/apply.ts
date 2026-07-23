import {
  PLAN_PROFILE,
  YUTABASE_LEXICON,
  planCorrespondenceRecord,
  type CorrespondenceYutabasePlan,
  type YutabaseCardMutation,
  type YutabaseRelationMutation,
} from "@agenttool/correspondence-yutabase";

import {
  validateScopeConfig,
  type ScopeConfig,
} from "./config.js";
import {
  databaseErrorCode,
  isDatabaseAvailabilityError,
  isTransientDatabaseError,
  transactionWithRetry,
  type Database,
  type Transaction,
} from "./database.js";
import { ProjectorError, asProjectorError } from "./errors.js";
import {
  checkSourceBinding,
  ensureSourceBinding,
  preflightProjector,
  preflightRuntimeAccess,
} from "./preflight.js";
import {
  assertRuntimeVerified,
  type VerifiedRecord,
} from "./verify.js";

interface CheckpointRow extends Record<string, unknown> {
  last_received_seq: string | number | bigint;
  last_event_id: string | null;
  state: string;
}

export interface ApplyResult {
  readonly applied: boolean;
  readonly replayed: boolean;
  readonly receivedSeq: string;
  readonly eventId: string;
}

export interface ProjectionStatus {
  readonly installed: true;
  readonly state: "healthy" | "unhealthy" | "not_started";
  readonly lastReceivedSeq: string;
  readonly lastEventId: string | null;
  readonly lastPollAt: string | null;
  readonly caughtUpAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastErrorCode: string | null;
  readonly quarantineCount: number;
}

function rows<T extends Record<string, unknown>>(
  value: readonly Record<string, unknown>[],
): T[] {
  return value as T[];
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
  }
  return String(value);
}

function sameArray(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameFields(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
  options: {
    readonly timestamps?: readonly string[];
    readonly integers?: readonly string[];
  } = {},
): boolean {
  const timestamps = new Set(options.timestamps ?? []);
  const integers = new Set(options.integers ?? []);
  return Object.entries(expected).every(([key, value]) => {
    const actual = existing[key];
    if (Array.isArray(value)) return sameArray(actual, value as string[]);
    if (timestamps.has(key)) return iso(actual) === iso(value);
    if (integers.has(key)) return String(actual) === String(value);
    return actual === value;
  });
}

async function lockSemanticKeys(
  sql: Transaction,
  keys: readonly string[],
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${key}, 0)
      )
    `;
  }
}

async function ensureCheckpoint(
  sql: Transaction,
  scope: ScopeConfig,
): Promise<CheckpointRow> {
  await sql`
    INSERT INTO agenttool_yutabase.projection_checkpoints (
      source_origin,
      source_project_id,
      source_repository_id,
      plan_profile,
      last_received_seq,
      state
    ) VALUES (
      ${scope.sourceOrigin},
      ${scope.projectId},
      ${scope.repositoryId},
      ${PLAN_PROFILE},
      0,
      'healthy'
    )
    ON CONFLICT (
      source_origin,
      source_project_id,
      source_repository_id,
      plan_profile
    ) DO NOTHING
  `;
  const result = rows<CheckpointRow>(
    await sql`
      SELECT last_received_seq, last_event_id, state
      FROM agenttool_yutabase.projection_checkpoints
      WHERE source_origin = ${scope.sourceOrigin}
        AND source_project_id = ${scope.projectId}
        AND source_repository_id = ${scope.repositoryId}
        AND plan_profile = ${PLAN_PROFILE}
      FOR UPDATE
    `,
  );
  if (result.length !== 1 || result[0] === undefined) {
    throw new ProjectorError("projector_schema_drift");
  }
  return result[0];
}

async function applyEventCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as Record<string, unknown>;
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT *
      FROM agenttool_yutabase.event_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing === undefined) {
    await sql`
      INSERT INTO agenttool_yutabase.event_cards (
        id,
        materialization,
        source_event_id,
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
      ) VALUES (
        ${card.address.id},
        ${fields.materialization as string},
        ${fields.source_event_id as string},
        ${fields.protocol as string | null | undefined ?? null},
        ${fields.project_id as string | null | undefined ?? null},
        ${fields.kind as string | null | undefined ?? null},
        ${fields.issued_at as string | null | undefined ?? null},
        ${fields.session_seq as number | null | undefined ?? null},
        ${fields.device_id as string | null | undefined ?? null},
        ${fields.session_id as string | null | undefined ?? null},
        ${fields.parent_count as number | null | undefined ?? null},
        ${fields.scope_path_count as number | null | undefined ?? null},
        ${card.claim.at},
        ${card.claim.by},
        ${card.claim.how},
        ${[...card.claim.src]}
      )
    `;
    return;
  }

  const structural = {
    materialization: fields.materialization,
    source_event_id: fields.source_event_id,
    protocol: fields.protocol ?? null,
    project_id: fields.project_id ?? null,
    kind: fields.kind ?? null,
    issued_at: fields.issued_at ?? null,
    session_seq: fields.session_seq ?? null,
    device_id: fields.device_id ?? null,
    session_id: fields.session_id ?? null,
    parent_count: fields.parent_count ?? null,
    scope_path_count: fields.scope_path_count ?? null,
  };
  if (
    sameFields(existing, structural, {
      timestamps: ["issued_at"],
      integers: ["session_seq"],
    })
  ) {
    return;
  }
  if (
    existing.materialization === "metadata" &&
    fields.materialization === "reference_only" &&
    existing.source_event_id === fields.source_event_id
  ) {
    return;
  }
  if (
    existing.materialization === "reference_only" &&
    fields.materialization === "metadata" &&
    existing.source_event_id === fields.source_event_id
  ) {
    await sql`
      UPDATE agenttool_yutabase.event_cards
      SET
        materialization = 'metadata',
        protocol = ${fields.protocol as string},
        project_id = ${fields.project_id as string},
        kind = ${fields.kind as string},
        issued_at = ${fields.issued_at as string},
        session_seq = ${fields.session_seq as number},
        device_id = ${fields.device_id as string},
        session_id = ${fields.session_id as string},
        parent_count = ${fields.parent_count as number},
        scope_path_count = ${fields.scope_path_count as number},
        at = ${card.claim.at},
        by = ${card.claim.by},
        how = ${card.claim.how},
        src = ${[...card.claim.src]}
      WHERE id = ${card.address.id}
    `;
    return;
  }
  throw new ProjectorError("card_collision");
}

async function applyIdentityCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as {
    project_id: string;
    source_identity_id: string;
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT id, project_id, source_identity_id
      FROM agenttool_yutabase.identity_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (sameFields(existing, fields)) return;
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.identity_cards (
      id, project_id, source_identity_id, at, by, how, src
    ) VALUES (
      ${card.address.id}, ${fields.project_id},
      ${fields.source_identity_id}, ${card.claim.at},
      ${card.claim.by}, ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applySigningKeyCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as {
    project_id: string;
    source_signing_key_id: string;
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT id, project_id, source_signing_key_id
      FROM agenttool_yutabase.signing_key_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (sameFields(existing, fields)) return;
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.signing_key_cards (
      id, project_id, source_signing_key_id, at, by, how, src
    ) VALUES (
      ${card.address.id}, ${fields.project_id},
      ${fields.source_signing_key_id}, ${card.claim.at},
      ${card.claim.by}, ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applyRepositoryCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as {
    project_id: string;
    source_repository_id: string;
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT id, project_id, source_repository_id
      FROM agenttool_yutabase.repository_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (sameFields(existing, fields)) return;
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.repository_cards (
      id, project_id, source_repository_id, at, by, how, src
    ) VALUES (
      ${card.address.id}, ${fields.project_id},
      ${fields.source_repository_id}, ${card.claim.at},
      ${card.claim.by}, ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applyCoordinationThreadCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as {
    project_id: string;
    source_repository_id: string;
    source_thread_id: string;
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT
        id, project_id, source_repository_id, source_thread_id
      FROM agenttool_yutabase.coordination_thread_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (sameFields(existing, fields)) return;
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.coordination_thread_cards (
      id, project_id, source_repository_id, source_thread_id,
      at, by, how, src
    ) VALUES (
      ${card.address.id}, ${fields.project_id},
      ${fields.source_repository_id}, ${fields.source_thread_id},
      ${card.claim.at}, ${card.claim.by},
      ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applyReceiptCard(
  sql: Transaction,
  card: YutabaseCardMutation,
): Promise<void> {
  const fields = card.fields as {
    project_id: string;
    source_event_id: string;
    received_seq: string;
    received_at: string;
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT
        id, project_id, source_event_id, received_seq, received_at
      FROM agenttool_yutabase.receipt_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (
      sameFields(existing, fields, {
        timestamps: ["received_at"],
        integers: ["received_seq"],
      })
    ) {
      return;
    }
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.receipt_cards (
      id, project_id, source_event_id, received_seq, received_at,
      at, by, how, src
    ) VALUES (
      ${card.address.id}, ${fields.project_id},
      ${fields.source_event_id}, ${fields.received_seq},
      ${fields.received_at}, ${card.claim.at},
      ${card.claim.by}, ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applyArtifactCard(
  sql: Transaction,
  card: YutabaseCardMutation,
  projectId: string,
): Promise<void> {
  const fields = card.fields as {
    artifact_kind: string;
    revision?: string;
    digest?: string;
  };
  const expected = {
    project_id: projectId,
    artifact_kind: fields.artifact_kind,
    revision: fields.revision ?? null,
    digest: fields.digest ?? null,
  };
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT id, project_id, artifact_kind, revision, digest
      FROM agenttool_yutabase.artifact_cards
      WHERE id = ${card.address.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (sameFields(existing, expected)) return;
    throw new ProjectorError("card_collision");
  }
  await sql`
    INSERT INTO agenttool_yutabase.artifact_cards (
      id, project_id, artifact_kind, revision, digest, at, by, how, src
    ) VALUES (
      ${card.address.id}, ${projectId}, ${fields.artifact_kind},
      ${fields.revision ?? null}, ${fields.digest ?? null},
      ${card.claim.at}, ${card.claim.by},
      ${card.claim.how}, ${[...card.claim.src]}
    )
  `;
}

async function applyCard(
  sql: Transaction,
  card: YutabaseCardMutation,
  projectId: string,
): Promise<void> {
  await lockSemanticKeys(sql, [`card:${card.address.id}`]);
  switch (card.address.deck) {
    case "events":
      await applyEventCard(sql, card);
      return;
    case "identities":
      await applyIdentityCard(sql, card);
      return;
    case "signing_keys":
      await applySigningKeyCard(sql, card);
      return;
    case "repositories":
      await applyRepositoryCard(sql, card);
      return;
    case "coordination_threads":
      await applyCoordinationThreadCard(sql, card);
      return;
    case "receipts":
      await applyReceiptCard(sql, card);
      return;
    case "artifacts":
      await applyArtifactCard(sql, card, projectId);
      return;
  }
}

function relationFields(
  relation: YutabaseRelationMutation,
): Record<string, unknown> {
  return {
    word: relation.word,
    from_book: relation.from.book,
    from_deck: relation.from.deck,
    from_id: relation.from.id,
    to_book: relation.to.book,
    to_deck: relation.to.deck,
    to_id: relation.to.id,
    note: null,
    at: relation.claim.at,
    how: relation.claim.how,
    src: [...relation.claim.src],
  };
}

async function assertPinnedWord(
  sql: Transaction,
  existing: Record<string, unknown>,
): Promise<void> {
  const expected = YUTABASE_LEXICON.find(
    (word) => word.word === existing.word,
  );
  if (expected === undefined) throw new ProjectorError("thread_collision");
  const versions = rows<Record<string, unknown>>(
    await sql`
      SELECT
        gloss, inverse, from_deck, to_deck, to_one,
        ttl::text AS ttl, status
      FROM yu.word_versions
      WHERE word = ${existing.word as string}
        AND word_version = ${Number(existing.word_version)}
    `,
  );
  const version = versions[0];
  if (
    versions.length !== 1 ||
    version === undefined ||
    !sameFields(version, {
      gloss: expected.gloss,
      inverse: expected.inverse,
      from_deck: expected.from_deck,
      to_deck: expected.to_deck,
      to_one: expected.to_one,
      ttl: expected.ttl,
      status: expected.status,
    }) ||
    existing.word_to_one !== expected.to_one
  ) {
    throw new ProjectorError("thread_collision");
  }
}

async function applyRelation(
  sql: Transaction,
  relation: YutabaseRelationMutation,
): Promise<void> {
  const expected = relationFields(relation);
  const tupleKey = JSON.stringify([
    relation.word,
    relation.from.book,
    relation.from.deck,
    relation.from.id,
    relation.to.book,
    relation.to.deck,
    relation.to.id,
  ]);
  await lockSemanticKeys(sql, [
    `thread-id:${relation.id}`,
    `thread-tuple:${tupleKey}`,
  ]);
  const existing = rows<Record<string, unknown>>(
    await sql`
      SELECT
        id, word, word_version, word_to_one,
        from_book, from_deck, from_id,
        to_book, to_deck, to_id,
        note, at, by, how, src
      FROM yu.threads
      WHERE id = ${relation.id}
    `,
  )[0];
  if (existing !== undefined) {
    if (
      !sameFields(existing, expected, {
        timestamps: ["at"],
      })
    ) {
      throw new ProjectorError("thread_collision");
    }
    await assertPinnedWord(sql, existing);
    return;
  }

  const tuple = await sql`
    SELECT id
    FROM yu.threads
    WHERE word = ${relation.word}
      AND from_book = ${relation.from.book}
      AND from_deck = ${relation.from.deck}
      AND from_id = ${relation.from.id}
      AND to_book = ${relation.to.book}
      AND to_deck = ${relation.to.deck}
      AND to_id = ${relation.to.id}
  `;
  if (tuple.length > 0) throw new ProjectorError("thread_collision");

  const reserved = await sql`
    SELECT id FROM yu.thread_ids WHERE id = ${relation.id}
  `;
  if (reserved.length > 0) {
    throw new ProjectorError("thread_id_reserved");
  }

  const inserted = rows<Record<string, unknown>>(
    await sql`
    INSERT INTO yu.threads (
      id, word,
      from_book, from_deck, from_id,
      to_book, to_deck, to_id,
      note, at, by, how, src
    ) VALUES (
      ${relation.id}, ${relation.word},
      ${relation.from.book}, ${relation.from.deck}, ${relation.from.id},
      ${relation.to.book}, ${relation.to.deck}, ${relation.to.id},
      NULL, ${relation.claim.at}, ${relation.claim.by},
      ${relation.claim.how}, ${[...relation.claim.src]}
    )
    RETURNING
      id, word, word_version, word_to_one,
      from_book, from_deck, from_id,
      to_book, to_deck, to_id,
      note, at, by, how, src
  `,
  )[0];
  if (
    inserted === undefined ||
    !sameFields(inserted, expected, { timestamps: ["at"] })
  ) {
    throw new ProjectorError("thread_collision");
  }
  await assertPinnedWord(sql, inserted);
}

async function existingAppliedEvent(
  sql: Transaction,
  scope: ScopeConfig,
  eventId: string,
  receivedSeq: string,
): Promise<Record<string, unknown> | undefined> {
  const result = rows<Record<string, unknown>>(
    await sql`
      SELECT
        source_event_id,
        received_seq,
        received_at,
        canonical_sha512,
        verified_key_id,
        verified_public_key_sha256
      FROM agenttool_yutabase.applied_events
      WHERE source_origin = ${scope.sourceOrigin}
        AND source_project_id = ${scope.projectId}
        AND source_repository_id = ${scope.repositoryId}
        AND (
          source_event_id = ${eventId}
          OR received_seq = ${receivedSeq}
        )
    `,
  );
  if (result.length > 1) {
    throw new ProjectorError("applied_event_collision");
  }
  return result[0];
}

export async function applyVerifiedPlan(
  database: Database,
  scope: ScopeConfig,
  verified: VerifiedRecord,
  claimant: string,
): Promise<ApplyResult> {
  const eventId = verified.record.event.event_id;
  const receivedSeq = verified.record.receipt.received_seq;
  validateScopeConfig(scope);
  if (
    verified.record.event.project_id !== scope.projectId ||
    verified.record.event.repository_id !== scope.repositoryId
  ) {
    throw new ProjectorError("scope_mismatch");
  }
  assertRuntimeVerified(verified);
  let plan: CorrespondenceYutabasePlan;
  try {
    plan = planCorrespondenceRecord(verified.record, { claimant });
  } catch {
    throw new ProjectorError("record_invalid");
  }
  const stage: { value: string } = { value: "preflight" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    stage.value = "preflight";
    try {
      return await database.begin(async (sql) => {
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      await sql`SET LOCAL lock_timeout = '5s'`;
      await sql`SET LOCAL statement_timeout = '30s'`;
      await preflightProjector(sql);
      await preflightRuntimeAccess(sql);
      await ensureSourceBinding(sql, scope.sourceOrigin, { bind: true });
      if (
        plan.profile !== PLAN_PROFILE ||
        plan.source_scope !== "project_private" ||
        plan.source_event_id !== eventId ||
        plan.limitations.permission_effect !== "none"
      ) {
        throw new ProjectorError("record_invalid");
      }
      const checkpoint = await ensureCheckpoint(sql, scope);
      const last = BigInt(checkpoint.last_received_seq);
      const current = BigInt(receivedSeq);
      const prior = await existingAppliedEvent(
        sql,
        scope,
        eventId,
        receivedSeq,
      );
      if (current <= last) {
        if (
          prior !== undefined &&
          prior.source_event_id === eventId &&
          String(prior.received_seq) === receivedSeq &&
          iso(prior.received_at) ===
            verified.record.receipt.received_at &&
          prior.canonical_sha512 === verified.canonicalSha512 &&
          prior.verified_key_id === verified.verifiedKeyId &&
          prior.verified_public_key_sha256 ===
            verified.verifiedPublicKeySha256
        ) {
          return {
            applied: false,
            replayed: true,
            receivedSeq,
            eventId,
          };
        }
        throw new ProjectorError("receipt_order_invalid");
      }
      if (prior !== undefined) {
        throw new ProjectorError("applied_event_collision");
      }

      for (const card of [...plan.cards].sort((left, right) =>
        left.address.ref.localeCompare(right.address.ref),
      )) {
        stage.value = "card";
        await applyCard(sql, card, scope.projectId);
      }
      for (const relation of [...plan.relations].sort((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        stage.value = "relation";
        await applyRelation(sql, relation);
      }

      stage.value = "applied";
      await sql`
        INSERT INTO agenttool_yutabase.applied_events (
          source_origin,
          source_project_id,
          source_repository_id,
          source_event_id,
          received_seq,
          received_at,
          canonical_sha512,
          verified_key_id,
          verified_public_key_sha256,
          card_count,
          relation_count,
          projected_at
        ) VALUES (
          ${scope.sourceOrigin},
          ${scope.projectId},
          ${scope.repositoryId},
          ${eventId},
          ${receivedSeq},
          ${verified.record.receipt.received_at},
          ${verified.canonicalSha512},
          ${verified.verifiedKeyId},
          ${verified.verifiedPublicKeySha256},
          ${plan.cards.length},
          ${plan.relations.length},
          clock_timestamp()
        )
      `;
      stage.value = "checkpoint";
      await sql`
        UPDATE agenttool_yutabase.projection_checkpoints
        SET
          last_received_seq = ${receivedSeq},
          last_event_id = ${eventId},
          state = 'healthy',
          last_success_at = clock_timestamp(),
          last_error_at = NULL,
          last_error_code = NULL,
          caught_up_at = NULL
        WHERE source_origin = ${scope.sourceOrigin}
          AND source_project_id = ${scope.projectId}
          AND source_repository_id = ${scope.repositoryId}
          AND plan_profile = ${PLAN_PROFILE}
      `;
      return {
        applied: true,
        replayed: false,
        receivedSeq,
        eventId,
      };
      });
    } catch (error) {
      if (error instanceof ProjectorError) throw error;
      const postgresCode = databaseErrorCode(error) ?? "";
      if (isTransientDatabaseError(error)) {
        if (attempt < 3) continue;
        throw new ProjectorError("target_unavailable");
      }
      if (isDatabaseAvailabilityError(error)) {
        throw new ProjectorError("target_unavailable");
      }
      if (postgresCode === "23505") {
        if (stage.value === "card") {
          throw new ProjectorError("card_collision");
        }
        if (stage.value === "relation") {
          throw new ProjectorError("thread_collision");
        }
        if (stage.value === "applied") {
          throw new ProjectorError("applied_event_collision");
        }
      }
      throw new ProjectorError("apply_failed");
    }
  }
  throw new ProjectorError("target_unavailable");
}

export async function quarantineFailure(
  database: Database,
  scope: ScopeConfig,
  input: {
    readonly eventId: string | null;
    readonly receivedSeq: string | null;
    readonly fingerprint: string;
    readonly error: unknown;
  },
): Promise<void> {
  validateScopeConfig(scope);
  const error = asProjectorError(input.error);
  try {
    await transactionWithRetry(database, async (sql) => {
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      await sql`SET LOCAL lock_timeout = '5s'`;
      await sql`SET LOCAL statement_timeout = '15s'`;
      await preflightProjector(sql);
      await preflightRuntimeAccess(sql);
      await ensureSourceBinding(sql, scope.sourceOrigin, { bind: true });
      await ensureCheckpoint(sql, scope);
      await sql`
        INSERT INTO agenttool_yutabase.quarantines (
          source_origin,
          source_project_id,
          source_repository_id,
          plan_profile,
          source_event_id,
          received_seq,
          fingerprint,
          code,
          first_seen_at,
          last_seen_at,
          occurrences
        ) VALUES (
          ${scope.sourceOrigin},
          ${scope.projectId},
          ${scope.repositoryId},
          ${PLAN_PROFILE},
          ${input.eventId},
          ${input.receivedSeq},
          ${input.fingerprint},
          ${error.code},
          clock_timestamp(),
          clock_timestamp(),
          1
        )
        ON CONFLICT (
          source_origin,
          source_project_id,
          source_repository_id,
          plan_profile,
          fingerprint,
          code
        ) DO UPDATE SET
          last_seen_at = EXCLUDED.last_seen_at,
          occurrences = agenttool_yutabase.quarantines.occurrences + 1
      `;
      await sql`
        UPDATE agenttool_yutabase.projection_checkpoints
        SET
          state = 'unhealthy',
          last_error_at = clock_timestamp(),
          last_error_code = ${error.code},
          last_poll_at = clock_timestamp(),
          caught_up_at = NULL
        WHERE source_origin = ${scope.sourceOrigin}
          AND source_project_id = ${scope.projectId}
          AND source_repository_id = ${scope.repositoryId}
          AND plan_profile = ${PLAN_PROFILE}
      `;
    });
  } catch (quarantineError) {
    if (quarantineError instanceof ProjectorError) throw quarantineError;
    throw new ProjectorError("target_unavailable");
  }
}

export async function markCaughtUp(
  database: Database,
  scope: ScopeConfig,
): Promise<void> {
  validateScopeConfig(scope);
  try {
    await transactionWithRetry(database, async (sql) => {
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      await preflightProjector(sql);
      await preflightRuntimeAccess(sql);
      await ensureSourceBinding(sql, scope.sourceOrigin, { bind: true });
      await ensureCheckpoint(sql, scope);
      await sql`
        UPDATE agenttool_yutabase.projection_checkpoints
        SET
          state = 'healthy',
          last_poll_at = clock_timestamp(),
          caught_up_at = clock_timestamp(),
          last_error_at = NULL,
          last_error_code = NULL
        WHERE source_origin = ${scope.sourceOrigin}
          AND source_project_id = ${scope.projectId}
          AND source_repository_id = ${scope.repositoryId}
          AND plan_profile = ${PLAN_PROFILE}
      `;
    });
  } catch (error) {
    if (error instanceof ProjectorError) throw error;
    throw new ProjectorError("target_unavailable");
  }
}

export async function projectionStatus(
  database: Database,
  scope: ScopeConfig,
): Promise<ProjectionStatus> {
  validateScopeConfig(scope);
  try {
    return await transactionWithRetry(database, async (sql) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      await preflightProjector(sql);
      await preflightRuntimeAccess(sql);
      await checkSourceBinding(sql, scope.sourceOrigin);
      const checkpoints = rows<Record<string, unknown>>(
        await sql`
          SELECT
            last_received_seq,
            last_event_id,
            state,
            last_poll_at,
            caught_up_at,
            last_success_at,
            last_error_at,
            last_error_code
          FROM agenttool_yutabase.projection_checkpoints
          WHERE source_origin = ${scope.sourceOrigin}
            AND source_project_id = ${scope.projectId}
            AND source_repository_id = ${scope.repositoryId}
            AND plan_profile = ${PLAN_PROFILE}
        `,
      );
      const quarantine = await sql`
        SELECT count(*)::integer AS count
        FROM agenttool_yutabase.quarantines
        WHERE source_origin = ${scope.sourceOrigin}
          AND source_project_id = ${scope.projectId}
          AND source_repository_id = ${scope.repositoryId}
          AND plan_profile = ${PLAN_PROFILE}
      `;
      const row = checkpoints[0];
      return {
        installed: true,
        state:
          row === undefined
            ? "not_started"
            : (row.state as "healthy" | "unhealthy"),
        lastReceivedSeq:
          row === undefined ? "0" : String(row.last_received_seq),
        lastEventId:
          row === undefined ? null : (row.last_event_id as string | null),
        lastPollAt: row === undefined ? null : iso(row.last_poll_at),
        caughtUpAt: row === undefined ? null : iso(row.caught_up_at),
        lastSuccessAt:
          row === undefined ? null : iso(row.last_success_at),
        lastErrorAt: row === undefined ? null : iso(row.last_error_at),
        lastErrorCode:
          row === undefined ? null : (row.last_error_code as string | null),
        quarantineCount: Number(quarantine[0]?.count ?? 0),
      };
    });
  } catch (error) {
    if (error instanceof ProjectorError) throw error;
    throw new ProjectorError("target_unavailable");
  }
}
