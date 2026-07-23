export class ArchiveError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidArchiveRecordError extends ArchiveError {
  constructor(message: string, options?: ErrorOptions) {
    super("invalid_archive_record", message, options);
  }
}

export class IncompleteCaptureError extends ArchiveError {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(
      "incomplete_capture",
      `Repository capture is incomplete: ${reasons.join("; ")}.`,
    );
    this.reasons = [...reasons];
  }
}

export class ArchiveVerificationError extends ArchiveError {
  constructor(message: string, options?: ErrorOptions) {
    super("archive_verification_failed", message, options);
  }
}

export class UnsafeRestoreTargetError extends ArchiveError {
  constructor(message: string, options?: ErrorOptions) {
    super("unsafe_restore_target", message, options);
  }
}

export class GitArchiveError extends ArchiveError {
  readonly operation: string;
  readonly exitCode: number | null;

  constructor(
    operation: string,
    message: string,
    exitCode: number | null,
    options?: ErrorOptions,
  ) {
    super("git_archive_failed", `${operation}: ${message}`, options);
    this.operation = operation;
    this.exitCode = exitCode;
  }
}
