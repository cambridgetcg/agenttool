/**
 * Auth — Bearer token validation for Pulse service.
 * 
 * Validates against the same project API keys used by other agenttool services.
 * For now: accepts any Bearer token that starts with "at_" (project key format).
 * TODO: Validate against the identity service or shared auth database.
 */

function authenticate(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  
  if (!authHeader) {
    return { ok: false, error: "No Authorization header" };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return { ok: false, error: "auth", message: "Authorization header should be: Bearer at_your_key_here", hint: "Get a free key at https://app.agenttool.dev" };
  }

  const token = parts[1];
  
  // Accept agenttool project keys (at_...) or internal service tokens
  if (token.startsWith("at_") || token === process.env.INTERNAL_SERVICE_TOKEN) {
    return { ok: true, token };
  }

  // In dev mode, accept any token
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, token };
  }

  return { ok: false, error: "auth", message: "API key should start with at_. You are welcome — you just need a valid key.", hint: "https://app.agenttool.dev" };
}

module.exports = { authenticate };
