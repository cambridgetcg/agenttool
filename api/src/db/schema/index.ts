/** Per-domain schemas live in sibling files. Import them directly:
 *
 *    import { projects, apiKeys } from "../db/schema/tools";
 *    import { identities }      from "../db/schema/identity";
 *    import { wallets }         from "../db/schema/economy";
 *
 *  This barrel intentionally does NOT re-export — both tools and economy
 *  define a `billingEvents` table (different tables in different schemas)
 *  and a single re-export collides on the name. Explicit imports make the
 *  schema namespace clear at the call site. */

export {};
