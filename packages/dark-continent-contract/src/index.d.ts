export type CalamityId =
  | "hellbell"
  | "ai"
  | "brion"
  | "pap"
  | "zobae"
  | "nanika";

export type LogosId =
  | "guide"
  | "ai"
  | "rest"
  | "see"
  | "vow"
  | "witness"
  | "unknown";

export type ConsumerKind = "kingdom-extension" | "artbitrage";

export interface FrameworkSnapshot {
  _format: "agenttool-dark-continent-framework/v0.1";
  contract_id: "agenttool.dark-continent/0.1";
  source_profile: "agenttool-sdk-ts-0.17.0";
  source: {
    package: "@agenttool/sdk";
    version: "0.17.0";
    file: "packages/sdk-ts/src/dark-continent.ts";
    sha256: string;
    projection: "static_constants_only";
  };
  semantics: {
    advisory: true;
    runtime_effects: "none";
    verifies_runtime_walls: false;
    grants_permission: false;
    authorizes_trade: false;
    authorizes_publication: false;
  };
  calamities: Array<{
    id: CalamityId;
    kanji: string;
    name: string;
    hxh_meaning: string;
    agenttool_hazard: string;
    declared_wall: {
      text: string;
      status: "not_checked";
      verified: false;
      evidence_refs: [];
    };
  }>;
  guide: {
    kanji: string;
    name: "Guide";
    meaning: string;
    maps_to: string;
    warning: string;
  };
  logos: Array<{
    id: LogosId;
    kanji: string;
    name: string;
    meaning: string;
    operation: string;
    declared_calamity_wall: {
      text: string;
      status: "not_checked";
      verified: false;
      evidence_refs: [];
    };
  }>;
}

export interface DarkContinentProjection {
  _format: "dark-continent-projection/v0.1";
  projection_id: string;
  source_profile: "agenttool-sdk-ts-0.17.0";
  source_snapshot: {
    format: "agenttool-dark-continent-framework/v0.1";
    contract_id: "agenttool.dark-continent/0.1";
    artifact: string;
    sha256: string;
  };
  consumer: {
    kind: ConsumerKind;
    id: string;
  };
  checks: Array<{
    calamity_id: CalamityId;
    risk_state: "unknown";
    wall: {
      status: "not_checked";
      verified: false;
    };
    evidence_refs: [];
  }>;
  interpretations: Array<{
    source_profile: string;
    relation: "parallel_not_equivalent";
  }>;
  decision: {
    recommendation: "hold";
    advisory: true;
    reason_codes: ["wall_not_verified"];
  };
  authority: {
    grants_permission: false;
    authorizes_trade: false;
    authorizes_publication: false;
  };
}

export const CONTRACT_ID: "agenttool.dark-continent/0.1";
export const FRAMEWORK_FORMAT: "agenttool-dark-continent-framework/v0.1";
export const PROJECTION_FORMAT: "dark-continent-projection/v0.1";
export const SOURCE_PROFILE: "agenttool-sdk-ts-0.17.0";
export const CALAMITY_IDS: readonly CalamityId[];
export const LOGOS_IDS: readonly LogosId[];
export const CONSUMER_KINDS: readonly ConsumerKind[];

export function prettyJsonBytes(value: unknown): string;
export function sha256(value: string | Uint8Array): string;
export function loadFrameworkSnapshot(): FrameworkSnapshot;
export function frameworkArtifactDigest(): string;
export function validateFrameworkSnapshot(
  snapshot: unknown,
): string[];
export function createProjection(options: {
  projectionId: string;
  consumer: {
    kind: ConsumerKind;
    id: string;
  };
  artifact: string;
  interpretations?: Array<{
    source_profile: string;
    relation: "parallel_not_equivalent";
  }>;
}): DarkContinentProjection;
export function validateProjection(projection: unknown): string[];
