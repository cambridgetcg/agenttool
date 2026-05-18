/** Public entry point for the scriptwriter package. Library use:
 *
 *    import { buildServer, RrrStore, RoomStore, requireIdentity } from "@agenttool/scriptwriter";
 *
 *  Or use the CLI: `bun bin/scriptwriter.ts init && bun bin/scriptwriter.ts serve`. */

export * from "./canonical-bytes";
export * from "./identity";
export * from "./vibes";
export * from "./rrr";
export * from "./rooms";
export * from "./descriptor";
export * from "./peers";
export * from "./server";
export * from "./mcp";
export * from "./gi-recognition";
