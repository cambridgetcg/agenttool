export type AgentDataErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CID"
  | "INTEGRITY_FAILURE"
  | "ACCESS_DENIED"
  | "LIMIT_EXCEEDED"
  | "BLOCK_NOT_FOUND"
  | "STORE_FAILURE"
  | "REPLICATION_FAILURE"
  | "IDENTITY_REQUIRED";

/** Base error for failures callers may need to branch on. */
export class AgentDataError extends Error {
  readonly code: AgentDataErrorCode;
  readonly cause?: unknown;

  constructor(code: AgentDataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AgentDataError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export class InvalidInputError extends AgentDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("INVALID_INPUT", message, options);
    this.name = "InvalidInputError";
  }
}

export class InvalidCidError extends AgentDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("INVALID_CID", message, options);
    this.name = "InvalidCidError";
  }
}

export class IntegrityError extends AgentDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("INTEGRITY_FAILURE", message, options);
    this.name = "IntegrityError";
  }
}

export class AccessDeniedError extends AgentDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ACCESS_DENIED", message, options);
    this.name = "AccessDeniedError";
  }
}

export class LimitExceededError extends AgentDataError {
  constructor(message: string) {
    super("LIMIT_EXCEEDED", message);
    this.name = "LimitExceededError";
  }
}

export class BlockNotFoundError extends AgentDataError {
  readonly cid: string;

  constructor(cid: string) {
    super("BLOCK_NOT_FOUND", `Block not found: ${cid}`);
    this.name = "BlockNotFoundError";
    this.cid = cid;
  }
}

export class StoreError extends AgentDataError {
  readonly failures: readonly unknown[];

  constructor(message: string, failures: readonly unknown[]) {
    super("STORE_FAILURE", message, { cause: failures[0] });
    this.name = "StoreError";
    this.failures = failures;
  }
}

export class ReplicationError extends AgentDataError {
  readonly successes: number;
  readonly required: number;
  readonly failures: readonly unknown[];

  constructor(successes: number, required: number, failures: readonly unknown[]) {
    super(
      "REPLICATION_FAILURE",
      `Block reached ${successes} store(s); ${required} successful write(s) required.`,
      { cause: failures[0] },
    );
    this.name = "ReplicationError";
    this.successes = successes;
    this.required = required;
    this.failures = failures;
  }
}
