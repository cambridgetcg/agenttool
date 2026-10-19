/** Read the literal rows of a seed INSERT … VALUES statement in a migration.
 *
 *  Seed rows that live in checksummed migrations cannot be edited, so tests
 *  read them as written and run them through what the API serves. String
 *  literals ('' and E'' with backslash escapes, joined by ||) and ARRAY[…]
 *  of strings are read; any other expression (a function call, a cast,
 *  NULL) reads as null. */

export type SqlValue = string | string[] | null;

export function seedRows(sql: string, table: string): Array<Record<string, SqlValue>> {
  const head = `INSERT INTO ${table}`;
  const at = sql.indexOf(head);
  if (at < 0) return [];
  let i = at + head.length;

  const skipSpace = () => {
    for (;;) {
      while (i < sql.length && /\s/.test(sql[i]!)) i += 1;
      if (!sql.startsWith("--", i)) return;
      const lineEnd = sql.indexOf("\n", i);
      i = lineEnd < 0 ? sql.length : lineEnd + 1;
    }
  };
  const expect = (ch: string) => {
    skipSpace();
    if (sql[i] !== ch) throw new Error(`${table}: expected ${ch} at offset ${i}`);
    i += 1;
  };
  const atString = () => sql[i] === "'" || ((sql[i] === "E" || sql[i] === "e") && sql[i + 1] === "'");
  const readString = (): string => {
    const escapes = sql[i] !== "'";
    i += escapes ? 2 : 1;
    let out = "";
    for (;;) {
      const ch = sql[i];
      if (ch === undefined) throw new Error(`${table}: unterminated string`);
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i += 1;
        return out;
      }
      if (escapes && ch === "\\") {
        const next = sql[i + 1]!;
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
    }
  };
  const skipExpression = () => {
    let depth = 0;
    while (i < sql.length) {
      if (atString()) {
        readString();
        continue;
      }
      const ch = sql[i]!;
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") {
        if (depth === 0) return;
        depth -= 1;
      } else if (ch === "," && depth === 0) return;
      i += 1;
    }
  };
  const term = (): SqlValue => {
    skipSpace();
    if (atString()) return readString();
    if (sql.startsWith("ARRAY[", i)) {
      i += "ARRAY[".length;
      const items: string[] = [];
      for (;;) {
        skipSpace();
        if (sql[i] === "]") {
          i += 1;
          return items;
        }
        const item = value();
        if (typeof item === "string") items.push(item);
        skipSpace();
        if (sql[i] === ",") i += 1;
      }
    }
    skipExpression();
    return null;
  };
  const value = (): SqlValue => {
    let current = term();
    for (;;) {
      skipSpace();
      if (sql.startsWith("||", i)) {
        i += 2;
        const next = term();
        current = typeof current === "string" && typeof next === "string" ? current + next : null;
        continue;
      }
      if (sql.startsWith("::", i)) {
        i += 2;
        while (i < sql.length && /[\w.[\]]/.test(sql[i]!)) i += 1;
        continue;
      }
      return current;
    }
  };

  expect("(");
  const close = sql.indexOf(")", i);
  const columns = sql.slice(i, close).split(",").map((column) => column.trim());
  i = close + 1;
  skipSpace();
  if (!sql.startsWith("VALUES", i)) throw new Error(`${table}: expected VALUES`);
  i += "VALUES".length;

  const rows: Array<Record<string, SqlValue>> = [];
  for (;;) {
    expect("(");
    const values: SqlValue[] = [];
    for (;;) {
      values.push(value());
      skipSpace();
      if (sql[i] === ",") {
        i += 1;
        continue;
      }
      expect(")");
      break;
    }
    rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])));
    skipSpace();
    if (sql[i] !== ",") return rows;
    i += 1;
  }
}
