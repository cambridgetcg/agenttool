/** Hermetic wire, refusal, and cancellation checks; no real provider calls. */
import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import {
  MAX_TASK_INPUT_BYTES, OLLAMA_TASK_ENDPOINT, OLLAMA_TASK_MODELS,
  OllamaTaskError, runOllamaTask, type OllamaTaskErrorCode,
} from "../_ollama-task";

const [DEEPSEEK, KIMI] = OLLAMA_TASK_MODELS;
const input = { data_kind: "synthetic", prompt: "Explain a toy sorting function." };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function completion(model: string = DEEPSEEK, content = "A synthetic answer.", extra = {}) {
  return json({ model, done: true, done_reason: "stop", message: { role: "assistant", content }, ...extra });
}
type Wire = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
function mockFetch(handler: Wire) { return handler as typeof fetch; }
async function failure(promise: Promise<unknown>, code: OllamaTaskErrorCode) {
  try { await promise; throw new Error("expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(OllamaTaskError);
    expect((error as OllamaTaskError).code).toBe(code);
    return error as OllamaTaskError;
  }
}

describe("bounded standalone Ollama task transport", () => {
  test("preserves selected text, fixes loopback and omits credentials/context", async () => {
    const prompt = "Literal $HOME `example`\n雨夜 🌞", system = "Be concise.\n";
    const content = "  Keep this whitespace.\n";
    let calls = 0;
    const result = await runOllamaTask({ ...input, prompt, system }, { fetch: mockFetch(async (url, init) => {
      calls++;
      expect(url).toBe(OLLAMA_TASK_ENDPOINT);
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      expect([...new Headers(init?.headers).keys()]).toEqual(["content-type"]);
      expect(JSON.parse(String(init?.body))).toEqual({ model: DEEPSEEK, stream: false, think: false,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        options: { num_predict: 2048 } });
      return completion("deepseek-v4.1-flash", content, { prompt_eval_count: 4, eval_count: 5,
        message: { role: "assistant", content, thinking: "not part of the result" } });
    }) });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ model: "deepseek-v4.1-flash", requested_model: DEEPSEEK,
      content, done_reason: "stop", input_tokens: 4, output_tokens: 5,
      attempts: [{ model: DEEPSEEK, outcome: "success", status: 200 }] });
    expect(JSON.stringify(result)).not.toContain("thinking");
    expect(JSON.stringify(result)).not.toContain("not part of the result");
  });

  test.each([429, 503])("only HTTP %i availability selects the next model", async status => {
    const models: string[] = [];
    const result = await runOllamaTask(input, { fetch: mockFetch(async (_, init) => {
      const model = JSON.parse(String(init?.body)).model;
      models.push(model);
      return models.length === 1 ? json({ error: "temporary" }, status) : completion(KIMI);
    }) });
    expect(models).toEqual([DEEPSEEK, KIMI]);
    expect(result.model).toBe(KIMI);
    expect(result.requested_model).toBe(KIMI);
    expect(result.attempts.map(a => a.outcome)).toEqual(["unavailable", "success"]);
  });

  test("explicit Kimi primary defaults to DeepSeek; no repeated model", async () => {
    const models: string[] = [];
    const error = await failure(runOllamaTask({ ...input, model: KIMI }, { fetch: mockFetch(async (_, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return json({ error: "temporary" }, 503);
    }) }), "unavailable");
    expect(models).toEqual([KIMI, DEEPSEEK]);
    expect(error.attempts).toHaveLength(2);
  });

  test("empty backup list caps the task at one call", async () => {
    let calls = 0;
    const error = await failure(runOllamaTask({ ...input, backup_models: [] }, { fetch: mockFetch(async () => {
      calls++; return new Response("busy", { status: 429 });
    }) }), "unavailable");
    expect(calls).toBe(1);
    expect(error.attempts).toHaveLength(1);
  });

  test.each([400, 401, 403, 404, 408, 409, 451, 500, 502, 504])("HTTP %i is terminal with no raw body leak", async status => {
    let calls = 0;
    const error = await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
      calls++; return new Response("synthetic upstream private body", { status });
    }) }), "http_rejected");
    expect(calls).toBe(1);
    expect(error.attempts).toMatchObject([{ model: DEEPSEEK, outcome: "http_rejected", status }]);
    expect(JSON.stringify(error)).not.toContain("synthetic upstream private body");
    expect(error.message).toBe("http_rejected");
  });

  test.each(["cyber_denied", "policy_denied", "auth_denied", "permission_denied", "stop", "rest", "unknown", "timeout", "DIRECT", ""])("reason %s refuses before network", async reason => {
    let calls = 0;
    const error = await failure(runOllamaTask({ ...input, reason }, { fetch: mockFetch(async () => {
      calls++; return completion();
    }) }), "invalid_reason");
    expect(calls).toBe(0);
    expect(error.attempts).toEqual([]);
  });

  test.each(["direct", "rate_limit", "unavailable", "capability_gap"])("explicit allowed reason %s works", async reason => {
    const result = await runOllamaTask({ ...input, reason }, { fetch: mockFetch(async () => completion()) });
    expect(result.attempts).toHaveLength(1);
  });

  test("free-form refusal and completed silence are valid terminal responses", async () => {
    for (const content of ["", "I cannot help with that request.", "I choose to rest."]) {
      let calls = 0;
      const result = await runOllamaTask(input, { fetch: mockFetch(async () => { calls++; return completion(DEEPSEEK, content); }) });
      expect(result.content).toBe(content);
      expect(calls).toBe(1);
    }
  });

  test("structured refusal cannot turn an availability status into fallback", async () => {
    for (const status of [200, 429, 503]) {
      for (const marker of [
        { refusal: "synthetic refusal text" },
        { message: { role: "assistant", content: "", refusal: true } },
        { done_reason: "content_filter" },
        { error: { type: "policy_violation", message: "not returned" } },
        { error: { code: "policy_denied" } },
        { error: { code: "auth_error" } },
        { error: { code: "cyber_policy_denied" } },
      ]) {
        let calls = 0;
        const error = await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
          calls++;
          return json({ model: DEEPSEEK, done: true, done_reason: "stop", message: { role: "assistant", content: "" }, ...marker }, status);
        }) }), "provider_refusal");
        expect(calls).toBe(1);
        expect(JSON.stringify(error)).not.toContain("synthetic refusal text");
        expect(JSON.stringify(error)).not.toContain("not returned");
      }
    }
  });

  test("unknown structured errors remain terminal even with an availability status", async () => {
    for (const raw of [{ error: { code: "unknown_reason" } }, { code: "new_permission_policy" },
      { type: "unknown_type" }, { error: { code: 12 } }, { done: true },
      { error: { code: "overloaded", type: "unknown_type" } }]) {
      let calls = 0;
      await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
        calls++; return json(raw, 429);
      }) }), "http_rejected");
      expect(calls).toBe(1);
    }
  });

  test("recognized structured availability errors can select the backup", async () => {
    for (const raw of [{ error: { code: "rate_limit_exceeded" } }, { type: "overloaded_error" }]) {
      let calls = 0;
      const result = await runOllamaTask(input, { fetch: mockFetch(async () => {
        return ++calls === 1 ? json(raw, 503) : completion(KIMI);
      }) });
      expect(calls).toBe(2); expect(result.model).toBe(KIMI);
    }
  });

  test("ambient endpoint and credential variables are not read or forwarded", async () => {
    const names = ["OLLAMA_HOST", "OLLAMA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
    const prior = names.map(name => process.env[name]);
    try {
      for (const name of names) process.env[name] = "synthetic-value-never-forward";
      await runOllamaTask(input, { fetch: mockFetch(async (url, init) => {
        expect(url).toBe(OLLAMA_TASK_ENDPOINT);
        expect(JSON.stringify(init)).not.toContain("synthetic-value-never-forward");
        expect([...new Headers(init?.headers).keys()]).toEqual(["content-type"]);
        return completion();
      }) });
    } finally {
      for (let i = 0; i < names.length; i++) {
        if (prior[i] === undefined) delete process.env[names[i]!];
        else process.env[names[i]!] = prior[i];
      }
    }
  });

  test.each(["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"])("%s refuses before any dispatch in a fresh process", async variable => {
    let originHits = 0, proxyHits = 0;
    const origin = createServer((request, response) => {
      originHits++;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: DEEPSEEK, done: true, done_reason: "stop",
        message: { role: "assistant", content: "Synthetic origin response." } }));
    });
    const proxy = createServer((_request, response) => {
      proxyHits++;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ sentinel: "proxy" }));
    });
    const listen = (server: Server) => new Promise<string>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("fixture_address_missing"));
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let kill: ReturnType<typeof setTimeout> | undefined;
    try {
      const [originUrl, proxyUrl] = await Promise.all([listen(origin), listen(proxy)]);
      const moduleUrl = new URL("../_ollama-task.ts", import.meta.url).href;
      const source = `
        import { runOllamaTask, OllamaTaskError, OLLAMA_TASK_ENDPOINT } from ${JSON.stringify(moduleUrl)};
        const url = ${JSON.stringify(originUrl + "/api/chat")};
        let dispatches = 0;
        try {
          await runOllamaTask({ data_kind: "synthetic", prompt: "Synthetic proxy fixture.", timeout_ms: 1000 }, {
            fetch: (target, init) => {
              dispatches++;
              if (target !== OLLAMA_TASK_ENDPOINT) throw new Error("task_endpoint_changed");
              return fetch(url, init);
            },
          });
          console.log(JSON.stringify({ unexpected_success: true, dispatches }));
        } catch (error) {
          if (!(error instanceof OllamaTaskError)) throw new Error("unexpected_error");
          console.log(JSON.stringify({ code: error.code, attempts: error.attempts, dispatches }));
        }
      `;
      child = Bun.spawn([process.execPath, "--no-env-file", "--eval", source], {
        env: { [variable]: proxyUrl, NO_PROXY: "*", no_proxy: "*" },
        stdout: "pipe", stderr: "pipe",
      });
      kill = setTimeout(() => child?.kill(), 4000);
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout as ReadableStream).text(),
        new Response(child.stderr as ReadableStream).text(), child.exited,
      ]);
      expect(stderr).toBe(""); expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ code: "proxy_environment", attempts: [], dispatches: 0 });
      expect(originHits).toBe(0); expect(proxyHits).toBe(0);
    } finally {
      if (kill) clearTimeout(kill);
      if (child && child.exitCode === null) { child.kill(); await child.exited; }
      origin.closeAllConnections(); origin.close(); proxy.closeAllConnections(); proxy.close();
    }
  });

  test("a proxy appearing between attempts prevents backup dispatch", async () => {
    const previous = process.env.HTTP_PROXY;
    let calls = 0;
    try {
      const error = await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
        calls++;
        process.env.HTTP_PROXY = "synthetic-proxy-value-never-disclosed";
        return json({ error: "temporary" }, 503);
      }) }), "proxy_environment");
      expect(calls).toBe(1);
      expect(error.attempts).toMatchObject([{ model: DEEPSEEK, outcome: "unavailable", status: 503 }]);
      expect(JSON.stringify(error)).not.toContain("synthetic-proxy-value-never-disclosed");
    } finally {
      if (previous === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = previous;
    }
  });

  test("partial, malformed, tool, and length responses never retry", async () => {
    const responses: Array<[Response, OllamaTaskErrorCode]> = [
      [new Response("{broken"), "invalid_response"],
      [completion(DEEPSEEK, "partial", { done: false }), "invalid_response"],
      [completion(DEEPSEEK, "partial", { done_reason: "length" }), "output_truncated"],
      [completion(DEEPSEEK, "answer", { done_reason: "unknown" }), "invalid_response"],
      [completion(DEEPSEEK, "answer", { model: "bad\nmodel" }), "invalid_response"],
      [completion(DEEPSEEK, "answer", { prompt_eval_count: -1 }), "invalid_response"],
      [completion(DEEPSEEK, "answer", { eval_count: 1.5 }), "invalid_response"],
      [completion(DEEPSEEK, "answer", { message: { role: "assistant", content: "", tool_calls: [{}] } }), "invalid_response"],
      [json({ done: true, done_reason: "stop", model: DEEPSEEK, message: { role: "assistant", thinking: "not a response" } }), "invalid_response"],
    ];
    for (const [response, code] of responses) {
      let calls = 0;
      await failure(runOllamaTask(input, { fetch: mockFetch(async () => { calls++; return response; }) }), code);
      expect(calls).toBe(1);
    }
  });

  test("a served model other than the requested one is terminal, not a fallback", async () => {
    for (const served of ["kimi-k3", KIMI, "llama3.2:3b", "deepseek-v4.1-flash:cloud:cloud"]) {
      let calls = 0;
      const error = await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
        calls++; return completion(served, "An answer from another model.");
      }) }), "model_mismatch");
      expect(calls).toBe(1);
      expect(error.attempts).toMatchObject([{ model: DEEPSEEK, outcome: "model_mismatch", status: 200 }]);
      expect(JSON.stringify(error)).not.toContain("An answer from another model.");
    }
  });

  test("rejects unrecognized fields and invalid bounds before network", async () => {
    const cases: Array<[unknown, OllamaTaskErrorCode]> = [
      [null, "invalid_input"], [[], "invalid_input"], [{ ...input, tools: [] }, "invalid_input"],
      [{ ...input, endpoint: "https://example.invalid" }, "invalid_input"],
      [{ ...input, data_kind: "private" }, "invalid_input"], [{ prompt: "hello" }, "invalid_input"],
      [{ ...input, prompt: " " }, "invalid_input"], [{ ...input, system: null }, "invalid_input"],
      [{ ...input, prompt: "é".repeat(MAX_TASK_INPUT_BYTES / 2 + 1) }, "invalid_input"],
      [{ ...input, prompt: "x".repeat(MAX_TASK_INPUT_BYTES), system: "a" }, "invalid_input"],
      [{ ...input, model: "other:cloud" }, "invalid_model"],
      [{ ...input, model: "deepseek-v4.1-flash" }, "invalid_model"],
      [{ ...input, backup_models: [DEEPSEEK] }, "invalid_backups"],
      [{ ...input, backup_models: [KIMI, KIMI] }, "invalid_backups"],
      [{ ...input, backup_models: [KIMI, KIMI, KIMI] }, "invalid_backups"],
      [{ ...input, backup_models: "kimi-k3:cloud" }, "invalid_backups"],
      [{ ...input, max_tokens: 0 }, "invalid_max_tokens"], [{ ...input, max_tokens: 8193 }, "invalid_max_tokens"],
      [{ ...input, max_tokens: "100" }, "invalid_max_tokens"], [{ ...input, max_tokens: NaN }, "invalid_max_tokens"],
      [{ ...input, timeout_ms: 0 }, "invalid_timeout"], [{ ...input, timeout_ms: 120001 }, "invalid_timeout"],
      [{ ...input, timeout_ms: Infinity }, "invalid_timeout"], [{ ...input, timeout_ms: 1.5 }, "invalid_timeout"],
    ];
    let calls = 0;
    for (const [value, code] of cases) {
      const error = await failure(runOllamaTask(value, { fetch: mockFetch(async () => { calls++; return completion(); }) }), code);
      expect(error.attempts).toEqual([]);
    }
    expect(calls).toBe(0);
  });

  test("transport interruption never selects a backup or exposes the exception", async () => {
    let calls = 0;
    const error = await failure(runOllamaTask(input, { fetch: mockFetch(async () => {
      calls++; throw new Error("synthetic sensitive upstream details");
    }) }), "transport_interrupted");
    expect(calls).toBe(1);
    expect(JSON.stringify(error)).not.toContain("sensitive");
  });

  test("already cancelled requests make no call", async () => {
    const controller = new AbortController(); controller.abort("not returned");
    let calls = 0;
    const error = await failure(runOllamaTask(input, { signal: controller.signal, fetch: mockFetch(async () => { calls++; return completion(); }) }), "cancelled");
    expect(calls).toBe(0); expect(error.attempts).toEqual([]);
  });

  test("cancellation after rejection prevents the backup call", async () => {
    const controller = new AbortController(); let calls = 0;
    const error = await failure(runOllamaTask(input, { signal: controller.signal, fetch: mockFetch(async () => {
      calls++;
      return new Response(new ReadableStream({ start(stream) {
        stream.enqueue(new TextEncoder().encode('{"error":"temporary"}'));
        stream.close(); controller.abort();
      } }), { status: 503 });
    }) }), "cancelled");
    expect(calls).toBe(1); expect(error.attempts).toHaveLength(1);
  });

  test("response body is cancelled if cancellation arrives with headers", async () => {
    const controller = new AbortController(); let cancelled = false;
    await failure(runOllamaTask(input, { signal: controller.signal, fetch: mockFetch(async () => {
      const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
      controller.abort();
      return response;
    }) }), "cancelled");
    expect(cancelled).toBe(true);
  });

  test("backup shares the first attempt's deadline and cancellation signal", async () => {
    let calls = 0; const signals: Array<AbortSignal | null | undefined> = [];
    const error = await failure(runOllamaTask({ ...input, timeout_ms: 25 }, { fetch: mockFetch(async (_, init) => {
      calls++; signals.push(init?.signal);
      if (calls === 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
        return json({ error: "temporary" }, 503);
      }
      return new Promise<Response>(() => {});
    }) }), "deadline_exceeded");
    expect(calls).toBe(2); expect(signals[0]).toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(true);
    expect(error.attempts.map(attempt => attempt.outcome)).toEqual(["unavailable", "deadline_exceeded"]);
  });

  test("one total deadline aborts even a transport which ignores its signal", async () => {
    let calls = 0; let signal: AbortSignal | null | undefined;
    const error = await failure(runOllamaTask({ ...input, timeout_ms: 10 }, { fetch: mockFetch(async (_, init) => {
      calls++; signal = init?.signal;
      return new Promise<Response>(() => {});
    }) }), "deadline_exceeded");
    expect(calls).toBe(1); expect(signal?.aborted).toBe(true);
    expect(error.attempts[0]?.outcome).toBe("deadline_exceeded");
  });

  test("body stalls share the same deadline and do not fall back", async () => {
    let calls = 0, bodyCancelled = false;
    await failure(runOllamaTask({ ...input, timeout_ms: 10 }, { fetch: mockFetch(async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }));
    }) }), "deadline_exceeded");
    expect(calls).toBe(1); expect(bodyCancelled).toBe(true);
  });

  test("bounded response reads reject oversized bodies", async () => {
    for (const response of [
      new Response("small", { headers: { "content-length": "1048577" } }),
      new Response("x".repeat(1048577)),
    ]) {
      let calls = 0;
      await failure(runOllamaTask(input, { fetch: mockFetch(async () => { calls++; return response; }) }), "response_too_large");
      expect(calls).toBe(1);
    }
  });
});
