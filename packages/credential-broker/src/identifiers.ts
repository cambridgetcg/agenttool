export const MAX_CREDENTIAL_ALIAS_LENGTH = 128;

const CREDENTIAL_ALIAS =
  /^[A-Za-z0-9_][A-Za-z0-9._:/@+-]{0,127}$/;

export function isCredentialAlias(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_ALIAS.test(value);
}
