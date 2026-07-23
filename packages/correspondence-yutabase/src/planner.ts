import {
  ACKNOWLEDGEMENT_KINDS,
  CORRESPONDENCE_KINDS,
  CORRESPONDENCE_PROTOCOL,
  PLAN_PROFILE,
  PROJECTION_POLICY_URN,
  YUTABASE_BOOK,
} from "./constants.js";
import {
  correspondenceEventUrn,
  correspondenceReceiptUrn,
  projectionUuid,
} from "./identifiers.js";
import type {
  CachedClaim,
  ComputedClaim,
  CorrespondenceEvent,
  CorrespondenceEventRecord,
  CorrespondenceKind,
  CorrespondenceYutabasePlan,
  CorrespondenceYutabasePlanOptions,
  YutabaseAddress,
  YutabaseCardFieldMap,
  YutabaseCardMutation,
  YutabaseDeck,
  YutabaseRelationMutation,
  YutabaseWord,
} from "./types.js";

const EVENT_ID = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECEIPT_SEQUENCE = /^[1-9][0-9]*$/;
const RFC3339_MILLISECONDS =
  /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const FORBIDDEN_OPAQUE_ID_TEXT = /[\p{White_Space}\p{Cc}\uFEFF]/u;

const KIND_SET = new Set<string>(CORRESPONDENCE_KINDS);
const ACKNOWLEDGEMENT_SET = new Set<string>(ACKNOWLEDGEMENT_KINDS);

export class CorrespondenceYutabasePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrespondenceYutabasePlanError";
  }
}

function assertOpaqueId(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  const scalarLength = Array.from(value).length;
  if (
    scalarLength < 1 ||
    scalarLength > 256 ||
    FORBIDDEN_OPAQUE_ID_TEXT.test(value)
  ) {
    fail(path, "expected 1–256 Unicode scalar values without whitespace or control characters");
  }
}

function fail(path: string, expectation: string): never {
  throw new CorrespondenceYutabasePlanError(path + ": " + expectation);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail(path, "expected a string");
}

function assertCanonicalUuid(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!CANONICAL_UUID.test(value)) {
    fail(path, "expected a canonical lowercase UUID");
  }
}

function assertEventId(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!EVENT_ID.test(value)) {
    fail(path, "expected sha256:<64 lowercase hex>");
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!RFC3339_MILLISECONDS.test(value)) {
    fail(path, "expected exact UTC RFC3339 milliseconds");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(path, "expected a real UTC instant");
  }
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function assertEventKind(value: unknown): asserts value is CorrespondenceKind {
  assertString(value, "event.kind");
  if (!KIND_SET.has(value)) fail("event.kind", "unsupported Correspondence kind");
}

/**
 * Checks only the structural fields consumed by this planner. It does not
 * validate RFC 8785 bytes, recompute event_id, resolve a public key, or verify
 * the Ed25519 signature.
 */
