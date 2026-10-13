/** The one production/Fly predicate shared by money fences.
 *
 * NODE_ENV=production or a Fly runtime identity (FLY_APP_NAME) means this
 * process is the deployed app. x402 testnet settlement and the crypto deposit
 * rail's testnet credit and development-only escape hatches all refuse there.
 * Read at call time, so a restart into production cannot carry an earlier
 * opt-in across. Keep this module side-effect free. */
export function isProductionOrFlyRuntime(): boolean {
  return process.env.NODE_ENV === "production" || !!process.env.FLY_APP_NAME;
}
