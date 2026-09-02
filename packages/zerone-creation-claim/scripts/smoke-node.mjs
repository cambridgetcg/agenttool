const api = await import("../dist/index.js");

if (api.PACKAGE_NAME !== "@agenttool/zerone-creation-claim") {
  throw new Error("built package identity mismatch");
}
if (Object.values(api.ZERO_EFFECTS).some((value) => value !== false)) {
  throw new Error("built package widened its effect vector");
}
if (api.SOURCE_ONLY_BOUNDARY.consensus_admissibility !== "NOT_CONSENSUS_ADMISSIBLE") {
  throw new Error("built package widened consensus authority");
}
