import {
  ADAPTER_PROTOCOL,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  createAlchemyAgentCredTransport,
} from "../dist/index.js";

if (PACKAGE_NAME !== "@agenttool/alchemy-agentcred") {
  throw new Error("package name changed");
}
if (PACKAGE_VERSION !== "0.1.0-dev.0") {
  throw new Error("package version changed");
}
if (ADAPTER_PROTOCOL !== "agenttool.alchemy-agentcred/0.1") {
  throw new Error("adapter protocol changed");
}
if (typeof createAlchemyAgentCredTransport !== "function") {
  throw new Error("adapter constructor is unavailable");
}

process.stdout.write("node smoke: strict Alchemy AgentCred adapter loads\n");
