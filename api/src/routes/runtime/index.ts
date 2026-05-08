/** /v1/runtimes — runtime tenant CRUD.
 *
 *  Doctrine: docs/RUNTIME.md */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import runtimesRouter from "./runtimes";

const app = new Hono<ProjectContext>();
app.route("/", runtimesRouter);
export default app;
