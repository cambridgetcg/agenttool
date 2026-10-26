import { describe, expect, test } from "bun:test";
import { readTaskInput, runCli } from "../agenttool-llm";
import type { runOllamaTask } from "../_ollama-task";

function input(value: unknown): ReadableStream<Uint8Array> {
  return text(JSON.stringify(value));
}
function text(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(value)); controller.close();
  } });
}
const task = { data_kind: "synthetic", prompt: "Hello" };

describe("explicit Ollama task command", () => {
  test("help and missing cloud acknowledgement never call the provider", async () => {
    let calls = 0;
    const run = (async () => { calls++; throw new Error("must not run"); }) as typeof runOllamaTask;
    expect((await runCli(["--help"], input(task), { run })).stdout).toContain("task text leaves");
    expect((await runCli([], input(task), { run })).stderr).toContain("explicit_cloud_flag_required");
    expect((await runCli(["--cloud", "--endpoint", "https://example.invalid"], input(task), { run })).code).toBe(1);
    expect(calls).toBe(0);
  });

  test("bounded explicit input reaches the transport and result remains attributable", async () => {
    const result = await runCli(["--cloud"], input(task), { run: (async (received, options) => {
      expect(received).toEqual(task);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return { model: "kimi-k3", requested_model: "kimi-k3:cloud", content: "Hello",
        done_reason: "stop", attempts: [], elapsed_ms: 2 };
    }) as typeof runOllamaTask });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, model: "kimi-k3", content: "Hello" });
  });

  test("malformed and oversized input do not call the provider or echo input", async () => {
    let calls = 0;
    const run = (async () => { calls++; throw new Error("must not run"); }) as typeof runOllamaTask;
    const malformed = await runCli(["--cloud"], text('{"PRIVATE_FIXTURE'), { run });
    const oversized = await runCli(["--cloud"], input({ prompt: "x".repeat(72 * 1024) }), { run });
    expect(malformed.stderr).toContain("invalid_json");
    expect(malformed.stderr).not.toContain("PRIVATE_FIXTURE");
    expect(oversized.stderr).toContain("input_too_large");
    expect(calls).toBe(0);
  });

  test("input cancellation interrupts a stalled pipe", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>();
    const reading = readTaskInput(stream, controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow("input_interrupted");
  });

  test("nonsettling stream cleanup cannot defeat the input limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(72 * 1024)); },
      cancel() { return new Promise<void>(() => {}); },
    });
    await expect(readTaskInput(stream, AbortSignal.timeout(100))).rejects.toThrow("input_too_large");
  }, 1000);

  test("the executable exits on SIGTERM while waiting for input", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", `${import.meta.dir}/../agenttool-llm.ts`, "--cloud"], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe", env: {},
    });
    const stop = setTimeout(() => child.kill("SIGTERM"), 200);
    const force = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      const code = await child.exited;
      expect(code).toBe(1);
      expect(await new Response(child.stdout).text()).toBe("");
      expect(await new Response(child.stderr).text()).toContain("input_interrupted");
    } finally {
      clearTimeout(stop); clearTimeout(force); child.stdin.end();
    }
  }, 3000);

  test("unknown errors cannot leak provider bodies or prompts", async () => {
    const result = await runCli(["--cloud"], input(task), { run: (async () => {
      throw new Error("PRIVATE_FIXTURE upstream echo");
    }) as typeof runOllamaTask });
    expect(result.stderr).toContain("task_failed");
    expect(result.stderr).not.toContain("PRIVATE_FIXTURE");
    expect(result.stdout).toBe("");
  });

  test("denial and private data declarations fail before inference", async () => {
    for (const body of [
      { ...task, reason: "cyber_denied" },
      { ...task, reason: "policy_denied" },
      { ...task, data_kind: "private" },
    ]) {
      const result = await runCli(["--cloud"], input(body));
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr).error.attempts).toEqual([]);
    }
  });
});
