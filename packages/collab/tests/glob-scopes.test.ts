import { afterEach, describe, expect, test } from "bun:test";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabError } from "../src/errors.js";
import { normalizePathScopes, pathConflicts } from "../src/store-notes.js";
import { call, git, journal, ok, refused, runCleanup } from "./notes-helpers.js";

// Glob characters (*, ?, { and }) in a new task's path scopes are refused: they are
// literal, so they would reserve nothing. [ and ] are literal names. Stored scopes keep working, which
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
      ["src/{lexer,parser}.ts", ["src"]],
      ["docs/guide}", ["docs"]],
      ["app/[id]/*.tsx", ["app/[id]"]],
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

  test("brackets are literal: app/[id] is accepted, and reserves exactly that", () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const create = (key: string, path_scopes: string[]) => j.store.createTaskForSession({
      ...b.credential, idempotency_key: key, title: key, work_mode: "edit", path_scopes,
    });
    const held = j.store.createTaskForSession({
      ...a.credential, idempotency_key: "brackets", title: "The route", work_mode: "edit", path_scopes: ["app/[id]/", "[slug].tsx"],
    });
    expect(held.path_scopes).toEqual(["[slug].tsx", "app/[id]"]);
    j.store.claimTaskForSession({ ...a.credential, idempotency_key: "claim", task_id: held.id, expected_version: held.version });
    const claim = (key: string, path_scopes: string[]) => {
      const task = create(key, path_scopes);
      return codeOf(() => j.store.claimTaskForSession({ ...b.credential, idempotency_key: `${key}-claim`, task_id: task.id, expected_version: task.version }));
    };
    expect(claim("under", ["app/[id]/page.tsx"])).toBe("path_scope_conflict");
    expect(claim("top", ["[slug].tsx"])).toBe("path_scope_conflict");
    // Not a character class: app/i is another directory.
    expect(claim("beside", ["app/i"])).toBeNull();
  });

  test("only '*', '**' and '**/*' are the whole repository; any other pattern names its literal directory or asks for one", () => {
    const j = journal();
    const a = j.start("alpha");
    let n = 0;
    const refuse = (path_scopes: string[]) => {
      const refusal = errorOf(() => j.store.createTaskForSession({
        ...a.credential, idempotency_key: `pattern-${n++}`, title: "Pattern", path_scopes,
      }));
      expect(refusal.code).toBe("invalid_path_scope");
      return { literal: refusal.details.literal_path_scopes, say: (refusal.details.remedy as { say: string }).say };
    };
    for (const scope of ["*", "**", "**/*", "./**"]) {
      const whole = refuse([scope]);
      expect(whole.literal).toBeUndefined();
      expect(whole.say).toContain("list its top-level paths");
    }
    for (const scopes of [["*.md"], ["**.ts"], ["**/*.ts"], ["**/*.test.ts"], ["*/foo"], ["*/*"], ["***"], ["{src,lib}/a.ts"], ["*.md", "**"], ["*.md", "src/*.ts"]]) {
      const other = refuse(scopes);
      expect(other.literal).toBeUndefined();
      expect(other.say).toContain("Name the literal directory or files each pattern meant");
    }
    const below = refuse(["src/*.ts", "src/parser/**", "docs/a.md"]);
    expect(below.literal).toEqual(["docs/a.md", "src"]);
    expect(below.say).toContain("Send the literal scopes [\"docs/a.md\",\"src\"] instead");
  });

  test("the stored side still normalizes and compares such scopes literally", () => {
    expect(normalizePathScopes(["**", "src/*.ts"])).toEqual(["**", "src/*.ts"]);
    expect(pathConflicts(["**"], ["src"])).toEqual([]);
    expect(pathConflicts(["**"], ["**/x"])).toEqual([["**", "**/x"]]);
  });

  test("collab_task_create names the literal directory, and gives a ready call for the whole repository, bound and legacy", async () => {
    const j = journal({ git: true });
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
    expect(result.structuredContent).toMatchObject({ error: "invalid_path_scope", literal_path_scopes: ["src/parser", "tests"] });
    expect(result.structuredContent.remedy.say).toContain('["src/parser","tests"]');
    const created = await ok(server, "collab_task_create", { ...input, path_scopes: result.structuredContent.literal_path_scopes });
    expect(created.task.path_scopes).toEqual(["src/parser", "tests"]);

    const whole = { ...input, idempotency_key: "create-whole", path_scopes: ["**/*"] };
    const refusedWhole = (await call(server, "collab_task_create", whole)).structuredContent;
    expect(refusedWhole.remedy).toEqual({ tool: "collab_task_create", input: { ...whole, path_scopes: ["README.txt"] } });
    expect((await ok(server, "collab_task_create", refusedWhole.remedy.input)).task.path_scopes).toEqual(["README.txt"]);

    const legacy = journal({ git: true });
    const legacyServer = buildCollabMcpServer(legacy.store);
    const opened = await ok(legacyServer, "collab_workspace_open", { root_path: legacy.root, actor: "legacy" });
    const legacyResult = await call(legacyServer, "collab_task_create", {
      workspace_id: opened.workspace.id,
      actor: "legacy",
      idempotency_key: "legacy-glob",
      title: "Legacy pattern",
      path_scopes: ["*"],
    });
    expect(legacyResult.structuredContent).toMatchObject({
      error: "invalid_path_scope",
      remedy: { tool: "collab_task_create", input: { actor: "legacy", path_scopes: ["README.txt"] } },
    });
    await server.close();
    await legacyServer.close();
  });

  test("collab_take names the literal directory; a whole-repository pattern gets a ready take with the top-level paths", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const sa = j.serve(a);
    const before = j.count();
    const refusal = await refused(sa, "collab_take", { title: "Edit the parser", purpose: "fix the lexer", paths: ["src/**"] });
    expect(refusal.code).toBe("invalid_path_scope");
    expect(refusal.literal_path_scopes).toEqual(["src"]);
    expect(refusal.remedy.say).toContain('Send the literal scopes ["src"] instead');
    expect(j.count()).toBe(before);
    const taken = await ok(sa, "collab_take", { title: "Edit the parser", paths: refusal.literal_path_scopes });
    expect(taken.task.paths).toEqual(["src"]);

    // A whole-repository pattern becomes what git tracks at the top level;
    // a scope below one of those is already covered. A bracket there is literal.
    j.write("[slug].tsx", "x\n");
    git(j.root, ["add", "."]);
    git(j.root, ["commit", "-q", "-m", "bracket"]);
    const whole = await refused(sa, "collab_take", { title: "Everything", purpose: "a sweep", paths: ["**", "README.txt/x"] });
    expect(whole.remedy).toEqual({
      tool: "collab_take",
      input: { title: "Everything", purpose: "a sweep", paths: ["README.txt", "[slug].tsx"] },
    });
    // Patterns narrower than the repository are never turned into all of it.
    for (const paths of [["*.md"], ["**/*.test.ts"], ["*/foo"]]) {
      const narrow = await refused(sa, "collab_take", { title: "Narrow", paths });
      expect(narrow.literal_path_scopes).toBeUndefined();
      expect(narrow.remedy.say).toContain("Name the literal directory or files");
    }
    // A named slot's ready take keeps its binding_key.
    await ok(sa, "collab_arrive", { purpose: "a child", binding_key: "kid", parent: a.session.id });
    const child = await refused(sa, "collab_take", { title: "Child work", paths: ["*"], binding_key: "kid" });
    expect(child.remedy).toEqual({
      tool: "collab_take",
      input: { title: "Child work", paths: ["README.txt", "[slug].tsx"], binding_key: "kid" },
    });
    // A top-level name that itself holds a glob character cannot be listed.
    j.write("what?.txt", "x\n");
    git(j.root, ["add", "."]);
    git(j.root, ["commit", "-q", "-m", "question"]);
    const unlisted = await refused(sa, "collab_take", { title: "Everything", paths: ["**"] });
    expect(unlisted.literal_path_scopes).toBeUndefined();
    expect(unlisted.remedy.say).toContain("top-level paths");
    await sa.close();
  });
});
