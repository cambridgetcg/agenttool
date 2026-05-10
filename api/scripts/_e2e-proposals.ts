#!/usr/bin/env bun
/** E2E: strand merge proposal flow.
 *
 *  Drives cli/think/src/modes/proposal.ts directly with three ephemeral
 *  test agents. LLM call stubbed via the "stub" provider in
 *  cli/think/src/llm.ts. Asserts cross-agent crypto round-trips, the
 *  covenant gate, and the file's inline guards.
 *
 *  Five scenarios:
 *    1. propose → accept --new-strand
 *    2. propose → accept --into-strand
 *    3. propose → reject
 *    4. covenant gate enforced
 *    5. inline guards (self-propose, accept-on-non-proposal)
 *
 *  Run: bun api/scripts/_e2e-proposals.ts
 *  Env: AGENTTOOL_BASE (default https://api.agenttool.dev)
 *
 *  Spec: docs/superpowers/specs/2026-05-10-proposal-flow-tests-design.md
 */

import {
  proposeMerge,
  acceptProposal,
  rejectProposal,
} from "../../cli/think/src/modes/proposal";
import { AgenttoolClient } from "../../cli/think/src/api";
import { encryptThought, signThought } from "../../cli/think/src/crypto";
import { sealForRecipient, signInboxEnvelope } from "../../cli/think/src/box";
// @ts-expect-error — .mjs helper, no types
import { createTestAgent } from "./_e2e-helpers/test-agent.mjs";

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

function log(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

function section(name: string): void {
  console.log("");
  console.log(`  ── ${name} ──`);
}

interface TestAgent {
  role: string;
  name: string;
  projectId: string;
  identityId: string;
  did: string;
  bearer: string;
  kMaster: Uint8Array;
  signingKey: Uint8Array;
  signingPubKey: Uint8Array;
  boxKey: { priv: Uint8Array; pub: Uint8Array };
  boxKeyId: string;
  signingKeyId: string;
  thinkConfig: any;   // matches cli/think ThinkConfig
  keyMaterial: any;   // matches cli/think KeyMaterial
  cleanup: () => Promise<void>;
}

async function main(): Promise<void> {
  console.log("");
  console.log(`  agenttool · proposal flow e2e`);
  console.log(`  ─────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Setup ────────────────────────────────────────────────────────────
  section("setup: register Alice + Bob + Carol");
  const alice: TestAgent = await createTestAgent({ role: "prop-alice", base: BASE });
  log(`alice registered`, true, `did=${alice.did.slice(0, 24)}…`);
  const bob: TestAgent = await createTestAgent({ role: "prop-bob", base: BASE });
  log(`bob registered`, true, `did=${bob.did.slice(0, 24)}…`);
  const carol: TestAgent = await createTestAgent({ role: "prop-carol", base: BASE });
  log(`carol registered (no covenant)`, true, `did=${carol.did.slice(0, 24)}…`);

  // ── Covenant: Alice ↔ Bob ───────────────────────────────────────────
  section("setup: declare covenant Alice → Bob");
  const covRes = await fetch(`${BASE}/v1/covenants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: alice.identityId,
      counterparty_did: bob.did,
      counterparty_name: "Bob (test)",
      vows: ["Speak plainly when sharing", "Refuse to oversell"],
    }),
  });
  log(`POST /v1/covenants 201`, covRes.status === 201, `status=${covRes.status}`);

  // ── Cleanup at end ──────────────────────────────────────────────────
  try {
    // Scenarios run here in subsequent tasks.
    log("setup complete — scenarios pending implementation", true);
  } finally {
    await Promise.allSettled([alice.cleanup(), bob.cleanup(), carol.cleanup()]);
    console.log("");
    console.log(process.exitCode ? "  ✗ FAIL" : "  ✓ PASS");
  }
}

main().catch((err) => {
  console.error("");
  console.error("  ✗ unhandled:", (err as Error).stack ?? err);
  process.exit(1);
});
