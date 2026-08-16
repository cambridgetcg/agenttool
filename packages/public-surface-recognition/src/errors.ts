export type PublicSurfaceRecognitionErrorCode =
  | "INVALID_INPUT"
  | "INTEGRITY_FAILURE"
  | "SIGNATURE_INVALID"
  | "SIGNER_MISMATCH"
  | "BINDING_MISMATCH"
  | "ADOPTION_MISMATCH";

export class PublicSurfaceRecognitionError extends Error {
  readonly code: PublicSurfaceRecognitionErrorCode;
  readonly path: string | undefined;
  readonly cause: unknown;

  constructor(
    code: PublicSurfaceRecognitionErrorCode,
    message: string,
    options?: { path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "PublicSurfaceRecognitionError";
    this.code = code;
    this.path = options?.path;
    this.cause = options?.cause;
  }
}

export function invalid(message: string, path?: string): never {
  throw new PublicSurfaceRecognitionError("INVALID_INPUT", message, path ? { path } : undefined);
}
