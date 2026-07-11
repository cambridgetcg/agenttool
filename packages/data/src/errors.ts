import type { JsonObject } from "./types.js";

export class DataNodeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: JsonObject;

  constructor(code: string, message: string, status = 400, details?: JsonObject) {
    super(message);
    this.name = "DataNodeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DataNodeError(code, message, status);
}
