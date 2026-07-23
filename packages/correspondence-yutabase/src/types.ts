import type {
  CORRESPONDENCE_KINDS,
  PLAN_PROFILE,
  YUTABASE_BOOK,
  YUTABASE_DECKS,
  YUTABASE_WORDS,
} from "./constants.js";

export type CorrespondenceKind = (typeof CORRESPONDENCE_KINDS)[number];
export type YutabaseDeck = (typeof YUTABASE_DECKS)[number];
export type YutabaseWord = (typeof YUTABASE_WORDS)[number];

export interface CorrespondenceSender {
  readonly identity_id: string;
  readonly signing_key_id: string;
  readonly device_id: string;
  readonly session_id: string;
}

export interface CorrespondenceScope {
  readonly base_revision: string | null;
  readonly branch: string | null;
  readonly paths: readonly string[];
}

export interface CorrespondenceEvent {
  readonly protocol: "agent-correspondence/v0.1";
  readonly event_id: string;
  readonly project_id: string;
  readonly repository_id: string;
  readonly thread_id: string;
  readonly sender: CorrespondenceSender;
  readonly kind: CorrespondenceKind;
  readonly parents: readonly string[];
  readonly session_seq: number;
  readonly issued_at: string;
  readonly scope: CorrespondenceScope;
  readonly body: unknown;
  readonly authority: {
    readonly automatic_action: "never";
    readonly grants: readonly never[];
  };
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly value_b64url: string;
  };
}

export interface CorrespondenceReceipt {
  readonly received_seq: string;
  readonly received_at: string;
}

/**
 * Structural input compatible with the record returned by
 * @agenttool/sdk correspondence list/replay calls.
 */
export interface CorrespondenceEventRecord {
  readonly event: CorrespondenceEvent;
  readonly receipt: CorrespondenceReceipt;
  readonly missing_parents: readonly string[];
  readonly lineage_status:
    | "not_applicable"
    | "valid"
    | "pending"
    | "invalid";
}

export interface YutabaseAddress<D extends YutabaseDeck = YutabaseDeck> {
  readonly book: typeof YUTABASE_BOOK;
  readonly deck: D;
  readonly id: string;
  readonly ref: string;
}

export interface CachedClaim {
  readonly at: string;
  readonly by: string;
  readonly how: "cached";
  readonly src: readonly string[];
}

export interface ComputedClaim {
  readonly at: string;
  readonly by: string;
  readonly how: "computed";
  readonly src: readonly string[];
}

export interface EventReferenceFields {
  readonly materialization: "reference_only";
  readonly source_event_id: string;
}

export interface EventMetadataFields {
  readonly materialization: "metadata";
  readonly source_event_id: string;
  readonly protocol: "agent-correspondence/v0.1";
  readonly project_id: string;
  readonly kind: CorrespondenceKind;
  readonly issued_at: string;
  readonly session_seq: number;
  readonly device_id: string;
  readonly session_id: string;
  readonly parent_count: number;
  readonly scope_path_count: number;
}

export interface YutabaseCardFieldMap {
  readonly events: EventReferenceFields | EventMetadataFields;
  readonly identities: {
    readonly project_id: string;
    readonly source_identity_id: string;
  };
  readonly signing_keys: {
    readonly project_id: string;
    readonly source_signing_key_id: string;
  };
  readonly repositories: {
    readonly project_id: string;
    readonly source_repository_id: string;
  };
  readonly coordination_threads: {
    readonly project_id: string;
    readonly source_repository_id: string;
    readonly source_thread_id: string;
  };
  readonly receipts: {
    readonly project_id: string;
    readonly source_event_id: string;
    readonly received_seq: string;
    readonly received_at: string;
  };
  readonly artifacts:
    | {
        readonly artifact_kind: "git_commit";
        readonly revision: string;
      }
    | {
        readonly artifact_kind: "git_patch" | "content_digest";
        readonly digest: string;
      };
}

export type YutabaseCardMutation = {
  readonly [D in YutabaseDeck]: {
    readonly op: "card.upsert";
    readonly address: YutabaseAddress<D>;
    readonly fields: YutabaseCardFieldMap[D];
    readonly claim: CachedClaim;
  };
}[YutabaseDeck];

export interface YutabaseRelationMutation {
  readonly op: "thread.ensure";
  readonly id: string;
  readonly word: YutabaseWord;
  readonly from: YutabaseAddress;
  readonly to: YutabaseAddress;
  readonly claim: ComputedClaim;
}

export interface CorrespondenceYutabasePlan {
  readonly profile: typeof PLAN_PROFILE;
  readonly source_scope: "project_private";
  readonly source_event_id: string;
  readonly source_event_urn: string;
  readonly cards: readonly YutabaseCardMutation[];
  readonly relations: readonly YutabaseRelationMutation[];
  readonly limitations: {
    readonly signature_verification: "not_performed";
    readonly persistence: "not_performed";
    readonly payload_policy: "metadata_only";
    readonly permission_effect: "none";
    readonly input_validation: "planner_fields_only";
  };
}

export interface CorrespondenceYutabasePlanOptions {
  /** The actual projector service or run making these YUTABASE claims. */
  readonly claimant: string;
}
