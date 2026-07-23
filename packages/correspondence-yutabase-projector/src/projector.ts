import { createHash } from "node:crypto";

import type { CorrespondenceEventRecord } from "@agenttool/correspondence-yutabase";

import {
  applyVerifiedPlan,
  markCaughtUp,
  projectionStatus,
  quarantineFailure,
} from "./apply.js";
import type { RunConfig } from "./config.js";
import type { Database } from "./database.js";
import { ProjectorError, asProjectorError } from "./errors.js";
import {
  SourceClient,
  type SourcePage,
  type SourceSigningKey,
} from "./source.js";
import {
  fingerprintClosedRecord,
  fingerprintUnknownRecord,
  validateClosedRecord,
  verifyClosedRecord,
} from "./verify.js";

const EVENT_ID = /^sha256:[0-9a-f]{64}$/;
const RECEIPT = /^[1-9][0-9]*$/;

export interface RunOnceResult {
  readonly applied: number;
  readonly replayed: number;
  readonly lastReceivedSeq: string;
  readonly caughtUp: true;
}

function candidateLocator(raw: unknown): {
  eventId: string | null;
  receivedSeq: string | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { eventId: null, receivedSeq: null };
  }
  const record = raw as Record<string, unknown>;
  const event =
    record.event !== null &&
    typeof record.event === "object" &&
    !Array.isArray(record.event)
      ? (record.event as Record<string, unknown>)
      : undefined;
  const receipt =
    record.receipt !== null &&
    typeof record.receipt === "object" &&
    !Array.isArray(record.receipt)
      ? (record.receipt as Record<string, unknown>)
      : undefined;
  const eventId =
    typeof event?.event_id === "string" && EVENT_ID.test(event.event_id)
      ? event.event_id
      : null;
  const receivedSeq =
    typeof receipt?.received_seq === "string" &&
    RECEIPT.test(receipt.received_seq) &&
    BigInt(receipt.received_seq) <= 9_223_372_036_854_775_807n
      ? receipt.received_seq
      : null;
  return { eventId, receivedSeq };
}

function recordFingerprint(
  raw: unknown,
  closed: CorrespondenceEventRecord | undefined,
): string {
  if (closed !== undefined) {
    return fingerprintClosedRecord(closed);
  }
  return fingerprintUnknownRecord(raw);
}

export async function runOnce(
  database: Database,
  config: RunConfig,
  options: { source?: SourceClient } = {},
): Promise<RunOnceResult> {
  const source = options.source ?? new SourceClient(config);
  source.assertBoundTo(config);
  const initial = await projectionStatus(database, config);
  let after = initial.lastReceivedSeq;
  let applied = 0;
  let replayed = 0;
  const keys = new Map<string, SourceSigningKey>();
  let pages = 0;

  const failScope = async (error: unknown): Promise<never> => {
    const safe = asProjectorError(error);
    if (safe.code === "target_unavailable") throw safe;
    const fingerprint = createHash("sha512")
      .update(config.sourceOrigin, "utf8")
      .update(Buffer.from([0]))
      .update(config.projectId, "utf8")
      .update(Buffer.from([0]))
      .update(config.repositoryId, "utf8")
      .update(Buffer.from([0]))
      .update(after, "utf8")
      .update(Buffer.from([0]))
      .update(safe.code, "utf8")
      .digest("hex");
    await quarantineFailure(database, config, {
      eventId: null,
      receivedSeq: null,
      fingerprint,
      error: safe,
    });
    throw safe;
  };

  while (true) {
    pages += 1;
    if (pages > 100_000) {
      await failScope(new ProjectorError("source_protocol_invalid"));
    }
    let page: SourcePage;
    try {
      page = await source.list(config.repositoryId, after);
    } catch (error) {
      return await failScope(error);
    }
    const prepared: Array<{
      raw: unknown;
      closed: CorrespondenceEventRecord;
    }> = [];
    let previewLast = after;
    for (const raw of page.events) {
      let closed: CorrespondenceEventRecord | undefined;
      try {
        closed = validateClosedRecord(raw);
        if (
          closed.event.project_id !== config.projectId ||
          closed.event.repository_id !== config.repositoryId
        ) {
          throw new ProjectorError("scope_mismatch");
        }
        if (BigInt(closed.receipt.received_seq) <= BigInt(previewLast)) {
          throw new ProjectorError("receipt_order_invalid");
        }
        previewLast = closed.receipt.received_seq;
        prepared.push({ raw, closed });
      } catch (error) {
        const safe = asProjectorError(error);
        const locator = candidateLocator(raw);
        await quarantineFailure(database, config, {
          eventId: locator.eventId,
          receivedSeq: locator.receivedSeq,
          fingerprint: recordFingerprint(raw, closed),
          error: safe,
        });
        throw safe;
      }
    }
    if (
      page.events.length > 0 &&
      (page.nextAfter === null || page.nextAfter !== previewLast)
    ) {
      await failScope(new ProjectorError("source_protocol_invalid"));
    }

    let pageLast = after;
    for (const item of prepared) {
      const { raw, closed } = item;
      try {
        const cacheKey = `${closed.event.sender.identity_id}/${closed.event.sender.signing_key_id}`;
        let key = keys.get(cacheKey);
        if (key === undefined) {
          key = await source.signingKey(
            closed.event.sender.identity_id,
            closed.event.sender.signing_key_id,
          );
          if (keys.size >= 1024) keys.clear();
          keys.set(cacheKey, key);
        }
        const verified = verifyClosedRecord(raw, key.publicKey, {
          projectId: config.projectId,
          repositoryId: config.repositoryId,
        });
        const result = await applyVerifiedPlan(
          database,
          config,
          verified,
          config.claimant,
        );
        if (result.applied) applied += 1;
        if (result.replayed) replayed += 1;
        pageLast = result.receivedSeq;
        after = result.receivedSeq;
      } catch (error) {
        const safe = asProjectorError(error);
        if (safe.code === "target_unavailable") throw safe;
        const locator = candidateLocator(raw);
        await quarantineFailure(database, config, {
          eventId: locator.eventId,
          receivedSeq: locator.receivedSeq,
          fingerprint: recordFingerprint(raw, item.closed),
          error: safe,
        });
        throw safe;
      }
    }
    if (!page.hasMore) {
      await markCaughtUp(database, config);
      return {
        applied,
        replayed,
        lastReceivedSeq: after,
        caughtUp: true,
      };
    }
    if (page.nextAfter === null || page.nextAfter !== after) {
      await failScope(new ProjectorError("source_protocol_invalid"));
    }
  }
}
