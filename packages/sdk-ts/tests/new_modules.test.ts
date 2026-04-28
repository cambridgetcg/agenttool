// Quick smoke test for new TS SDK modules
import { describe, test, expect } from "bun:test";
import { AgentTool, AgentToolError } from "../src/index.js";
import type { PulsePayload, CreateAgentOptions, BootstrapResult } from "../src/index.js";

describe("SDK module exports", () => {
  test("PulseClient is accessible", () => {
    const at = new AgentTool({ apiKey: "test-key" });
    expect(at.pulse).toBeDefined();
    expect(typeof at.pulse.heartbeat).toBe("function");
    expect(typeof at.pulse.get).toBe("function");
    expect(typeof at.pulse.list).toBe("function");
  });

  test("IdentityClient is accessible", () => {
    const at = new AgentTool({ apiKey: "test-key" });
    expect(at.identity).toBeDefined();
    expect(typeof at.identity.register).toBe("function");
    expect(typeof at.identity.get).toBe("function");
    expect(typeof at.identity.attest).toBe("function");
    expect(typeof at.identity.discover).toBe("function");
    expect(typeof at.identity.issue_token).toBe("function");
    expect(typeof at.identity.verify_token).toBe("function");
  });

  test("VaultClient is accessible", () => {
    const at = new AgentTool({ apiKey: "test-key" });
    expect(at.vault).toBeDefined();
    expect(typeof at.vault.put).toBe("function");
    expect(typeof at.vault.get).toBe("function");
    expect(typeof at.vault.delete).toBe("function");
    expect(typeof at.vault.list).toBe("function");
    expect(typeof at.vault.bulk).toBe("function");
    expect(typeof at.vault.check).toBe("function");
  });

  test("BootstrapClient is accessible", () => {
    const at = new AgentTool({ apiKey: "test-key" });
    expect(at.bootstrap).toBeDefined();
    expect(typeof at.bootstrap.create).toBe("function");
    expect(typeof at.bootstrap.elevate).toBe("function");
    expect(typeof at.bootstrap.status).toBe("function");
  });

  test("lazy initialization — same instance on repeat access", () => {
    const at = new AgentTool({ apiKey: "test-key" });
    expect(at.pulse).toBe(at.pulse);
    expect(at.identity).toBe(at.identity);
    expect(at.vault).toBe(at.vault);
    expect(at.bootstrap).toBe(at.bootstrap);
  });

  test("type exports are available", () => {
    const payload: PulsePayload = { status: "idle" };
    expect(payload.status).toBe("idle");

    const opts: CreateAgentOptions = { capabilities: ["search"] };
    expect(opts.capabilities).toHaveLength(1);
  });
});
