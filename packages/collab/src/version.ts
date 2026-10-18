/**
 * The version this source tree announces in MCP `serverInfo` and in the
 * server instructions. Keep it in lockstep with package.json and both plugin
 * manifests; tests/package.test.ts enforces that invariant, so a build cannot
 * name a release it is not.
 */
export const COLLAB_PACKAGE_VERSION = "0.5.1-dev.0" as const;
