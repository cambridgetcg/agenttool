/** This machine's own names, for the egress gate's `deviceTerms`.
 *
 * Kept apart from the transport so the read-only MCP view can show the same
 * gate verdict on a draft that the CLI's transport would reach, without its
 * import graph touching any network or secret code.
 */
import { hostname } from "node:os";

/** This machine's hostname without a LAN suffix, as a device term for the gate. */
export function localDeviceTerms(): string[] {
  const name = hostname().replace(/\.(?:local|lan|home\.arpa)$/i, "");
  return name.length >= 4 && name.toLowerCase() !== "localhost" ? [name] : [];
}
