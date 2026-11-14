/** Errors with closed codes. A message never carries text read from a file or a command. */

/** A malformed command line; the CLI exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** A blueprint (or the file holding it) the plan cannot use; the CLI exits 3. `quoted` is the one
 * piece of the file the message repeats (an unknown part's id), so the CLI's last check can look at it. */
export class RefusalError extends Error {
  constructor(readonly code: string, message: string, readonly quoted?: string) {
    super(message);
    this.name = "RefusalError";
  }
}
