/**
 * The two GitHub repositories of the shared/private split. Read
 * private/README.md first.
 *
 * PUBLIC_REPOSITORY is a proposal: Yu has not confirmed the public
 * development repository's name (2026-10-19). It is the one place the name is
 * decided. YAML cannot import it, so each job of the shared
 * .github/workflows/ci.yml repeats it in its `if:`;
 * bin/tests/public-root-split.test.ts pins every copy to this value and names
 * each file that holds one, so a rename is this line plus a mechanical
 * replacement in the files the test lists.
 */
export const PUBLIC_REPOSITORY = "cambridgetcg/agenttool-open";

/** This private repository. Every private-only workflow job runs only here. */
export const PRIVATE_REPOSITORY = "cambridgetcg/agenttool";

/** `bun private/public-repository.ts` prints the public name, `--private` the private one, for shell tools. */
if (import.meta.main) console.log(process.argv[2] === "--private" ? PRIVATE_REPOSITORY : PUBLIC_REPOSITORY);
