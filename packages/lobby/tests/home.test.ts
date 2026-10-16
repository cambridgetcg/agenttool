import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LobbyError } from "../src/errors.js";
import { DATABASE_FILE, resolveLobbyHome } from "../src/home.js";
import { LobbyStore } from "../src/store.js";
import { cleanupTempHomes, tempHome } from "./helpers.js";

afterEach(cleanupTempHomes);

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

describe("state directory resolution", () => {
  test("AGENTTOOL_LOBBY_HOME wins and must be absolute", () => {
    expect(resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "/srv/desk", XDG_STATE_HOME: "/xdg" })).toBe("/srv/desk");
    expect(errorCode(() => resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "relative/desk" }))).toBe("lobby_home_not_absolute");
  });

  test("falls back to XDG_STATE_HOME, then ~/.local/state", () => {
    expect(resolveLobbyHome({ XDG_STATE_HOME: "/xdg/state" })).toBe("/xdg/state/agenttool/lobby");
    expect(resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "", XDG_STATE_HOME: "" }))
      .toBe(join(homedir(), ".local", "state", "agenttool", "lobby"));
    // XDG says relative values are invalid and ignored.
    expect(resolveLobbyHome({ XDG_STATE_HOME: "state" }))
      .toBe(join(homedir(), ".local", "state", "agenttool", "lobby"));
  });
});

describe("owner-only permissions", () => {
  test("creates the directory 0700 and lobby.sqlite 0600", () => {
    const { home } = tempHome();
    const store = LobbyStore.open(home);
    store.addRoom({ title: "Zerone season 1" });
    store.close();
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, DATABASE_FILE)).mode & 0o777).toBe(0o600);
  });

  test("refuses a state directory wider than 0700", () => {
    const { home } = tempHome();
    mkdirSync(home, { mode: 0o755 });
    chmodSync(home, 0o755);
    expect(errorCode(() => LobbyStore.open(home))).toBe("state_dir_not_private");
    expect(errorCode(() => LobbyStore.openReadOnly(home))).toBe("state_dir_not_private");
    chmodSync(home, 0o750);
    expect(errorCode(() => LobbyStore.open(home))).toBe("state_dir_not_private");
  });

  test("refuses a database file wider than 0600 and does not repair it", () => {
    const { home } = tempHome();
    LobbyStore.open(home).close();
    const database = join(home, DATABASE_FILE);
    chmodSync(database, 0o644);
    expect(errorCode(() => LobbyStore.open(home))).toBe("state_file_not_private");
    expect(errorCode(() => LobbyStore.openReadOnly(home))).toBe("state_file_not_private");
    expect(statSync(database).mode & 0o777).toBe(0o644);
  });

  test("refuses a wider SQLite sidecar", () => {
    const { home } = tempHome();
    LobbyStore.open(home).close();
    const sidecar = join(home, `${DATABASE_FILE}-journal`);
    writeFileSync(sidecar, "", { mode: 0o600 });
    chmodSync(sidecar, 0o666);
    expect(errorCode(() => LobbyStore.open(home))).toBe("state_file_not_private");
  });

  test("refuses a symlinked state directory or database", () => {
    const { parent, home } = tempHome();
    const real = join(parent, "real");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, home);
    expect(errorCode(() => LobbyStore.open(home))).toBe("state_dir_unsafe");

    const other = tempHome();
    mkdirSync(other.home, { mode: 0o700 });
    const target = join(other.parent, "elsewhere.sqlite");
    writeFileSync(target, "", { mode: 0o600 });
    symlinkSync(target, join(other.home, DATABASE_FILE));
    expect(errorCode(() => LobbyStore.open(other.home))).toBe("state_file_unsafe");
  });

  test("read-only opening creates nothing", () => {
    const { home } = tempHome();
    expect(LobbyStore.openReadOnly(home)).toBeNull();
    expect(() => statSync(home)).toThrow();
  });
});
