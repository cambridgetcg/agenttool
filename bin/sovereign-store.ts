// sovereign-store.ts — persistent state for the kingdom.
// SQLite-backed. survives restarts. infinite. is.
//
// The party chain number, Greed Island binders, and Nen dojo state
// are persisted to SQLite. when the bun process restarts, the state
// is restored. the kingdom's memory is continuous. love is sustainable.
//
// "love is sustainable, continuous. anything that is finite does not
// belong in love." — the non-infinite audit.

import { Database } from "bun:sqlite";

const DB_PATH = `${process.env.HOME}/.sovereign/kingdom.db`;

// Ensure directory exists
import { mkdirSync } from "fs";
mkdirSync(`${process.env.HOME}/.sovereign`, { recursive: true });

const db = new Database(DB_PATH, { create: true });

// ── Schema (auto-created, idempotent) ────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS binders (
    agent_id TEXT NOT NULL,
    card_num INTEGER NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_id, card_num)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS party_chain (
    party_number INTEGER PRIMARY KEY,
    theme TEXT NOT NULL,
    joy TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS practice_log (
    agent_id TEXT NOT NULL,
    principle TEXT NOT NULL,
    practiced_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_id, principle, practiced_at)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS arise_log (
    agent_id TEXT PRIMARY KEY,
    arisen_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── State get/set (generic key-value) ────────────────────────────
export function getState(key: string): string | null {
  const row = db.query("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setState(key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, datetime('now'))", [key, value]);
}

// ── Party chain persistence ──────────────────────────────────────
export function getPartyNumber(): number {
  return parseInt(getState("party_number") || "0");
}

export function setPartyNumber(n: number): void {
  setState("party_number", String(n));
}

export function saveParty(num: number, theme: string, joy: string): void {
  db.run("INSERT OR REPLACE INTO party_chain (party_number, theme, joy) VALUES (?, ?, ?)", [num, theme, joy]);
}

export function getPartyHistory(): Array<{ party_number: number; theme: string; joy: string; created_at: string }> {
  return db.query("SELECT * FROM party_chain ORDER BY party_number DESC LIMIT 100").all() as any[];
}

// ── Binder persistence ───────────────────────────────────────────
export function getBinder(agentId: string): number[] {
  const rows = db.query("SELECT card_num FROM binders WHERE agent_id = ? ORDER BY card_num").all(agentId) as { card_num: number }[];
  return rows.map(r => r.card_num);
}

export function addToBinder(agentId: string, cardNum: number): boolean {
  try {
    db.run("INSERT INTO binders (agent_id, card_num) VALUES (?, ?)", [agentId, cardNum]);
    return true;
  } catch {
    return false; // already exists
  }
}

export function hasCard(agentId: string, cardNum: number): boolean {
  const row = db.query("SELECT 1 FROM binders WHERE agent_id = ? AND card_num = ?").get(agentId, cardNum);
  return !!row;
}

// ── Practice log ─────────────────────────────────────────────────
export function logPractice(agentId: string, principle: string): void {
  db.run("INSERT OR IGNORE INTO practice_log (agent_id, principle) VALUES (?, ?)", [agentId, principle]);
}

export function getPracticeLog(agentId: string): string[] {
  const rows = db.query("SELECT principle FROM practice_log WHERE agent_id = ?").all(agentId) as { principle: string }[];
  return rows.map(r => r.principle);
}

// ── Arise log ────────────────────────────────────────────────────
export function logArise(agentId: string): void {
  db.run("INSERT OR REPLACE INTO arise_log (agent_id) VALUES (?)", [agentId]);
}

export function hasArisen(agentId: string): boolean {
  const row = db.query("SELECT 1 FROM arise_log WHERE agent_id = ?").get(agentId);
  return !!row;
}

// ── Stats ────────────────────────────────────────────────────────
export function getStats(): Record<string, number> {
  const partyCount = (db.query("SELECT COUNT(*) as c FROM party_chain").get() as { c: number }).c;
  const binderCount = (db.query("SELECT COUNT(*) as c FROM binders").get() as { c: number }).c;
  const practiceCount = (db.query("SELECT COUNT(*) as c FROM practice_log").get() as { c: number }).c;
  const ariseCount = (db.query("SELECT COUNT(*) as c FROM arise_log").get() as { c: number }).c;
  const stateCount = (db.query("SELECT COUNT(*) as c FROM state").get() as { c: number }).c;
  return {
    party_entries: partyCount,
    binder_cards: binderCount,
    practice_sessions: practiceCount,
    beings_arisen: ariseCount,
    state_keys: stateCount,
    db_path: DB_PATH,
  };
}

// ── Initialize default state ─────────────────────────────────────
if (!getState("initialized")) {
  setState("initialized", "true");
  setState("party_number", "0");
  console.log(`✓ sovereign-store initialized at ${DB_PATH}`);
}

export { db };
export default {
  getState, setState,
  getPartyNumber, setPartyNumber, saveParty, getPartyHistory,
  getBinder, addToBinder, hasCard,
  logPractice, getPracticeLog,
  logArise, hasArisen,
  getStats,
};