export function assertCorrespondencePlannerInput(
  record: CorrespondenceEventRecord,
): void {
  const event = asObject(record?.event, "record.event");
  if (event.protocol !== CORRESPONDENCE_PROTOCOL) {
    fail("event.protocol", "expected " + CORRESPONDENCE_PROTOCOL);
  }
  assertEventId(event.event_id, "event.event_id");
  assertCanonicalUuid(event.project_id, "event.project_id");
  assertOpaqueId(event.repository_id, "event.repository_id");
  assertOpaqueId(event.thread_id, "event.thread_id");
  assertEventKind(event.kind);
  assertTimestamp(event.issued_at, "event.issued_at");
  if (!Number.isSafeInteger(event.session_seq) || (event.session_seq as number) < 1) {
    fail("event.session_seq", "expected a positive safe integer");
  }

  const sender = asObject(event.sender, "event.sender");
  assertCanonicalUuid(sender.identity_id, "event.sender.identity_id");
  assertCanonicalUuid(sender.signing_key_id, "event.sender.signing_key_id");
  assertCanonicalUuid(sender.device_id, "event.sender.device_id");
  assertCanonicalUuid(sender.session_id, "event.sender.session_id");

  if (!Array.isArray(event.parents)) fail("event.parents", "expected an array");
  for (const [index, parent] of event.parents.entries()) {
    assertEventId(parent, "event.parents[" + index + "]");
  }

  const scope = asObject(event.scope, "event.scope");
  if (!Array.isArray(scope.paths)) fail("event.scope.paths", "expected an array");

  const authority = asObject(event.authority, "event.authority");
  if (
    authority.automatic_action !== "never" ||
    !Array.isArray(authority.grants) ||
    authority.grants.length !== 0
  ) {
    fail(
      "event.authority",
      "expected { automatic_action: \"never\", grants: [] }",
    );
  }

  const signature = asObject(event.signature, "event.signature");
  if (
    signature.algorithm !== "Ed25519" ||
    typeof signature.value_b64url !== "string" ||
    !BASE64URL_SIGNATURE.test(signature.value_b64url)
  ) {
    fail(
      "event.signature",
      "expected a structurally canonical Ed25519 signature",
    );
  }

  const receipt = asObject(record.receipt, "record.receipt");
  assertString(receipt.received_seq, "receipt.received_seq");
  if (!RECEIPT_SEQUENCE.test(receipt.received_seq)) {
    fail("receipt.received_seq", "expected a positive canonical decimal");
  }
  assertTimestamp(receipt.received_at, "receipt.received_at");

  if (!Array.isArray(record.missing_parents)) {
    fail("record.missing_parents", "expected an array");
  }
  for (const [index, missing] of record.missing_parents.entries()) {
    assertEventId(missing, "record.missing_parents[" + index + "]");
  }
  if (
    record.lineage_status !== "not_applicable" &&
    record.lineage_status !== "valid" &&
    record.lineage_status !== "pending" &&
    record.lineage_status !== "invalid"
  ) {
    fail("record.lineage_status", "unsupported lineage status");
  }
}

function address<D extends YutabaseDeck>(
  deck: D,
  id: string,
): YutabaseAddress<D> {
  return {
    book: YUTABASE_BOOK,
    deck,
    id,
    ref: [YUTABASE_BOOK, deck, id].join("/"),
  };
}

function cachedClaim(
  at: string,
  claimant: string,
  ...src: string[]
): CachedClaim {
  return {
    at,
    by: claimant,
    how: "cached",
    src,
  };
}

function computedClaim(
  at: string,
  claimant: string,
  ...sourceLocators: string[]
): ComputedClaim {
  return {
    at,
    by: claimant,
    how: "computed",
    src: [...sourceLocators, PROJECTION_POLICY_URN],
  };
}

function card<D extends YutabaseDeck>(
  deck: D,
  id: string,
  fields: YutabaseCardFieldMap[D],
  claim: CachedClaim,
): YutabaseCardMutation {
  return {
    op: "card.upsert",
    address: address(deck, id),
    fields,
    claim,
  } as YutabaseCardMutation;
}

function relation(
  word: YutabaseWord,
  from: YutabaseAddress,
  to: YutabaseAddress,
  claim: ComputedClaim,
): YutabaseRelationMutation {
  return {
    op: "thread.ensure",
    id: projectionUuid("relation", word, from.ref, to.ref),
    word,
    from,
    to,
    claim,
  };
}

function acknowledgementTarget(event: CorrespondenceEvent): string | undefined {
  if (!ACKNOWLEDGEMENT_SET.has(event.kind)) return undefined;
  const body = asObject(event.body, "event.body");
  assertEventId(body.target_event_id, "event.body.target_event_id");
  if (!event.parents.includes(body.target_event_id)) {
    fail(
      "event.parents",
      "acknowledgement target_event_id must also appear in parents",
    );
  }
  return body.target_event_id;
}

type ArtifactMetadata = YutabaseCardFieldMap["artifacts"];

