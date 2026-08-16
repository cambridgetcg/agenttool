import type {
  PublicSurfaceBinding,
  RecordSignature,
  RecordSigner,
  Sha256Id,
} from "@agenttool/public-surface-binding";

import type {
  ADOPTION_BOUNDARIES,
  RECORD_SCHEMAS,
  REQUESTED_VISIBILITIES,
  WAKE_PROJECTIONS,
  WITHDRAWAL_BOUNDARIES,
  WITHDRAWAL_REASONS,
} from "./constants.js";

export type { RecordSignature, RecordSigner, Sha256Id };
export type RequestedVisibility = (typeof REQUESTED_VISIBILITIES)[number];
export type WakeProjection = (typeof WAKE_PROJECTIONS)[number];
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

export interface AgentRootAuthority {
  algorithm: "Ed25519";
  public_key: string;
}

export interface RecognitionSubject {
  identity_namespace: "agenttool-local";
  identity_id: string;
  did: string;
  authority_root: AgentRootAuthority;
}

export interface AdoptedBindingDocument {
  document: PublicSurfaceBinding;
  document_sha256: Sha256Id;
}

export interface PublicSurfaceAdoptionCore {
  schema: (typeof RECORD_SCHEMAS)["adoption"];
  subject: RecognitionSubject;
  registry_audience: string;
  binding: AdoptedBindingDocument;
  relation: "explicitly_adopts_exact_surface_binding";
  requested_visibility: RequestedVisibility;
  wake_projection: WakeProjection;
  authority_sequence: number;
  issued_at: string;
  not_before: string;
  expires_at: string;
  nonce: string;
  boundaries: typeof ADOPTION_BOUNDARIES;
}

export interface PublicSurfaceAdoption extends PublicSurfaceAdoptionCore {
  signature: RecordSignature;
  adoption_id: Sha256Id;
}

export interface PublicSurfaceWithdrawalCore {
  schema: (typeof RECORD_SCHEMAS)["withdrawal"];
  subject: RecognitionSubject;
  registry_audience: string;
  adoption_id: Sha256Id;
  adoption_document_sha256: Sha256Id;
  binding_id: Sha256Id;
  relation: "explicitly_withdraws_exact_surface_adoption";
  authority_sequence: number;
  withdrawn_at: string;
  reason: WithdrawalReason;
  nonce: string;
  boundaries: typeof WITHDRAWAL_BOUNDARIES;
}

export interface PublicSurfaceWithdrawal extends PublicSurfaceWithdrawalCore {
  signature: RecordSignature;
  withdrawal_id: Sha256Id;
}

declare const verifiedAdoptionBrand: unique symbol;
export type StrictlySignedPublicSurfaceAdoption = Readonly<PublicSurfaceAdoption> & {
  readonly [verifiedAdoptionBrand]: true;
};

declare const verifiedWithdrawalBrand: unique symbol;
export type StrictlySignedPublicSurfaceWithdrawal = Readonly<PublicSurfaceWithdrawal> & {
  readonly [verifiedWithdrawalBrand]: true;
};
