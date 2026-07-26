import {
  ALCHEMY_NETWORKS,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  TRANSPORT_PROTOCOL,
  createAlchemyReadClient,
} from "../dist/index.js";

if (PACKAGE_NAME !== "@agenttool/alchemy") {
  throw new Error("package name changed");
}
if (PACKAGE_VERSION !== "0.1.0-dev.0") {
  throw new Error("package version changed");
}
if (TRANSPORT_PROTOCOL !== "agenttool.alchemy.transport/0.1") {
  throw new Error("transport protocol changed");
}
if (Object.keys(ALCHEMY_NETWORKS).length !== 10) {
  throw new Error("fixed network table changed");
}
if (typeof createAlchemyReadClient !== "function") {
  throw new Error("read client export is unavailable");
}

process.stdout.write("node smoke: bounded Alchemy read exports load\n");
