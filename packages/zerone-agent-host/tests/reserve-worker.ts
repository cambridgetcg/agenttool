import { ZeroneAgentHostError, ZeroneAgentHostStore } from "../src/index.js";
import { fixture } from "./helpers.js";

const database = process.argv[2];
const operationId = process.argv[3];
if (database === undefined || operationId === undefined) {
  throw new Error("database and operation ID are required");
}
const values = fixture();
const store = new ZeroneAgentHostStore(database, {
  create: false,
  recover_interrupted: false,
});
store.initialize();
let output: { status: "reserved"; operation_id: string } | { status: "denied"; code: string };
try {
  const operation = store.reserveOperation(values.reserve(operationId));
  output = { status: "reserved", operation_id: operation.operation_id };
} catch (error) {
  output = {
    status: "denied",
    code: error instanceof ZeroneAgentHostError ? error.code : "unexpected",
  };
}
store.close();
process.stdout.write(`${JSON.stringify(output)}\n`);
