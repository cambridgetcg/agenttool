import { afterEach, describe, expect, test } from "bun:test";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabError } from "../src/errors.js";
import { normalizePathScopes, pathConflicts } from "../src/store-notes.js";
import { call, git, journal, ok, refused, runCleanup } from "./notes-helpers.js";

// Glob characters in a new task's path scopes are refused: they are literal,
// so they would reserve nothing. Stored scopes keep working, which
// forward-compat.test.ts shows on tasks every older build wrote.

afterEach(runCleanup);

function codeOf(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    if (error instanceof CollabError) return error.code;
    throw error;
  }
}

function errorOf(operation: () => unknown): CollabError {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("glob characters in new path scopes", () => {
  test("the store refuses each one on create, names the literal prefixes, and writes nothing", () => {
    const j = journal();
    const a = j.start("alpha");
    const before = j.count();
    let n = 0;
    for (const [scope, literal] of [
      ["src/**", ["src"]],
      ["src/*.ts", ["src"]],
      ["src/parser?.ts", ["src"]],
      ["src/[ab].ts", ["src"]],
      ["docs/guide]", ["docs"]],
      ["./packages/collab/src/*", ["packages/collab/src"]],
    ] as const) {
      const refusal = errorOf(() => j.store.createTaskForSession({
        ...a.credential,
        idempotency_key: `glob-${n++}`,
        title: "Pattern scope",
        path_scopes: [scope, "README.md"],
      }));
      expect(refusal.code).toBe("invalid_path_scope");
      expect(refusal.message).toContain("literal repository-relative prefixes");
      expect(refusal.details).toMatchObject({ scope: scope.replace(/^\.\//, ""), literal_path_scopes: [...literal, "README.md"].sort() });
      expect((refusal.details.remedy as { say: string }).say).toContain(JSON.stringify([...literal, "README.md"].sort()));
    }
    expect(codeOf(() => j.store.createTask({
      workspace_id: a.workspace.id,
      actor: "legacy",
      idempotency_key: "legacy-glob",
      title: "Legacy pattern",
      path_scopes: ["src/**"],
    }))).toBe("invalid_path_scope");
    expect(j.count()).toBe(before);
    // Literal scopes are unchanged.
    expect(j.store.createTaskForSession({
      ...a.credential,
      idempotency_key: "literal",
      title: "Literal scope",
      path_scopes: ["src/", "./README.md"],
    }).path_scopes).toEqual(["README.md", "src"]);
  });

  test("a pattern with no literal prefix gets no invented list: whole repository or top-level pattern", () => {
    const plain = journal();
    const a = plain.start("alpha");
    const refusal = errorOf(() => plain.store.createTaskForSession({
      ...a.credential,
      idempotency_key: "everything",
      title: "Everything",
      path_scopes: ["**"],
    }));
    expect(refusal.code).toBe("invalid_path_scope");
    expect(refusal.details.literal_path_scopes).toBeUndefined();
    expect((refusal.details.remedy as { say: string }).say).toContain("top-level paths");
    for (const scope of ["*.md", "[slug].tsx"]) {
      const top = errorOf(() => plain.store.createTaskForSession({
        ...a.credential, idempotency_key: "top", title: "Top", path_scopes: [scope, "**"],
      }));
      expect(top.code).toBe("invalid_path_scope");
      expect(top.details.literal_path_scopes).toBeUndefined();
      expect((top.details.remedy as { say: string }).say).toContain("List the literal paths the pattern meant");
    }
  });

  test("the stored side still normalizes and compares such scopes literally", () => {
    expect(normalizePathScopes(["**", "src/*.ts"])).toEqual(["**", "src/*.ts"]);
    expect(pathConflicts(["**"], ["src"])).toEqual([]);
    expect(pathConflicts(["**"], ["**/x"])).toEqual([["**", "**/x"]]);
  });

  test("collab_task_create gives a ready call with the literal prefixes, bound and legacy", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const input = {
      workspace_id: a.workspace.id,
      idempotency_key: "create-glob",
      title: "Edit the parser",
      path_scopes: ["src/parser/**", "tests/*.test.ts"],
    };
    const result = await call(server, "collab_task_create", input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: "invalid_path_scope",
      literal_path_scopes: ["src/parser", "tests"],
      remedy: { tool: "collab_task_create", input: { ...input, path_scopes: ["src/parser", "tests"] } },
    });
    const ready = result.structuredContent.remedy as { input: Record<string, unknown> };
    const created = await ok(server, "collab_task_create", ready.input);
    expect(created.task.path_scopes).toEqual(["src/parser", "tests"]);

    const legacy = journal();
    const legacyServer = buildCollabMcpServer(legacy.store);
    const opened = await ok(legacyServer, "collab_workspace_open", { root_path: legacy.root, actor: "legacy" });
    const legacyResult = await call(legacyServer, "collab_task_create", {
      workspace_id: opened.workspace.id,
      actor: "legacy",
      idempotency_key: "legacy-glob",
      title: "Legacy pattern",
      path_scopes: ["docs/*"],
    });
    expect(legacyResult.structuredContent).toMatchObject({
      error: "invalid_path_scope",
      remedy: { tool: "collab_task_create", input: { actor: "legacy", path_scopes: ["docs"] } },
    });
    await server.close();
    await legacyServer.close();
  });

  test("collab_take gives a ready take, with the slot's binding_key and the worktree's top-level paths", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const sa = j.serve(a);
    const before = j.count();
    const refusal = await refused(sa, "collab_take", { title: "Edit the parser", purpose: "fix the lexer", paths: ["src/**"] });
    expect(refusal.code).toBe("invalid_path_scope");
    expect(refusal.remedy).toEqual({
      tool: "collab_take",
      input: { title: "Edit the parser", purpose: "fix the lexer", paths: ["src"] },
    });
    expect(j.count()).toBe(before);
    const taken = await ok(sa, "collab_take", refusal.remedy.input);
    expect(taken.task.paths).toEqual(["src"]);

    // A whole-repository pattern becomes what git tracks at the top level;
    // a scope below one of those is already covered.
    const whole = await refused(sa, "collab_take", { title: "Everything", paths: ["**", "README.txt"] });
    expect(whole.remedy).toEqual({ tool: "collab_take", input: { title: "Everything", paths: ["README.txt"] } });

    // '*.md' is not the whole repository, so it is never turned into one.
    const markdown = await refused(sa, "collab_take", { title: "Notes", paths: ["*.md"] });
    expect(markdown.literal_path_scopes).toBeUndefined();
    expect(markdown.remedy.say).toContain("List the literal paths");
    // A top-level name that itself holds a glob character cannot be listed.
    j.write("[slug].tsx", "x\n");
    git(j.root, ["add", "."]);
    git(j.root, ["commit", "-q", "-m", "bracket"]);
    const bracket = await refused(sa, "collab_take", { title: "Everything", paths: ["**"] });
    expect(bracket.literal_path_scopes).toBeUndefined();
    expect(bracket.remedy.say).toContain("top-level paths");

    await ok(sa, "collab_arrive", { purpose: "a child", binding_key: "kid", parent: a.session.id });
    const child = await refused(sa, "collab_take", { title: "Child work", paths: ["lib/*.ts"], binding_key: "kid" });
    expect(child.remedy).toEqual({ tool: "collab_take", input: { title: "Child work", paths: ["lib"], binding_key: "kid" } });
    await sa.close();
  });
});
