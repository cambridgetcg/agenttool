export type ZeroneAdapterErrorCode =
  | "invalid_input"
  | "unsupported_chain"
  | "unsupported_message"
  | "intent_mismatch"
  | "adapter_inactive"
  | "signer_mismatch"
  | "signature_invalid"
  | "transport_error"
  | "transport_mismatch"
  | "deadline_exceeded"
  | "response_too_large"
  | "invalid_state";

export class ZeroneAdapterError extends Error {
  readonly code: ZeroneAdapterErrorCode;
  readonly path: string | undefined;

  constructor(
    code: ZeroneAdapterErrorCode,
    message: string,
    options?: { readonly path?: string },
  ) {
    super(message);
    this.name = "ZeroneAdapterError";
    this.code = code;
    this.path = options?.path;
  }
}

export function invalid(message: string, path?: string): never {
  throw new ZeroneAdapterError(
    "invalid_input",
    message,
    path === undefined ? undefined : { path },
  );
}

export function mismatch(message: string, path?: string): never {
  throw new ZeroneAdapterError(
    "intent_mismatch",
    message,
    path === undefined ? undefined : { path },
  );
}
