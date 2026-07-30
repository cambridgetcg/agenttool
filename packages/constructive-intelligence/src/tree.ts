import {
  PIN_ID_DOMAIN,
  RECEIPT_PROTOCOL,
  REVIEWED_TLS_QUEST_NORMATIVE_DIGEST,
  REVIEWED_TLS_QUEST_SCOPE_HASH,
  REVIEWED_TREE_NORMATIVE_DIGEST,
  REVIEWED_TREE_RAW_DIGEST,
  TLS_QUEST_ID,
  TREE_POLICY_VERSION,
  TREE_SCHEMA,
} from "./constants.js";
import { canonicalJson, domainSeparatedId, parseStrictJson, sha256Id } from "./canonical.js";
import { fail } from "./errors.js";
import type { EvidencePin, TreeStandardSnapshot } from "./types.js";

const TOP_KEYS = [
  "authoritative",
  "networkObserved",
  "nodes",
  "policy",
  "policyVersion",
  "releaseBoundary",
  "rewardBearing",
  "roots",
  "schema",
  "snapshotDate",
] as const;

const RELEASE_KEYS = [
  "activatesRewards",
  "addsConsensusBehavior",
  "assertsProtocolSecurity",
  "authorizesSecurityTesting",
  "grantsQualification",
  "movesFunds",
  "performsNetworkRequests",
  "publishesConfidentialEvidence",
] as const;

type ObjectValue = Record<string, unknown>;

function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("pin_error", `${path} must be an object`);
  }
  return value as ObjectValue;
}

function exactKeys(value: ObjectValue, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("pin_error", `${path} has an unknown or missing property`);
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail("pin_error", `${path} must be a string`);
  return value;
}

function date(value: unknown, path: string): string {
  const candidate = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) fail("pin_error", `${path} must be YYYY-MM-DD`);
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== candidate) {
    fail("pin_error", `${path} is not a calendar date`);
  }
  return candidate;
}

function normativeStandardProjection(value: unknown): ObjectValue {
  const standard = object(value, "$.nodes[].standards[]");
  const {
    authorityStatus: _authorityStatus,
    statusCheckedAt: _statusCheckedAt,
    reviewAfter: _reviewAfter,
    ...normative
  } = standard;
  return normative;
}

function normativeNodeProjection(value: unknown): ObjectValue {
  const node = object(value, "$.nodes[]");
  if (!Array.isArray(node.standards)) fail("pin_error", "$.nodes[].standards must be an array");
  return {
    ...node,
    standards: node.standards.map(normativeStandardProjection),
  };
}

export interface InspectedTree {
  readonly raw_digest: `sha256:${string}`;
  readonly tree_normative_digest: string;
  readonly quest_normative_digest: string;
  readonly schema: string;
  readonly policy_version: string;
  readonly snapshot_date: string;
  readonly quest_id: string;
  readonly quest_scope_hash: string;
  readonly standards: TreeStandardSnapshot[];
}

