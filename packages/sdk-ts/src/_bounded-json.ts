/** 共用有界 JSON admission；保留 decoded keys，唔畀重複欄位靜默覆蓋。 */
export interface JsonBounds {
  maxDepth: number;
  maxNodes: number;
  maxStringCodePoints: number;
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export class BoundedJsonParser {
  private offset = 0;
  private nodes = 0;

  constructor(private readonly source: string, private readonly bounds: JsonBounds) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.offset !== this.source.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new SyntaxError("invalid bounded JSON");
  }

  private skipWhitespace(): void {
    while (
      this.offset < this.source.length
      && "\t\n\r ".includes(this.source[this.offset]!)
    ) {
      this.offset += 1;
    }
  }

  private parseValue(depth: number): unknown {
    if (depth > this.bounds.maxDepth) this.fail();
    this.nodes += 1;
    if (this.nodes > this.bounds.maxNodes) this.fail();
    const token = this.source[this.offset];
    if (token === "{") return this.parseObject(depth);
    if (token === "[") return this.parseArray(depth);
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      return this.parseNumber();
    }
    return this.fail();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.offset += 1;
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    while (true) {
      if (this.source[this.offset] !== '"') this.fail();
      const key = this.parseString();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.offset] !== ":") this.fail();
      this.offset += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "}") {
        this.offset += 1;
        return result;
      }
      if (separator !== ",") this.fail();
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.offset += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "]") {
        this.offset += 1;
        return result;
      }
      if (separator !== ",") this.fail();
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset);
      if (code === 0x22) {
        this.offset += 1;
        const value = JSON.parse(this.source.slice(start, this.offset)) as unknown;
        if (
          typeof value !== "string"
          || hasUnpairedSurrogate(value)
          || Array.from(value).length > this.bounds.maxStringCodePoints
        ) {
          this.fail();
        }
        return value;
      }
      if (code < 0x20) this.fail();
      if (code === 0x5c) {
        this.offset += 1;
        const escape = this.source[this.offset];
        if (escape === "u") {
          const digits = this.source.slice(this.offset + 1, this.offset + 5);
          if (digits.length !== 4 || !/^[0-9a-f]{4}$/iu.test(digits)) this.fail();
          this.offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.fail();
      }
      this.offset += 1;
    }
    return this.fail();
  }

  private parseLiteral(token: string, value: unknown): unknown {
    if (this.source.slice(this.offset, this.offset + token.length) !== token) {
      this.fail();
    }
    this.offset += token.length;
    return value;
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.offset),
    );
    if (match === null) this.fail();
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail();
    return value;
  }
}
