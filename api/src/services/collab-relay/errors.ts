/** Structured relay failures. Messages contain no bearer or provider secret. */

export type CollabErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 503;

export class CollabRelayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: CollabErrorStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CollabRelayError";
  }
}

export function collabErrorEnvelope(error: CollabRelayError): {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
