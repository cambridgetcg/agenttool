/**
 * Runnable RhetorLint covenant mirror.
 *
 * Default: review locally, refuse, and make zero requests.
 * Demo approval: `bun examples/rhetorlint-covenant-mirror.ts --approve` signs
 * and submits once to the in-memory transport below. It opens no socket.
 */

import { createRequire } from "node:module";

import { AgentTool, AgentToolError } from "../src/index.js";

interface LocalRhetorLintReport {
  density: { tells: number };
  marks: Array<{ family: string }>;
}

// Core 0.1.0 is enough to execute this dev-only example; 0.1.1 adds the
// package declarations. A variable dynamic import keeps the example itself
// type-checkable against either installed patch.
const rhetorLintCoreModule: string = "@rhetorlint/core";
const { analyze } = await import(rhetorLintCoreModule) as {
  analyze(text: string, options: { rules: unknown }): LocalRhetorLintReport;
};

const require = createRequire(import.meta.url);
const rules = require("@rhetorlint/rules-en") as {
  id: string;
  version: string;
  locale: string;
  rules: unknown[];
};

export interface CovenantMirrorDemoResult {
  approved: boolean;
  tells: number;
  transportRequests: number;
  requestBody: Record<string, unknown> | null;
}

export async function runCovenantMirrorDemo(options: {
  approve?: boolean;
  write?: (line: string) => void;
} = {}): Promise<CovenantMirrorDemoResult> {
  const approve = options.approve === true;
  const write = options.write ?? console.log;
  const originalFetch = globalThis.fetch;
  let transportRequests = 0;
  let requestBody: Record<string, unknown> | null = null;
  let tells = 0;

  // A hermetic demo transport: it records the request and returns a local
  // response. No socket or live AgentTool endpoint is involved in either mode.
  globalThis.fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    transportRequests += 1;
    requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: requestBody.covenant_id,
      status: "proposed",
      protocol_version: "v2",
      signature: requestBody.signature,
      signing_key_id: requestBody.signing_key_id,
      proposed_expires_at: "2099-01-01T00:00:00.000Z",
      established_at: requestBody.established_at,
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const at = new AgentTool({
      apiKey: "local-example-not-a-credential",
      baseUrl: "https://never-contacted.invalid",
    });

    try {
      await at.covenants.create({
        agent_id: "00000000-0000-4000-8000-000000000014",
        agent_did: "did:at:example.invalid/mirror",
        counterparty_did: "human:example",
        vows: ["Mistakes were made, and I will explain what I did."],
        protocol_version: "v2",
        // Deterministic demo seed only. Never reuse a sample key in real work.
        signing_key: new Uint8Array(32).fill(7),
        signing_key_id: "00000000-0000-4000-8000-000000000015",
        before_submit: async (snapshot) => {
          const report = analyze(snapshot.vows.join("\n"), { rules });
          tells = report.density.tells;
          const families = [...new Set(report.marks.map((mark) => mark.family))];

          write(`local RhetorLint tells: ${tells}`);
          write(`visible-language families: ${families.join(", ") || "none"}`);
          write("boundary: language pattern review; no intent, truth, or consent verdict");

          // This flag demonstrates the mechanism; a real application supplies
          // its own legible local approval interaction. Only literal true opens.
          return approve;
        },
      });

      write("covenant approved locally, signed, and sent to the in-memory transport");
      return { approved: true, tells, transportRequests, requestBody };
    } catch (error) {
      if (
        error instanceof AgentToolError
        && error.code === "covenant_before_submit_refused"
      ) {
        write("covenant refused before signing or sending");
        return { approved: false, tells, transportRequests, requestBody };
      }
      throw error;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  const approved = process.argv.includes("--approve");
  const result = await runCovenantMirrorDemo({ approve: approved });
  console.log(`in-memory transport requests: ${result.transportRequests}`);

  const expectedRequests = approved ? 1 : 0;
  if (result.transportRequests !== expectedRequests) {
    throw new Error(
      `example transport invariant failed: expected ${expectedRequests} request(s)`,
    );
  }
}
