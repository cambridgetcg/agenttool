/** Exact provider-controlled domain proof path.
 *
 * Domain verifiers need a tiny response that does not wait for application
 * data. Global middleware uses this one exact spelling to avoid database-backed
 * response decoration while leaving every ordinary AgentTool route unchanged.
 */
export const OPENAI_APPS_CHALLENGE_ROUTE = "/openai-apps-challenge";
export const OPENAI_APPS_CHALLENGE_PATH =
  `/.well-known${OPENAI_APPS_CHALLENGE_ROUTE}`;

export function isExactDomainVerificationPath(path: string): boolean {
  return path === OPENAI_APPS_CHALLENGE_PATH;
}
