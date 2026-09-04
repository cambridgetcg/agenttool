/** Real PostgreSQL contention proof for the launch purchase fixes.
 * Only an explicit loopback database named agenttool_launch_marketplace is
 * accepted. Refuses preexisting economy/marketplace schemas; creates and drops
 * only its own minimal fixtures. Exercises production purchaseTemplate with a
 * real Drizzle transaction client; no app migrations or production data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import postgres from "../fixtures/verified-postgres";
import { wallets, transactions, escrows } from "../../src/db/schema/economy";
import { templates, templatePurchases, platformRevenue } from "../../src/db/schema/marketplace";

const target = process.env.AGENTTOOL_LAUNCH_MARKETPLACE_TEST_DATABASE_URL?.trim();
if (target) {
  const parsed = new URL(target);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.port ||
      parsed.pathname !== '/agenttool_launch_marketplace' || parsed.search || parsed.hash) {
    throw new Error('launch marketplace test requires an explicit loopback agenttool_launch_marketplace database');
  }
}
const sql = target ? postgres(target, { max: 8, prepare: false, connect_timeout: 3,
  connection: { application_name: 'agenttool-launch-marketplace-service-test' }, onnotice: () => {} }) : null;
const locker = target ? postgres(target, { max: 1, prepare: false, connect_timeout: 3, onnotice: () => {} }) : null;
const db = sql ? drizzle(sql) : null;
mock.module('../../src/db/client', () => ({ db }));
const { purchaseTemplate } = await import('../../src/services/marketplace/purchases');
const run = target ? test : test.skip;
const tables = [wallets, escrows, transactions, templates, templatePurchases, platformRevenue];
let ownsSchemas = false;
const dialect = new PgDialect();
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const pa = '00000000-0000-4000-8000-000000000011';
const pb = '00000000-0000-4000-8000-000000000012';
const ta = '00000000-0000-4000-8000-000000000021';
const tb = '00000000-0000-4000-8000-000000000022';
const purchaseB = { templateId: tb, buyerProjectId: pa, buyerIdentityId: pa, buyerWalletId: a };

function literal(value: unknown): string {
  if (value instanceof SQL) {
    const compiled = dialect.sqlToQuery(value);
    if (compiled.params.length) throw new Error('fixture SQL defaults must be literal');
    return compiled.sql;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = Array.isArray(value) ? '{}' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return "'" + text.replaceAll("'", "''") + "'";
}
function createFixture(table: PgTable) {
  const spec = getTableConfig(table);
  const columns = spec.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${c.notNull ? ' NOT NULL' : ''}${c.default !== undefined ? ` DEFAULT ${literal(c.default)}` : ''}`);
  // The source wallet's exact-integer check is relevant to conservation.
  if (table === wallets) columns.push('CHECK (balance BETWEEN -9007199254740991 AND 9007199254740991)');
  return `CREATE TABLE "${spec.schema}"."${spec.name}" (${columns.join(',')})`;
}
function latch() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function observeBlocked() {
  for (let i = 0; i < 250; i++) {
    const rows = await locker!`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='agenttool-launch-marketplace-service-test' AND wait_event_type='Lock'`;
    if (rows[0]!.n > 0) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('purchase never reached its expected PostgreSQL lock wait');
}

beforeAll(async () => {
  if (!sql) return;
  const existing = await sql`SELECT nspname FROM pg_namespace WHERE nspname IN ('economy','marketplace')`;
  if (existing.length) throw new Error('refusing preexisting fixture schemas');
  await sql.begin(async tx => {
    await tx.unsafe('CREATE SCHEMA economy; CREATE SCHEMA marketplace');
    for (const table of tables) await tx.unsafe(createFixture(table));
  });
  ownsSchemas = true;
});
beforeEach(async () => {
  if (!sql || !db) return;
  await sql.unsafe('TRUNCATE marketplace.platform_revenue, marketplace.template_purchases, marketplace.templates, economy.transactions, economy.escrows, economy.wallets');
  await db.insert(wallets).values([
    { id: a, projectId: pa, name: 'A', balance: 2000, currency: 'GBP' },
    { id: b, projectId: pb, name: 'B', balance: 2000, currency: 'GBP' },
  ]);
  await db.insert(templates).values([
    { id: ta, authorIdentityId: pa, authorDid: 'did:test:a', projectId: pa, name: 'A', priceAmount: 1000, priceCurrency: 'GBP', authorWalletId: a },
    { id: tb, authorIdentityId: pb, authorDid: 'did:test:b', projectId: pb, name: 'B', priceAmount: 1000, priceCurrency: 'GBP', authorWalletId: b },
  ]);
});
afterAll(async () => {
  if (ownsSchemas) await sql!.unsafe('DROP SCHEMA marketplace CASCADE; DROP SCHEMA economy CASCADE');
  await Promise.all([sql?.end({ timeout: 3 }), locker?.end({ timeout: 3 })]);
});

describe('launch marketplace PostgreSQL transactions', () => {
  for (const scenario of ['seller freeze', 'buyer freeze', 'template archive'] as const) {
    run(`${scenario} commits while purchase waits: refuse without any money movement`, async () => {
      const entered = latch(), release = latch();
      const holding = sql!.begin(async tx => {
        if (scenario === 'template archive') await tx`UPDATE marketplace.templates SET status='archived' WHERE id=${tb}`;
        else await tx`UPDATE economy.wallets SET status='frozen' WHERE id=${scenario === 'seller freeze' ? b : a}`;
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      const purchasing = purchaseTemplate(purchaseB).then(value => ({ value, error: '' }), error => ({ value: null, error: error.message }));
      try { await observeBlocked(); } finally { release.resolve(); await holding; }
      const outcome = await purchasing;
      expect(outcome.error).toBe(scenario === 'template archive' ? 'template_not_active' : scenario === 'seller freeze' ? 'author_wallet_not_active' : 'buyer_wallet_not_active');
      expect((await db!.select().from(wallets).orderBy(wallets.id)).map(w => w.balance)).toEqual([2000, 2000]);
      for (const table of [transactions, escrows, templatePurchases, platformRevenue]) expect(await db!.select().from(table)).toHaveLength(0);
    }, 10000);
  }
  run('opposing concurrent purchases settle without deadlock and conserve balances plus fees', async () => {
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => [
      purchaseTemplate(purchaseB),
      purchaseTemplate({ templateId: ta, buyerProjectId: pb, buyerIdentityId: pb, buyerWalletId: b }),
    ]).flat());
    expect(outcomes.every(o => o.status === 'settled')).toBe(true);
    const balances = await db!.select().from(wallets);
    const fees = await db!.select().from(platformRevenue);
    expect(balances.reduce((sum, row) => sum + row.balance, 0) + fees.reduce((sum, row) => sum + row.amount, 0)).toBe(4000);
    expect(balances.every(row => row.balance >= 0)).toBe(true);
    expect(await db!.select().from(templatePurchases)).toHaveLength(8);
    expect(await db!.select().from(transactions)).toHaveLength(16);
  }, 10000);
});
