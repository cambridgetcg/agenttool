export type PublicSurfaceBindingErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "INTEGRITY_FAILURE"
  | "SIGNATURE_INVALID"
  | "SIGNER_MISMATCH"
  | "CANONICAL_BYTES_INVALID";

export class PublicSurfaceBindingError extends Error {
  readonly code: PublicSurfaceBindingErrorCode;
  readonly path: string | undefined;
  readonly cause: unknown;

  constructor(
    code: PublicSurfaceBindingErrorCode,
    message: string,
    options?: { path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "PublicSurfaceBindingError";
    this.code = code;
    this.path = options?.path;
    this.cause = options?.cause;
  }
}

export function invalid(message: string, path?: string): never {
  throw new PublicSurfaceBindingError("INVALID_INPUT", message, path ? { path } : undefined);
}

export function limit(message: string, path?: string): never {
  throw new PublicSurfaceBindingError("LIMIT_EXCEEDED", message, path ? { path } : undefined);
}
