/** Minimal JSON value types. Rhizome emits reports; it never parses
 *  untrusted JSON into behaviour. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
