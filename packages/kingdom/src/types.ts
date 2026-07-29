import type {
  KINGDOM_DOMAINS,
  KINGDOM_KINDS,
  KINGDOM_LAYERS,
  KINGDOM_OWNER_SISTERS,
  KINGDOM_STATES,
} from "./constants.js";
import type {
  KINGDOM_CARD_SCHEMA_VERSION,
  KINGDOM_REGISTRY_SCHEMA_VERSION,
} from "./constants.js";

export type KingdomKind = (typeof KINGDOM_KINDS)[number];
export type KingdomLayer = (typeof KINGDOM_LAYERS)[number];
export type KingdomOwnerSister = (typeof KINGDOM_OWNER_SISTERS)[number];
export type KingdomDomain = (typeof KINGDOM_DOMAINS)[number];
export type KingdomState = (typeof KINGDOM_STATES)[number];
export type KingdomAdoptionId = "xenia.rights/0.1";

export interface KingdomCard {
  readonly schema_version: typeof KINGDOM_CARD_SCHEMA_VERSION;
  readonly name: string;
  readonly kind: KingdomKind;
  readonly layer: KingdomLayer;
  readonly owner_sister: KingdomOwnerSister;
  readonly domain: KingdomDomain;
  readonly state: KingdomState;
  readonly purpose: string;
  readonly dependsOn: readonly string[];
  readonly adopts: readonly KingdomAdoptionId[];
}

export type KingdomDiagnosticCode =
  | "source-too-large"
  | "too-many-lines"
  | "invalid-character"
  | "malformed-line"
  | "malformed-value"
  | "unknown-field"
  | "duplicate-field"
  | "missing-field"
  | "invalid-schema-version"
  | "invalid-type"
  | "invalid-enum"
  | "invalid-format"
  | "too-many-items"
  | "duplicate-item"
  | "self-dependency"
  | "unknown-dependency"
  | "unsupported-adoption"
  | "invalid-observed-at"
  | "duplicate-member"
  | "registry-size";

export interface KingdomDiagnostic {
  readonly code: KingdomDiagnosticCode;
  readonly message: string;
  readonly field?: string;
  readonly line?: number;
  readonly card_index?: number;
}

export type KingdomCardValidationResult =
  | {
      readonly valid: true;
      readonly card: KingdomCard;
      readonly diagnostics: readonly KingdomDiagnostic[];
    }
  | {
      readonly valid: false;
      readonly card: null;
      readonly diagnostics: readonly KingdomDiagnostic[];
    };

export interface KingdomCardValidationOptions {
  /**
   * When supplied, every dependency must match one of these names
   * case-insensitively. Omitting it performs structural validation only.
   */
  readonly knownNames?: readonly string[];
}

export type KingdomCardParseResult = KingdomCardValidationResult;

export interface KingdomRegistryMember {
  readonly name: string;
  readonly kind: KingdomKind;
  readonly layer: KingdomLayer;
  readonly owner_sister: KingdomOwnerSister;
  readonly domain: KingdomDomain;
  readonly state: KingdomState;
  readonly purpose: string;
}

export interface KingdomDependencyEdge {
  readonly from: string;
  readonly to: string;
}

export interface KingdomAdoptionDeclaration {
  readonly member: string;
  readonly adoption: KingdomAdoptionId;
}

export interface KingdomRegistry {
  readonly schema_version: typeof KINGDOM_REGISTRY_SCHEMA_VERSION;
  readonly observed_at: string;
  readonly declaration_boundary: string;
  readonly members: readonly KingdomRegistryMember[];
  readonly dependency_edges: readonly KingdomDependencyEdge[];
  readonly adoption_declarations: readonly KingdomAdoptionDeclaration[];
}

export interface KingdomRegistryBuildOptions {
  /**
   * A caller-supplied canonical UTC timestamp. The builder never reads a clock.
   */
  readonly observedAt: string;
}

export type KingdomRegistryBuildResult =
  | {
      readonly valid: true;
      readonly registry: KingdomRegistry;
      readonly diagnostics: readonly KingdomDiagnostic[];
    }
  | {
      readonly valid: false;
      readonly registry: null;
      readonly diagnostics: readonly KingdomDiagnostic[];
    };

export interface KingdomSurfaceManifestOptions {
  readonly serviceName: string;
  readonly canonicalUrl: string;
  readonly registryUrl: string;
  readonly description?: string;
  readonly documentationUrl?: string;
}