export function inspectTreeBytes(
  bytes: Uint8Array,
  questId: string,
  asOf: string,
): InspectedTree {
  if (questId !== TLS_QUEST_ID) {
    fail("pin_error", `This pilot only admits the pinned TLS quest ${TLS_QUEST_ID}`);
  }
  const rawDigest = sha256Id(bytes);
  if (rawDigest !== `sha256:${REVIEWED_TREE_RAW_DIGEST}`) {
    fail("pin_error", "Tree raw-byte digest is not the reviewed v1 artifact digest");
  }
  const tree = object(parseStrictJson(bytes), "$");
  exactKeys(tree, TOP_KEYS, "$");
  if (tree.schema !== TREE_SCHEMA) fail("pin_error", `Tree schema must be ${TREE_SCHEMA}`);
  if (tree.policyVersion !== TREE_POLICY_VERSION) {
    fail("pin_error", `Tree policyVersion must be ${TREE_POLICY_VERSION}`);
  }
  for (const key of ["authoritative", "networkObserved", "rewardBearing"] as const) {
    if (tree[key] !== false) fail("pin_error", `$.${key} must be false`);
  }
  const release = object(tree.releaseBoundary, "$.releaseBoundary");
  exactKeys(release, RELEASE_KEYS, "$.releaseBoundary");
  for (const key of RELEASE_KEYS) {
    if (release[key] !== false) fail("pin_error", `$.releaseBoundary.${key} must be false`);
  }
  if (!Array.isArray(tree.roots) || !Array.isArray(tree.nodes)) {
    fail("pin_error", "Tree roots and nodes must be arrays");
  }
  const normativeTree = {
    schema: tree.schema,
    policyVersion: tree.policyVersion,
    policy: tree.policy,
    roots: tree.roots,
    nodes: tree.nodes.map(normativeNodeProjection),
  };
  const treeDigest = sha256Id(canonicalJson(normativeTree)).slice("sha256:".length);
  if (treeDigest !== REVIEWED_TREE_NORMATIVE_DIGEST) {
    fail("pin_error", "Tree normative digest is not the reviewed v1 digest");
  }

  const quests = tree.nodes
    .map((node) => object(node, "$.nodes[]"))
    .filter((node) => node.id === questId);
  if (quests.length !== 1) fail("pin_error", `Tree must contain exactly one ${questId}`);
  const quest = quests[0] as ObjectValue;
  const questDigest = sha256Id(canonicalJson(normativeNodeProjection(quest))).slice("sha256:".length);
  if (questDigest !== REVIEWED_TLS_QUEST_NORMATIVE_DIGEST) {
    fail("pin_error", "TLS quest normative digest is not the reviewed v1 digest");
  }
  const acceptance = object(quest.acceptance, "$.quest.acceptance");
  const scopeHash = string(acceptance.scopeHash, "$.quest.acceptance.scopeHash");
  if (!/^[0-9a-f]{64}$/u.test(scopeHash)) fail("pin_error", "Quest scopeHash is malformed");

  if (!Array.isArray(quest.standards) || quest.standards.length === 0) {
    fail("pin_error", "Quest must pin standards");
  }
  const standards = quest.standards.map((item, index): TreeStandardSnapshot => {
    const standard = object(item, `$.quest.standards[${index}]`);
    return {
      canonical_id: string(standard.canonicalId, `$.quest.standards[${index}].canonicalId`),
      revision: string(standard.revision, `$.quest.standards[${index}].revision`),
      specification: string(standard.specification, `$.quest.standards[${index}].specification`),
      status_checked_at: date(
        standard.statusCheckedAt,
        `$.quest.standards[${index}].statusCheckedAt`,
      ),
      review_after: date(standard.reviewAfter, `$.quest.standards[${index}].reviewAfter`),
    };
  });
  const pinnedDate = date(asOf, "as_of");
  for (const standard of standards) {
    if (pinnedDate < standard.status_checked_at || pinnedDate > standard.review_after) {
      fail(
        "pin_error",
        `as_of ${pinnedDate} is outside ${standard.canonical_id}'s reviewed status window`,
      );
    }
  }
  return {
    raw_digest: rawDigest,
    tree_normative_digest: treeDigest,
    quest_normative_digest: questDigest,
    schema: string(tree.schema, "$.schema"),
    policy_version: string(tree.policyVersion, "$.policyVersion"),
    snapshot_date: date(tree.snapshotDate, "$.snapshotDate"),
    quest_id: questId,
    quest_scope_hash: scopeHash,
    standards,
  };
}

