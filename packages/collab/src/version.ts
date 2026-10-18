/**
 * The version this source tree announces in MCP `serverInfo` and in the
 * server instructions. Keep it in lockstep with package.json and both plugin
 * manifests; tests/package.test.ts enforces that invariant, so a build cannot
 * name a release it is not.
 *
 * A `-dev.N` value names a moving source line, not exact bytes: every main
 * commit announces it until the next bump. packages/collab-courier pins exact
 * handshake versions (src/binding.ts) and runs this source in its fixtures, so
 * a bump here also needs a deliberate widening of that enum; its
 * boundaries.test.ts names the cause when they drift apart.
 */
export const COLLAB_PACKAGE_VERSION = "0.5.1-dev.0" as const;
