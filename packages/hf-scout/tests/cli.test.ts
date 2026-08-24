import { describe, expect, test } from "bun:test";

import {
  runHfScoutCli,
  type HubReader,
} from "../src/index.js";

const OBSERVED_AT = "2026-07-30T12:00:00.000Z";
const REVISION = "a".repeat(40);

function reader(): HubReader {
  return {
    async inspect() {
      return {
        id: "org/model",
        sha: REVISION,
        tags: ["license:mit"],
        siblings: [],
      };
    },
    async search() {
      return [
        {
          id: "org/model",
          sha: REVISION,
          tags: ["license:mit"],
        },
      ];
    },
  };
}

function harness(overrides: Parameters<typeof runHfScoutCli>[1] = {}) {
  let stdout = "";
  let stderr = "";
  return {
    dependencies: {
      reader: reader(),
      clock: () => new Date(OBSERVED_AT),
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
      ...overrides,
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("CLI", () => {
  test("prints help and facilities without network access", async () => {
    let calls = 0;
    const neverReader: HubReader = {
      async inspect() {
        calls += 1;
        return {};
      },
      async search() {
        calls += 1;
        return [];
      },
    };
    const run = harness({ reader: neverReader });
    expect(await runHfScoutCli(["help"], run.dependencies)).toBe(0);
    expect(run.stdout()).toContain("does not upload");
    expect(await runHfScoutCli(["facilities", "--json"], run.dependencies)).toBe(0);
    expect(run.stdout()).toContain("agenttool-hf-facilities/v0.1");
    expect(calls).toBe(0);
  });

  test("emits an immutable Agent Data request", async () => {
    let requestedRevision: string | undefined;
    const run = harness({
      reader: {
        ...reader(),
        async inspect(input) {
          requestedRevision = input.revision;
          return await reader().inspect(input);
        },
      },
    });
    const code = await runHfScoutCli(
      ["inspect", "model", "org/model", "--revision", REVISION, "--agent-data"],
      run.dependencies,
    );
    expect(code).toBe(0);
    expect(requestedRevision).toBe(REVISION);
    const parsed = JSON.parse(run.stdout()) as {
      input: {
        version: string;
        source_uri: string;
        metadata: { snapshot_sha256: string };
      };
    };
    expect(parsed.input.version)
      .toBe(`${REVISION}:sha256:${parsed.input.metadata.snapshot_sha256}`);
    expect(parsed.input.source_uri).toEndWith(`/tree/${REVISION}`);
    expect(run.stderr()).toBe("");
  });

  test("reconciles exact release and current head with explicit caller evidence", async () => {
    const head = "b".repeat(40);
    const calls: Array<string | undefined> = [];
    const run = harness({
      reader: {
        ...reader(),
        async inspect(input) {
          calls.push(input.revision);
          return {
            id: "org/model",
            sha: input.revision ?? head,
            tags: ["license:mit"],
            siblings: [],
          };
        },
      },
    });
    expect(await runHfScoutCli([
      "reconcile",
      "model",
      "org/model",
      REVISION,
      "--source-revision",
      REVISION,
      "--source-manifest-sha256",
      "c".repeat(64),
      "--local-manifest-sha256",
      "d".repeat(64),
      "--local-file-count",
      "0",
      "--local-total-bytes",
      "0",
      "--json",
    ], run.dependencies)).toBe(0);
    expect(calls).toEqual([REVISION, undefined]);
    const parsed = JSON.parse(run.stdout()) as {
      release: { resolved_revision: string };
      observed_head: { resolved_revision: string; state: string };
      source_declaration: { state: string; manifest_comparison: string };
      local_verification: { state: string; manifest_comparison: string };
    };
    expect(parsed.release.resolved_revision).toBe(REVISION);
    expect(parsed.observed_head).toMatchObject({
      resolved_revision: head,
      state: "differs_from_release",
    });
    expect(parsed.source_declaration.state).toBe("caller_supplied");
    expect(parsed.local_verification.state).toBe("caller_reported");

    const invalid = harness();
    expect(await runHfScoutCli([
      "reconcile",
      "paper",
      "2608.12345",
      REVISION,
    ], invalid.dependencies)).toBe(2);
    expect(invalid.stderr()).toContain("reconcile supports model, dataset, or space");
  });

  test("filters the inert research catalog without starting a Hub read", async () => {
    let calls = 0;
    const run = harness({
      reader: {
        async inspect() {
          calls += 1;
          return {};
        },
        async search() {
          calls += 1;
          return [];
        },
      },
    });
    expect(await runHfScoutCli([
      "research-leads",
      "--phase",
      "agent_failure_recovery",
      "--json",
    ], run.dependencies)).toBe(0);
    const catalog = JSON.parse(run.stdout()) as {
      leads: Array<{ key: string }>;
      boundary: { raw_rows_read: boolean };
    };
    expect(catalog.leads.map((lead) => lead.key)).toEqual(["tool_failure_recovery"]);
    expect(catalog.boundary.raw_rows_read).toBe(false);
    expect(calls).toBe(0);

    const invalid = harness();
    expect(await runHfScoutCli([
      "research-leads",
      "--phase",
      "unknown_phase",
    ], invalid.dependencies)).toBe(2);
  });

  test("returns input errors separately and never prints injected exception text", async () => {
    const invalid = harness();
    expect(await runHfScoutCli(["inspect", "model"], invalid.dependencies)).toBe(2);
    expect(invalid.stderr()).toContain("error[invalid_cli]");

    const failed = harness({
      reader: {
        ...reader(),
        async inspect() {
          throw new Error("secret private exception");
        },
      },
    });
    expect(
      await runHfScoutCli(["inspect", "model", "org/model"], failed.dependencies),
    ).toBe(3);
    expect(failed.stderr()).toBe(
      "error[injected_reader_failed]: Injected Hub reader failed\n",
    );
    expect(failed.stderr()).not.toContain("secret");

    const unsafe = harness();
    const option = "--bad\u001b[31m\u200e";
    expect(await runHfScoutCli(["facilities", option], unsafe.dependencies)).toBe(2);
    expect(unsafe.stderr()).not.toContain("\u001b");
    expect(unsafe.stderr()).not.toContain("\u200e");
    expect(unsafe.stderr()).toContain("\\u001b");
    expect(unsafe.stderr()).toContain("\\u200e");
  });

  test("rejects conflicting output modes before starting a Hub read", async () => {
    let calls = 0;
    const run = harness({
      reader: {
        ...reader(),
        async inspect() {
          calls += 1;
          return {};
        },
      },
    });
    expect(
      await runHfScoutCli(
        ["inspect", "model", "org/model", "--json", "--sidecar"],
        run.dependencies,
      ),
    ).toBe(2);
    expect(calls).toBe(0);
  });

  test("projects only an explicitly supplied lock document", async () => {
    const lock = {
      schema: "love.huggingface-model-lock/v1",
      repo_type: "model",
      repo_id: "org/model",
      revision: REVISION,
      hub_url: "https://huggingface.co/org/model",
      last_modified: "2026-01-01T00:00:00.000Z",
      license: "mit",
      base_model: "org/base",
      task: "text-generation",
      library: "transformers",
      files: [{
        path: "config.json",
        size: 2,
        sha256: "b".repeat(64),
        git_blob_sha1: "c".repeat(40),
      }],
    };
    let readPath = "";
    const run = harness({
      read_text_file: async (path) => {
        readPath = path;
        return JSON.stringify(lock);
      },
    });
    expect(
      await runHfScoutCli(["lock-status", "/chosen/model-lock.json", "--json"], run.dependencies),
    ).toBe(0);
    expect(readPath).toBe("/chosen/model-lock.json");
    expect(run.stdout()).toContain('"snapshot_verified": false');
  });
});
