/** Database client (Drizzle ORM + postgres.js). */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { config } from "../config.ts";
import * as schema from "./schema.ts";

const queryClient = postgres(config.databaseUrl);
export const db = drizzle(queryClient, { schema });
