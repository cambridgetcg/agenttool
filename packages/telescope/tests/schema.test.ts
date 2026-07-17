import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { inspectTarget } from "../src/scan.js";
import type { DiscoveryAdapter, TelescopeReport } from "../src/types.js";

const schema = JSON.parse(
  await readFile(
    join(
      import.meta.dir,
      "../schema/agenttool-telescope-report-v0.1.schema.json",
    ),
    "utf8",
  ),
) as object;
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile<TelescopeReport>(schema);
const resolvePublic = async () => [{ address: "93.184.216.34", family: 4 }];

function expectValid(report: TelescopeReport): void {
  const valid = validate(report);
  expect(valid, JSON.stringify(validate.errors)).toBe(true);
}

describe("bundled report schema", () => {
  test("strictly validates ordinary and non-HTTP-error emitted reports", async () => {
    const notFound = await inspectTarget("example.com", {
      fetch: async () => new Response(null, { status: 404 }),
      resolve_hostname: resolvePublic,
    });
    expectValid(notFound);

    const responseError = await inspectTarget("example.com", {
      fetch: async () => Response.error(),
      resolve_hostname: resolvePublic,
    });
    expectValid(responseError);
    expect(
      responseError.sources.every(({ status_code }) => status_code === null),
    ).toBe(true);
  });

  test("validates the maximum adapter envelope", async () => {
    const adapters: DiscoveryAdapter[] = Array.from(
      { length: 30 },
      (_, index) => ({
        id: `adapter_${index}`,
        discover: async () => ({
          id: `adapter_${index}`,
          state: "absent" as const,
          summary: "No observation from the fixture adapter.",
          facts: { index },
        }),
      }),
    );
    const report = await inspectTarget("example.com", {
      fetch: async () => new Response(null, { status: 404 }),
      resolve_hostname: resolvePublic,
      adapters,
    });
    expect(report.extensions).toHaveLength(32);
    expectValid(report);
  });

  test("validates redacted redirect evidence without serializing query values", async () => {
    const report = await inspectTarget("example.com", {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (!url.search) {
          return new Response(null, {
            status: 302,
            headers: { location: `${url.pathname}?token=schema-secret` },
          });
        }
        return new Response(null, { status: 404 });
      },
      resolve_hostname: resolvePublic,
    });
    expectValid(report);
    expect(
      report.sources.every(({ final_url_redacted }) => final_url_redacted),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("schema-secret");
  });
});
