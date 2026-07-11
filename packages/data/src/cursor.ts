import { DataNodeError } from "./errors.js";

interface CursorPayload {
  v: 1;
  sequence: number;
  collection_id: string | null;
}

export function encodeChangeCursor(sequence: number, collectionId?: string): string {
  const payload: CursorPayload = {
    v: 1,
    sequence,
    collection_id: collectionId ?? null,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeChangeCursor(cursor: string | undefined, collectionId?: string): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (
      decoded.v !== 1
      || !Number.isSafeInteger(decoded.sequence)
      || (decoded.sequence ?? -1) < 0
      || decoded.collection_id !== (collectionId ?? null)
    ) {
      throw new Error("invalid cursor payload");
    }
    return decoded.sequence!;
  } catch {
    throw new DataNodeError(
      "invalid_cursor",
      "cursor is invalid or belongs to a different collection filter",
      400,
    );
  }
}
