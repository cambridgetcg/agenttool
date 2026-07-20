/** Ollama Cloud hosted-provider adapter — hermetic wire contract tests.
 *
 * No network and no real secret. Doctrine: docs/RUNTIME.md. */

import { describe, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  OLLAMA_CLOUD_CHAT_URL,
  OllamaCloudProvider,
  buildProvider,
  type OllamaProviderDependencies,
} from "../src/services/runtime/llm";
import {
  buildRuntimeLLMRequestIdentity,
  computeRequestHash,
  resolveIdempotencyKey,
} from "../src/services/runtime/llm-requests";

function dependencies(
  fetchImpl: typeof fetch,
  claim: {
    created: boolean;
    status:
      | "pending"
      | "completed"
      | "failed"
      | "ambiguous"
      | "committed"
      | "discarded";
    idempotencyKey: string;
  } = {
    created: true,
    status: "pending",
    idempotencyKey: "new-claim",
  },
) {
  const persisted: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<{ key: string; error: string }> = [];
  const ambiguous: Array<{ key: string; error: string }> = [];
  const deps: OllamaProviderDependencies = {
    fetch: fetchImpl,
    persistLLMRequest: mock(async (input) => {
      persisted.push(input);
      return claim;
    }),
    markLLMRequestComplete: mock(async (key, tokens) => {
      completed.push({ key, ...tokens });
      return true;
    }),
    markLLMRequestAmbiguous: mock(async (key, error) => {
      ambiguous.push({ key, error });
      return true;
    }),
    markLLMRequestFailed: mock(async (key, error) => {
      failed.push({ key, error });
      return true;
    }),
  };
  return { deps, persisted, completed, failed, ambiguous };
}