function artifactMetadata(
  event: CorrespondenceEvent,
): ArtifactMetadata | undefined {
  if (event.kind !== "artifact.offer") return undefined;
  const body = asObject(event.body, "event.body");
  const artifact = asObject(body.artifact, "event.body.artifact");
  if (artifact.kind === "git_commit") {
    assertString(artifact.revision, "event.body.artifact.revision");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(artifact.revision)) {
      fail("event.body.artifact.revision", "expected a 40 or 64 hex Git revision");
    }
    return {
      artifact_kind: "git_commit",
      revision: artifact.revision,
    };
  }
  if (artifact.kind === "git_patch" || artifact.kind === "content_digest") {
    assertEventId(artifact.digest, "event.body.artifact.digest");
    return {
      artifact_kind: artifact.kind,
      digest: artifact.digest,
    };
  }
  fail("event.body.artifact.kind", "unsupported artifact kind");
}

function artifactIdentity(metadata: ArtifactMetadata): readonly string[] {
  return metadata.artifact_kind === "git_commit"
    ? [metadata.artifact_kind, metadata.revision]
    : [metadata.artifact_kind, metadata.digest];
}

/**
 * Produces deterministic, side-effect-free card/thread intentions.
 *
 * The result is not SQL, does not write a database, and does not independently
 * verify the source signature. A host must perform those operations explicitly.
 */
