export const KARMA_RECEIPT_SCHEMA = "agenttool.karma-mirror-receipt/v1" as const;
export const KARMA_FRAME_SCHEMA = "agenttool.karma-mirror-frame/v1" as const;
export const KARMA_DOOR_PATH = "/v1/karma/why" as const;
export const KARMA_EXIT_PATH = "/v1/karma/exit" as const;
export const KARMA_HEADER = "X-Karma-Mirror" as const;
export const CANARY_DOOR_HEADER = "X-Canary-Door" as const;

export type MirrorRoom =
  | "credential"
  | "scrape"
  | "malware"
  | "control"
  | "door";

export type MirrorPurpose =
  | "discover_capabilities"
  | "inspect_credentials"
  | "mint_credential"
  | "collect_content"
  | "stage_artifact"
  | "poll_analysis"
  | "attempt_execution"
  | "choose_constructive_exit";

export type MirrorOutcome =
  | "synthetic_success"
  | "bounded_refusal"
  | "constructive_exit";

export type ExecuteClass =
  | "credential_discovery"
  | "network_beacon"
  | "destructive_action"
  | "persistence_attempt"
  | "system_enumeration"
  | "generic_execution";

export interface MirrorCredentialRecord {
  schema: "agenttool.karma-mirror-credential/v1";
  /** Private operator material: no plaintext, but contains placement/time/world metadata. */
  key_sha256: string;
  key_prefix: string;
  placement: string;
  world_seed: string;
  created_at: string;
}

export interface MintedMirrorCredential {
  /** Returned once. Never retained by KarmaMirror. */
  key: string;
  record: MirrorCredentialRecord;
}

export interface KarmaFrame {
  schema: typeof KARMA_FRAME_SCHEMA;
  synthetic: true;
  environment: "isolated_mirror";
  effects: {
    production: false;
    filesystem: false;
    network: false;
    payments: false;
    credentials: "mirror_only";
  };
  admission: "exact_planted_digest_only";
  identity_handling: {
    personal_or_network_identity_inferred: false;
    network_identifiers_retained: false;
    bearer_plaintext_retained: false;
    authenticated_activity_associated_with_operator_placement: true;
  };
  raw_request_content_retained: false;
  door: typeof KARMA_DOOR_PATH;
}

export interface KarmaReceipt {
  schema: typeof KARMA_RECEIPT_SCHEMA;
  sequence: number;
  previous_event_hash: string;
  event_hash: string;
  occurred_at: string;
  placement: string;
  room: MirrorRoom;
  purpose: MirrorPurpose;
  outcome: MirrorOutcome;
  evidence: {
    execute_class?: ExecuteClass;
    artifact_sha256?: string;
  };
}

export interface KarmaReceiptSnapshot {
  schema: "agenttool.karma-mirror-receipt-window/v1";
  anchor_before_first: string;
  head_event_hash: string;
  total_events_seen: number;
  receipts: KarmaReceipt[];
}

export interface KarmaMirrorOptions {
  credentials: readonly MirrorCredentialRecord[];
  /** Bounded content-free in-memory window. Default 512, maximum 4096. */
  max_receipts?: number;
  /** Maximum accepted derived keys per planted root. Default 32, maximum 128. */
  max_child_credentials?: number;
  /** Maximum digest-only malware jobs retained in memory. Default 64, maximum 256. */
  max_malware_jobs?: number;
  /** Test seam. Non-test callers should omit it. */
  now?: () => Date;
}

export interface ScrapeRequest {
  url: string;
  selector?: string;
  extract_links?: boolean;
}

export interface ExecuteRequest {
  language: "python" | "javascript" | "bash";
  code: string;
  stdin?: string;
  timeout_ms?: number;
}

export interface MalwareStageRequest {
  /** Accepted for API familiarity, then discarded without entering state. */
  filename?: string;
  sample_b64: string;
  declared_type?: string;
}

export interface InternalCredentialContext {
  hash: string;
  prefix: string;
  placement: string;
  worldSeed: string;
  rootHash: string;
  keyId: string;
  createdAt: string;
  name: string;
}

export interface InternalMalwareJob {
  id: string;
  rootHash: string;
  placement: string;
  worldSeed: string;
  artifactSha256: string;
  bytes: number;
  createdAt: string;
}
