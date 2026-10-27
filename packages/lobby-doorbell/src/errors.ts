/** A refusal with a closed, machine-readable code. Messages never carry lobby text. */
export class DoorbellError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DoorbellError";
  }
}

/** A malformed command line; the CLI exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
