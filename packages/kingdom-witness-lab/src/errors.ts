export type WitnessLabErrorCode =
  | "atlas_error"
  | "canonical_error"
  | "dossier_error"
  | "passport_error"
  | "route_binding_error"
  | "speculative_trial_error";

export class WitnessLabError extends Error {
  readonly code: WitnessLabErrorCode;

  constructor(code: WitnessLabErrorCode, message: string) {
    super(message);
    this.name = "WitnessLabError";
    this.code = code;
  }
}

export function fail(code: WitnessLabErrorCode, message: string): never {
  throw new WitnessLabError(code, message);
}