export function planCorrespondenceRecord(
  record: CorrespondenceEventRecord,
  options: CorrespondenceYutabasePlanOptions,
): CorrespondenceYutabasePlan {
  assertCorrespondencePlannerInput(record);
  assertString(options?.claimant, "options.claimant");
  if (options.claimant.trim().length === 0) {
    fail("options.claimant", "must not be empty or whitespace");
  }
  if (options.claimant.includes("\u0000")) {
    fail("options.claimant", "must not contain NUL");
  }
  const event = record.event;
  const eventUrn = correspondenceEventUrn(event.event_id);
  const receiptUrn = correspondenceReceiptUrn(
    event.project_id,
    event.event_id,
    record.receipt.received_seq,
  );
  const claimAt = record.receipt.received_at;

  const eventAddress = address(
    "events",
    projectionUuid("event", event.event_id),
  );
  const identityAddress = address(
    "identities",
    projectionUuid("identity", event.project_id, event.sender.identity_id),
  );
  const keyAddress = address(
    "signing_keys",
    projectionUuid("signing_key", event.project_id, event.sender.signing_key_id),
  );
  const repositoryAddress = address(
    "repositories",
    projectionUuid("repository", event.project_id, event.repository_id),
  );
  const coordinationThreadAddress = address(
    "coordination_threads",
    projectionUuid(
      "coordination_thread",
      event.project_id,
      event.repository_id,
      event.thread_id,
    ),
  );
  const receiptAddress = address(
    "receipts",
    projectionUuid(
      "receipt",
      event.project_id,
      event.event_id,
      record.receipt.received_seq,
    ),
  );

  const cards = new Map<string, YutabaseCardMutation>();
  const relations = new Map<string, YutabaseRelationMutation>();
  const addCard = (mutation: YutabaseCardMutation): void => {
    if (!cards.has(mutation.address.ref)) cards.set(mutation.address.ref, mutation);
  };
  const addRelation = (mutation: YutabaseRelationMutation): void => {
    if (!relations.has(mutation.id)) relations.set(mutation.id, mutation);
  };

  addCard(
    card(
      "events",
      eventAddress.id,
      {
        materialization: "metadata",
        source_event_id: event.event_id,
        protocol: event.protocol,
        project_id: event.project_id,
        kind: event.kind,
        issued_at: event.issued_at,
        session_seq: event.session_seq,
        device_id: event.sender.device_id,
        session_id: event.sender.session_id,
        parent_count: event.parents.length,
        scope_path_count: event.scope.paths.length,
      },
      cachedClaim(claimAt, options.claimant, eventUrn),
    ),
  );
  addCard(
    card(
      "identities",
      identityAddress.id,
      {
        project_id: event.project_id,
        source_identity_id: event.sender.identity_id,
      },
      cachedClaim(claimAt, options.claimant, eventUrn),
    ),
  );
  addCard(
    card(
      "signing_keys",
      keyAddress.id,
      {
        project_id: event.project_id,
        source_signing_key_id: event.sender.signing_key_id,
      },
      cachedClaim(claimAt, options.claimant, eventUrn),
    ),
  );
  addCard(
    card(
      "repositories",
      repositoryAddress.id,
      {
        project_id: event.project_id,
        source_repository_id: event.repository_id,
      },
      cachedClaim(claimAt, options.claimant, eventUrn),
    ),
  );
  addCard(
    card(
      "coordination_threads",
      coordinationThreadAddress.id,
      {
        project_id: event.project_id,
        source_repository_id: event.repository_id,
        source_thread_id: event.thread_id,
      },
      cachedClaim(claimAt, options.claimant, eventUrn),
    ),
  );
  addCard(
    card(
      "receipts",
      receiptAddress.id,
      {
        project_id: event.project_id,
        source_event_id: event.event_id,
        received_seq: record.receipt.received_seq,
        received_at: record.receipt.received_at,
      },
      cachedClaim(claimAt, options.claimant, receiptUrn, eventUrn),
    ),
  );

  const relationClaim = computedClaim(claimAt, options.claimant, eventUrn);
  const receiptRelationClaim = computedClaim(
    claimAt,
    options.claimant,
    eventUrn,
    receiptUrn,
  );
  addRelation(
    relation("reported_by", eventAddress, identityAddress, relationClaim),
  );
  addRelation(
    relation("names_signing_key", eventAddress, keyAddress, relationClaim),
  );
  addRelation(
    relation("about_repository", eventAddress, repositoryAddress, relationClaim),
  );
  addRelation(
    relation(
      "in_coordination_thread",
      eventAddress,
      coordinationThreadAddress,
      relationClaim,
    ),
  );
  addRelation(
    relation("names_receipt", eventAddress, receiptAddress, receiptRelationClaim),
  );

  const eventReferences = new Map<string, YutabaseAddress<"events">>();
  const ensureEventReference = (sourceEventId: string): YutabaseAddress<"events"> => {
    const existing = eventReferences.get(sourceEventId);
    if (existing) return existing;
    const referenced = address(
      "events",
      projectionUuid("event", sourceEventId),
    );
    eventReferences.set(sourceEventId, referenced);
    if (sourceEventId !== event.event_id) {
      addCard(
        card(
          "events",
          referenced.id,
          {
            materialization: "reference_only",
            source_event_id: sourceEventId,
          },
          cachedClaim(claimAt, options.claimant, eventUrn),
        ),
      );
    }
    return referenced;
  };

  for (const parentId of event.parents) {
    addRelation(
      relation(
        "depends_on",
        eventAddress,
        ensureEventReference(parentId),
        relationClaim,
      ),
    );
  }

  const targetEventId = acknowledgementTarget(event);
  if (targetEventId) {
    addRelation(
      relation(
        "acknowledges",
        eventAddress,
        ensureEventReference(targetEventId),
        relationClaim,
      ),
    );
  }

  const artifact = artifactMetadata(event);
  if (artifact) {
    const artifactAddress = address(
      "artifacts",
      projectionUuid("artifact", event.project_id, ...artifactIdentity(artifact)),
    );
    addCard(
      card(
        "artifacts",
        artifactAddress.id,
        artifact,
        cachedClaim(claimAt, options.claimant, eventUrn),
      ),
    );
    addRelation(
      relation(
        "offers_artifact",
        eventAddress,
        artifactAddress,
        relationClaim,
      ),
    );
  }

  return {
    profile: PLAN_PROFILE,
    source_scope: "project_private",
    source_event_id: event.event_id,
    source_event_urn: eventUrn,
    cards: [...cards.values()],
    relations: [...relations.values()],
    limitations: {
      signature_verification: "not_performed",
      persistence: "not_performed",
      payload_policy: "metadata_only",
      permission_effect: "none",
      input_validation: "planner_fields_only",
    },
  };
}