export function createPin(
  tree: InspectedTree,
  asOf: string,
  createdAt: string,
): EvidencePin {
  const core = {
    pin_protocol: "zerone.constructive-evidence-pin/v1" as const,
    tree_schema: tree.schema,
    tree_policy_version: tree.policy_version,
    tree_snapshot_date: tree.snapshot_date,
    tree_normative_digest: tree.tree_normative_digest,
    tree_raw_digest: tree.raw_digest,
    quest_id: tree.quest_id,
    quest_normative_digest: tree.quest_normative_digest,
    quest_scope_hash: tree.quest_scope_hash,
    as_of: asOf,
    standards: tree.standards,
    created_at: createdAt,
  };
  return { pin_id: domainSeparatedId(PIN_ID_DOMAIN, core), ...core };
}

export function assertReviewedPin(pin: EvidencePin): void {
  const pinKeys = [
    "as_of",
    "created_at",
    "pin_id",
    "pin_protocol",
    "quest_id",
    "quest_normative_digest",
    "quest_scope_hash",
    "standards",
    "tree_normative_digest",
    "tree_policy_version",
    "tree_raw_digest",
    "tree_schema",
    "tree_snapshot_date",
  ];
  if (
    typeof pin !== "object"
    || pin === null
    || Object.keys(pin).sort().join("\0") !== pinKeys.sort().join("\0")
    || !/^sha256:[0-9a-f]{64}$/u.test(pin.pin_id)
  ) {
    fail("integrity_error", "Stored pin shape is not closed");
  }
  if (
    pin.pin_protocol !== PIN_ID_DOMAIN
    || pin.tree_schema !== TREE_SCHEMA
    || pin.tree_policy_version !== TREE_POLICY_VERSION
    || pin.tree_snapshot_date !== "2026-07-29"
    || pin.tree_normative_digest !== REVIEWED_TREE_NORMATIVE_DIGEST
    || pin.tree_raw_digest !== `sha256:${REVIEWED_TREE_RAW_DIGEST}`
    || pin.quest_id !== TLS_QUEST_ID
    || pin.quest_normative_digest !== REVIEWED_TLS_QUEST_NORMATIVE_DIGEST
    || pin.quest_scope_hash !== REVIEWED_TLS_QUEST_SCOPE_HASH
  ) {
    fail("integrity_error", "Stored pin is not the reviewed shadow pilot pin");
  }
  if (
    !Array.isArray(pin.standards)
    || pin.standards.length !== 2
    || Object.keys(pin.standards[0] ?? {}).sort().join("\0")
      !== ["canonical_id", "review_after", "revision", "specification", "status_checked_at"].join("\0")
    || Object.keys(pin.standards[1] ?? {}).sort().join("\0")
      !== ["canonical_id", "review_after", "revision", "specification", "status_checked_at"].join("\0")
    || pin.standards[0]?.canonical_id !== "ietf:rfc:8446"
    || pin.standards[0]?.revision !== "2018-08"
    || pin.standards[0]?.specification !== "https://www.rfc-editor.org/rfc/rfc8446.html"
    || pin.standards[0]?.status_checked_at !== "2026-07-29"
    || pin.standards[0]?.review_after !== "2026-08-28"
    || pin.standards[1]?.canonical_id !== "ietf:rfc:9846"
    || pin.standards[1]?.revision !== "2026-07"
    || pin.standards[1]?.specification !== "https://www.rfc-editor.org/rfc/rfc9846.html"
    || pin.standards[1]?.status_checked_at !== "2026-07-29"
    || pin.standards[1]?.review_after !== "2026-08-28"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(pin.as_of)
    || pin.as_of < "2026-07-29"
    || pin.as_of > "2026-08-28"
    || pin.created_at !== `${pin.as_of}T00:00:00.000Z`
  ) {
    fail("integrity_error", "Stored pin's reviewed standard window does not verify");
  }
  const { pin_id: _pinId, ...core } = pin;
  if (domainSeparatedId(PIN_ID_DOMAIN, core) !== pin.pin_id) {
    fail("integrity_error", "Stored pin content ID does not verify");
  }
  if (RECEIPT_PROTOCOL !== "zerone.constructive-evidence-receipt/v1") {
    fail("integrity_error", "Receipt protocol constant changed unexpectedly");
  }
}
