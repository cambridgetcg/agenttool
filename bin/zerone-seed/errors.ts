export class SeedRuntimeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SeedRuntimeError";
  }
}

export function fail(code: string, message: string): never {
  throw new SeedRuntimeError(code, message);
}