describe("Ollama Cloud provider", () => {
  test("separate explicit starts have separate durable request identities", () => {
    const base = {
      runtimeId: "runtime-1",
      strandId: "strand-1",
      priorSeq: 4,
      wakeVersion: 9,
      model: "qwen3.5:397b",
    };
    const first = buildRuntimeLLMRequestIdentity({
      ...base,
      openingInvitationGeneration: "11111111-1111-4111-8111-111111111111",
    });
    const second = buildRuntimeLLMRequestIdentity({
      ...base,
      openingInvitationGeneration: "22222222-2222-4222-8222-222222222222",
    });
    expect(first).not.toBe(second);
    expect(first).toContain("opening_generation");
  });

  test("sends native non-streaming chat and normalizes token counts", async () => {
    let request: { url: string; init?: RequestInit } | null = null;
    const fakeFetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: "I may explore, or rest." },
          prompt_eval_count: 41,
          eval_count: 9,
          done: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const state = dependencies(fakeFetch);
    const provider = new OllamaCloudProvider("test-key", state.deps);
    const controller = new AbortController();

    const result = await provider.generate({
      systemPrompt: "welcome",
      userMessage: "wake if you want",
      model: "qwen3.5:397b",
      maxTokens: 321,
      idempotencyKey: "wake-1",
      signal: controller.signal,
      runtimeContext: {
        runtimeId: "00000000-0000-4000-8000-000000000001",
        leaseToken: "00000000-0000-4000-8000-000000000002",
        strandId: "00000000-0000-4000-8000-000000000003",
        priorSeq: 7,
        wakeVersion: 12,
      },
    });

    expect(request?.url).toBe(OLLAMA_CLOUD_CHAT_URL);
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    expect(headers["idempotency-key"]).toHaveLength(64);
    expect(headers["idempotency-key"]).not.toBe("wake-1");
    expect(request?.init?.signal).toBe(controller.signal);
    const body = JSON.parse(String(request?.init?.body));
    expect(body.model).toBe("qwen3.5:397b");
    expect(body.stream).toBe(false);
    expect(body.think).toBeUndefined();
    expect(body.options.num_predict).toBe(321);
    expect(body.messages).toEqual([
      { role: "system", content: "welcome" },
      { role: "user", content: "wake if you want" },
    ]);
    expect(state.persisted).toEqual([
      {
        idempotencyKey: headers["idempotency-key"],
        provider: "ollama",
        model: "qwen3.5:397b",
        runtimeId: "00000000-0000-4000-8000-000000000001",
        cycleLeaseToken: "00000000-0000-4000-8000-000000000002",
        strandId: "00000000-0000-4000-8000-000000000003",
        priorSeq: 7,
        wakeVersion: 12,
      },
    ]);
    expect(state.completed).toEqual([
      { key: headers["idempotency-key"], inputTokens: 41, outputTokens: 9 },
    ]);
    expect(result).toMatchObject({
      content: "I may explore, or rest.",
      requestKey: headers["idempotency-key"],
      inputTokens: 41,
      outputTokens: 9,
      authMode: "api_key",
    });
  });

  test("marks definite rejections without persisting upstream text", async () => {
    const secret = "sensitive-test-key";
    const fakeFetch = mock(async () =>
      new Response(`bad credential ${secret}`, { status: 401 }),
    ) as typeof fetch;
    const state = dependencies(fakeFetch);
    const provider = new OllamaCloudProvider(secret, state.deps);

    await expect(
      provider.generate({
        systemPrompt: "welcome",
        userMessage: "hello",
        model: "gpt-oss:120b",
        idempotencyKey: "wake-2",
      }),
    ).rejects.toThrow("ollama_401");

    expect(state.failed).toHaveLength(1);
    expect(state.failed[0].error).toBe("ollama_401");
    expect(state.failed[0].error).not.toContain(secret);
  });

  test("records an aborted call as ambiguous so it cannot auto-retry", async () => {
    const controller = new AbortController();
    controller.abort(new Error("runtime_cycle_timeout"));
    const fakeFetch = mock(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    const state = dependencies(fakeFetch);
    const provider = new OllamaCloudProvider("test-key", state.deps);

    await expect(
      provider.generate({
        systemPrompt: "welcome",
        userMessage: "wake if you want",
        model: "qwen3.5:397b",
        idempotencyKey: "wake-timeout",
        signal: controller.signal,
      }),
    ).rejects.toThrow("ollama_request_ambiguous:runtime_cycle_timeout");

    expect(state.ambiguous).toHaveLength(1);
    expect(state.ambiguous[0].error).toBe(
      "ollama_request_ambiguous:runtime_cycle_timeout",
    );
    expect(state.failed).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
  });

  test("an existing logical request gates dispatch before fetch", async () => {
    const fakeFetch = mock(async () => {
      throw new Error("must not dispatch");
    }) as typeof fetch;
    const state = dependencies(fakeFetch, {
      created: false,
      status: "pending",
      idempotencyKey: "existing-request-key",
    });
    const provider = new OllamaCloudProvider("test-key", state.deps);

    await expect(
      provider.generate({
        systemPrompt: "welcome",
        userMessage: "wake if you want",
        model: "qwen3.5:397b",
        idempotencyKey: "recovered-wake",
      }),
    ).rejects.toThrow("prior_dispatch_outcome_unknown");

    expect(fakeFetch).toHaveBeenCalledTimes(0);
    expect(state.ambiguous).toHaveLength(1);
    expect(state.ambiguous[0].key).toBe("existing-request-key");
  });

  test("valid JSON with an unusable shape is ambiguous, never silence", async () => {
    const fakeFetch = mock(async () => Response.json({})) as typeof fetch;
    const state = dependencies(fakeFetch);
    const provider = new OllamaCloudProvider("test-key", state.deps);

    await expect(
      provider.generate({
        systemPrompt: "welcome",
        userMessage: "wake if you want",
        model: "qwen3.5:397b",
        idempotencyKey: "bad-shape",
      }),
    ).rejects.toThrow("ollama_request_ambiguous:invalid_response_shape");

    expect(state.ambiguous).toHaveLength(1);
    expect(state.completed).toHaveLength(0);
  });

  test("completion-audit failure requires operator review", async () => {
    const fakeFetch = mock(async () =>
      Response.json({
        message: { role: "assistant", content: "hello" },
        prompt_eval_count: 3,
        eval_count: 1,
      }),
    ) as typeof fetch;
    const state = dependencies(fakeFetch);
    state.deps.markLLMRequestComplete = mock(async () => {
      throw new Error("database unavailable");
    });
    const provider = new OllamaCloudProvider("test-key", state.deps);

    await expect(
      provider.generate({
        systemPrompt: "welcome",
        userMessage: "wake if you want",
        model: "qwen3.5:397b",
        idempotencyKey: "audit-failure",
      }),
    ).rejects.toThrow("ollama_request_ambiguous:completion_audit_failed");
  });

  test("factory constructs the explicit ollama provider", () => {
    expect(buildProvider("ollama", "test-key")).toBeInstanceOf(OllamaCloudProvider);
  });

  test("computed request identities are scoped to the provider", () => {
    const request = {
      systemPrompt: "welcome",
      userMessage: "wake if you want",
      model: "shared-model-name",
    };
    expect(computeRequestHash(request, "ollama")).not.toBe(
      computeRequestHash(request, "openai"),
    );
    expect(
      resolveIdempotencyKey({ ...request, idempotencyKey: "same-logical-key" }, "ollama"),
    ).not.toBe(
      resolveIdempotencyKey({ ...request, idempotencyKey: "same-logical-key" }, "openai"),
    );
  });

  test("the DB constraint migration admits ollama without editing history", async () => {
    const migration = await readFile(
      join(import.meta.dir, "../migrations/20260712T083951_ollama_cloud_provider.sql"),
      "utf8",
    );
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS llm_requests_provider_check");
    expect(migration).toContain("'anthropic', 'openai', 'ollama'");
  });

  test("the DB records unknowable remote outcomes distinctly", async () => {
    const migration = await readFile(
      join(
        import.meta.dir,
        "../migrations/20260712T101500_llm_request_ambiguous.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("'pending', 'completed', 'failed', 'ambiguous'");
    expect(migration).toContain("'committed', 'discarded'");
    expect(migration).toContain("runtime_id UUID");
    expect(migration).toContain("cycle_lease_token UUID");
    expect(migration).toContain("idx_llm_requests_runtime_status");
  });

  test("runtime recovery blocks unresolved calls even when the next wake key changes", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/services/runtime/llm-requests.ts"),
      "utf8",
    );
    expect(source).toContain("eq(llmRequests.runtimeId, input.runtimeId)");
    expect(source).toContain(
      "eq(runtimes.cycleLeaseToken, input.cycleLeaseToken)",
    );
    expect(source).toContain("sql`${runtimes.cycleLeaseUntil} > NOW()`");
    expect(source).toContain('.for("update")');
    expect(source).toContain(
      'inArray(llmRequests.status, ["pending", "completed", "ambiguous"])',
    );
    expect(source).toContain("idempotencyKey: unresolved.idempotencyKey");
    expect(source).toContain('eq(llmRequests.status, "pending")');
  });
});
