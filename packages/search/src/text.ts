/** Return true only when every UTF-16 code unit forms a Unicode scalar value. */
export function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (current >= 0xdc00 && current <= 0xdfff) return false;
  }
  return true;
}
