import type {
  INPUT_PROTOCOL,
  INPUT_SCHEMA_ID,
  INSPECTION_KIND,
  INSPECTION_SCHEMA_ID,
  INSPECTION_SCHEMA_VERSION,
  INSPECTOR_NAME,
  PLAN_PROFILE,
  REPORT_DIGEST_SEMANTICS,
  SKILL_CONTENT_DIGEST_SEMANTICS,
  YUTABASE_BOOK,
  YUTABASE_DECKS,
  YUTABASE_WORDS,
} from "./constants.js";

export type YutabaseDeck = (typeof YUTABASE_DECKS)[number];
export type YutabaseWord = (typeof YUTABASE_WORDS)[number];

export interface MinimizedSkillSnapshot {
  readonly name: string;
  readonly content_digest: string;
  readonly file_count: number;
  readonly script_count: number;
  readonly resource_count: number;
}

export interface SkillsYutabaseInput {
  readonly $schema: typeof INPUT_SCHEMA_ID;
  readonly protocol: typeof INPUT_PROTOCOL;
  readonly project_id: string;
  readonly recorded_at: string;
  readonly source: {
    readonly kind: typeof INSPECTION_KIND;
    readonly report_schema: typeof INSPECTION_SCHEMA_ID;
    readonly report_schema_version: typeof INSPECTION_SCHEMA_VERSION;
    readonly report_digest: string;
    readonly report_digest_semantics: typeof REPORT_DIGEST_SEMANTICS;
    readonly report_valid: true;
    readonly inspector_name: typeof INSPECTOR_NAME;
    readonly inspector_version: string;
    readonly inspector_revision: string;
    readonly mode: "read-only";
  };
  readonly selection_summary: {
    readonly skills: number;
    readonly files: number;
    readonly scripts: number;
    readonly resources: number;
    readonly errors: 0;
    readonly warnings: number;
    readonly redactions: number;
  };
  readonly skills: readonly MinimizedSkillSnapshot[];
  readonly authority: {
    readonly automatic_action: "never";
    readonly grants: readonly never[];
  };
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

export interface YutabaseCardFieldMap {
  readonly inspections: {
    readonly project_id: string;
    readonly source_kind: typeof INSPECTION_KIND;
    readonly report_schema: typeof INSPECTION_SCHEMA_ID;
    readonly report_schema_version: typeof INSPECTION_SCHEMA_VERSION;
    readonly report_digest: string;
    readonly report_digest_semantics: typeof REPORT_DIGEST_SEMANTICS;
    readonly source_report_validity: "caller_supplied_valid";
    readonly selection_digest: string;
    readonly inspector_name: typeof INSPECTOR_NAME;
    readonly inspector_version: string;
    readonly inspector_revision: string;
    readonly inspector_mode: "read-only";
    readonly selected_skill_count: number;
    readonly selected_file_count: number;
    readonly selected_script_count: number;
    readonly selected_resource_count: number;
    readonly error_count: 0;
    readonly warning_count: number;
    readonly redaction_count: number;
  };
  readonly skill_snapshots: {
    readonly project_id: string;
    readonly source_report_digest: string;
    readonly name: string;
    readonly content_digest: string;
    readonly content_digest_semantics: typeof SKILL_CONTENT_DIGEST_SEMANTICS;
    readonly file_count: number;
    readonly script_count: number;
    readonly resource_count: number;
    readonly interpretation: "not_performed";
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
  readonly from: YutabaseAddress<"inspections">;
  readonly to: YutabaseAddress<"skill_snapshots">;
  readonly claim: ComputedClaim;
}

export interface SkillsYutabasePlan {
  readonly profile: typeof PLAN_PROFILE;
  readonly source_scope: "project_private";
  readonly source_report_digest: string;
  readonly selection_digest: string;
  readonly cards: readonly YutabaseCardMutation[];
  readonly relations: readonly YutabaseRelationMutation[];
  readonly limitations: {
    readonly source_report_schema_validation: "not_performed";
    readonly report_digest_verification: "not_performed";
    readonly skill_content_digest_verification: "not_performed";
    readonly publisher_authentication: "not_performed";
    readonly skill_interpretation: "not_performed";
    readonly safety_evaluation: "not_performed";
    readonly persistence: "not_performed";
    readonly model_execution: "not_performed";
    readonly embedding_generation: "not_performed";
    readonly raw_skill_content: "not_accepted";
    readonly payload_policy: "metadata_only";
    readonly permission_effect: "none";
    readonly consent_effect: "none";
    readonly truth_effect: "none";
    readonly score_rank_xp_effect: "none";
    readonly dignity_effect: "none";
    readonly action_effect: "none";
  };
}

export interface SkillsYutabasePlanOptions {
  /** The actual projector service or run making these YUTABASE claims. */
  readonly claimant: string;
}
