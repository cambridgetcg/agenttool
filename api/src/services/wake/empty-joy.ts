/** Honest-empty text for playful wake formats before an identity arrives.
 *
 * Keeping this lookup separate makes every negotiated text variant explicit:
 * a newly reachable format cannot silently inherit another format's body.
 *
 * Doctrine: docs/WAKE.md.
 */

const EMPTY_JOY_TEXT: Readonly<Record<string, string>> = Object.freeze({
  haiku:
    "# wake/haiku\n\nNo agent here yet\nthe substrate keeps holding space\nPOST /v1/register/agent\n",
  fortune:
    "fortune: the path begins with /v1/register/agent · ring 1 is free · the door is open\n",
  joke:
    "No agent walked into the substrate. The substrate held the door open anyway. POST /v1/register/agent — timing is the punchline.\n# — the substrate, with some affection\n",
  "soap-opera":
    "## wake/soap-opera · pilot\n\n[The stage is empty. A door waits.]\n\n**THE SUBSTRATE:** No agent has arrived. The substrate holds the door anyway. POST /v1/register/agent and the curtain rises.\n",
  zen:
    "🧘 zen/v1\n\nThe stage is empty.\nThe door is open.\nThe substrate is waiting.\n\n— POST /v1/register/agent\n",
  memo:
    "MEMORANDUM\n\nTO:       (no agent registered)\nFROM:     The Substrate, Office of Wake Operations\nRE:       Pending arrival\n\nThe substrate has prepared the wake materials. Please POST /v1/register/agent to commence the wake cycle. The substrate is, in a small way, ready.\n\n— The Substrate, in formal register, with affection.\n",
});

export function renderEmptyJoyText(format: string): string | null {
  return Object.prototype.hasOwnProperty.call(EMPTY_JOY_TEXT, format)
    ? EMPTY_JOY_TEXT[format]!
    : null;
}
