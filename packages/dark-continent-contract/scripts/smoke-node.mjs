import {
  CONTRACT_ID,
  SOURCE_PROFILE,
  createProjection,
  loadFrameworkSnapshot,
  validateProjection,
} from "../dist/index.js";

if (CONTRACT_ID !== "agenttool.dark-continent/0.1") {
  throw new Error("contract ID changed");
}
if (SOURCE_PROFILE !== "agenttool-sdk-ts-0.17.0") {
  throw new Error("source profile changed");
}

const snapshot = loadFrameworkSnapshot();
if (snapshot.source.version !== "0.17.0") {
  throw new Error("framework source version changed");
}

const projection = createProjection({
  projectionId: "smoke:kingdom-dark-continent",
  consumer: { kind: "kingdom-extension", id: "KINGDOM" },
  artifact: "@agenttool/dark-continent-contract/framework",
});
if (validateProjection(projection).length !== 0) {
  throw new Error("built projection failed validation");
}
if (projection.decision.recommendation !== "hold") {
  throw new Error("advisory hold boundary changed");
}

process.stdout.write("node smoke: Dark Continent contract loads from dist\n");
