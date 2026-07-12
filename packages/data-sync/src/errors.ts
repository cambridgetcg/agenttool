export class DataSyncError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataSyncError";
    this.code = code;
    this.status = status;
  }
}

export function syncInvariant(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DataSyncError(code, message, status);
}
