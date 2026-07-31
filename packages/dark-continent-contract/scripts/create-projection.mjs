import { writeFileSync } from "node:fs";
import {
  createProjection,
  prettyJsonBytes,
  validateProjection,
} from "../src/index.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = [
  "projection-id",
  "consumer-kind",
  "consumer-id",
  "artifact",
  "output",
];
for (const name of required) {
  if (!args[name]) throw new Error(`--${name} is required`);
}

const interpretations = args.interpretation
  ? [
      {
        source_profile: args.interpretation,
        relation: "parallel_not_equivalent",
      },
    ]
  : [];

const projection = createProjection({
  projectionId: args["projection-id"],
  consumer: {
    kind: args["consumer-kind"],
    id: args["consumer-id"],
  },
  artifact: args.artifact,
  interpretations,
});
const errors = validateProjection(projection);
if (errors.length > 0) {
  throw new Error(`generated projection is invalid: ${errors.join("; ")}`);
}

writeFileSync(args.output, prettyJsonBytes(projection));
console.log(`wrote ${args.output}`);
