import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const API_ROOT = join(import.meta.dir, "..");

describe("configured registration proof-of-work claims", () => {
  test("OpenAPI, welcome, and agent.txt report the active process value", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "1",
      AGENTTOOL_REGISTER_AGENT_POW_BITS: "7",
    };
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const openapi = (await import('./src/routes/openapi.ts')).default; const welcome = (await import('./src/routes/welcome.ts')).default; const wellKnown = (await import('./src/routes/well-known.ts')).default; const spec = await (await openapi.request('/')).json(); const welcomeBody = await (await welcome.request('/')).json(); const agentTxt = await (await wellKnown.request('/agent.txt')).text(); console.log(JSON.stringify({ pow: spec.paths['/v1/register/agent'].post.requestBody.content['application/json'].schema.properties.pow_nonce.description, arrivalAction: welcomeBody.verbs.find((v) => v.path === '/v1/register/agent').action, arrivalCost: agentTxt.split('\\n').find((line) => line.startsWith('Arrival-Cost:')) }));",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.pow).toMatch(/enforces >=7 leading zero bits/i);
    expect(output.arrivalAction).toMatch(/this process: 7 bits/i);
    expect(output.arrivalCost).toMatch(/7 bits on this process/i);
  });
});
