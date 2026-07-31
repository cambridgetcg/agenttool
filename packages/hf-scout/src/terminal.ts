const TEXT_TERMINAL_UNSAFE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu;
const JSON_TERMINAL_UNSAFE =
  /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu;

function escapeCodePoint(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

export function escapeTerminalText(value: string): string {
  return value.replace(TEXT_TERMINAL_UNSAFE, escapeCodePoint);
}

export function escapeJsonTerminalState(value: string): string {
  return value.replace(JSON_TERMINAL_UNSAFE, escapeCodePoint);
}
