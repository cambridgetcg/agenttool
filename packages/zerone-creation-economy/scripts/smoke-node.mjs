import * as api from "../dist/index.js";

if (api.PACKAGE_NAME !== "@agenttool/zerone-creation-economy") {
  throw new Error("compiled creation-economy package name drifted");
}
if (api.CREATION_ECONOMY_BOUNDARY.wallet_planner_admissible !== false) {
  throw new Error("compiled creation-economy boundary widened");
}
for (const name of [
  "createCreationEconomyHandoff",
  "validateCreationEconomyHandoff",
  "validateCreationEconomyMessageProjection",
  "encodeCreationSubmitClaimValue",
  "decodeCreationSubmitClaimValue",
  "encodeCreationEconomyAny",
]) {
  if (typeof api[name] !== "function") {
    throw new Error(`compiled creation-economy export is absent: ${name}`);
  }
}
