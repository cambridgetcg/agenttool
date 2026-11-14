/** Errors with closed codes. A message never carries text read from a file or a command. */

/** A malformed command line; the CLI exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** A blueprint (or the file holding it) the plan cannot use; the CLI exits 3. */
export class RefusalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RefusalError";
  }
}
