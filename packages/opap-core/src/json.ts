import { OpapError } from "./errors";

export const MAX_RECORD_BYTES = 65_536;
export const MAX_JSON_NESTING_DEPTH = 32;

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function invalidRecord(diagnostic: string, cause?: unknown): never {
  throw new OpapError(
    "invalid_record",
    diagnostic,
    cause === undefined ? undefined : { cause },
  );
}

class JsonStructureScanner {
  readonly #source: string;
  #position = 0;

  constructor(source: string) {
    this.#source = source;
  }

  scan(): void {
    this.#skipWhitespace();
    this.#scanValue(0);
    this.#skipWhitespace();

    if (this.#position !== this.#source.length) {
      invalidRecord("invalid_json");
    }
  }

  #scanValue(depth: number): void {
    const character = this.#source[this.#position];

    if (character === "{") {
      this.#scanObject(depth + 1);
      return;
    }
    if (character === "[") {
      this.#scanArray(depth + 1);
      return;
    }
    if (character === '"') {
      this.#scanString();
      return;
    }
    if (character === "t") {
      this.#scanLiteral("true");
      return;
    }
    if (character === "f") {
      this.#scanLiteral("false");
      return;
    }
    if (character === "n") {
      this.#scanLiteral("null");
      return;
    }
    if (
      character === "-" ||
      (character !== undefined && character >= "0" && character <= "9")
    ) {
      this.#scanNumber();
      return;
    }

    invalidRecord("invalid_json");
  }

  #scanObject(depth: number): void {
    this.#assertDepth(depth);
    this.#position += 1;
    this.#skipWhitespace();

    if (this.#consume("}")) {
      return;
    }

    const keys = new Set<string>();
    while (true) {
      if (this.#source[this.#position] !== '"') {
        invalidRecord("invalid_json");
      }

      const key = this.#scanString();
      if (keys.has(key)) {
        invalidRecord(`duplicate_key:${key}`);
      }
      keys.add(key);

      this.#skipWhitespace();
      if (!this.#consume(":")) {
        invalidRecord("invalid_json");
      }
      this.#skipWhitespace();
      this.#scanValue(depth);
      this.#skipWhitespace();

      if (this.#consume("}")) {
        return;
      }
      if (!this.#consume(",")) {
        invalidRecord("invalid_json");
      }
      this.#skipWhitespace();
    }
  }

  #scanArray(depth: number): void {
    this.#assertDepth(depth);
    this.#position += 1;
    this.#skipWhitespace();

    if (this.#consume("]")) {
      return;
    }

    while (true) {
      this.#scanValue(depth);
      this.#skipWhitespace();

      if (this.#consume("]")) {
        return;
      }
      if (!this.#consume(",")) {
        invalidRecord("invalid_json");
      }
      this.#skipWhitespace();
    }
  }

  #scanString(): string {
    const start = this.#position;
    this.#position += 1;

    while (this.#position < this.#source.length) {
      const character = this.#source[this.#position];

      if (character === '"') {
        this.#position += 1;
        const token = this.#source.slice(start, this.#position);
        try {
          return JSON.parse(token) as string;
        } catch (error) {
          invalidRecord("invalid_json", error);
        }
      }
      if (character === "\\") {
        this.#position += 1;
        const escape = this.#source[this.#position];
        if (escape === "u") {
          const hex = this.#source.slice(
            this.#position + 1,
            this.#position + 5,
          );
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            invalidRecord("invalid_json");
          }
          this.#position += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          invalidRecord("invalid_json");
        }
        this.#position += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        invalidRecord("invalid_json");
      }
      this.#position += 1;
    }

    invalidRecord("invalid_json");
  }

  #scanNumber(): void {
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    match.lastIndex = this.#position;
    const result = match.exec(this.#source);
    if (result === null) {
      invalidRecord("invalid_json");
    }
    this.#position = match.lastIndex;
  }

  #scanLiteral(literal: string): void {
    if (!this.#source.startsWith(literal, this.#position)) {
      invalidRecord("invalid_json");
    }
    this.#position += literal.length;
  }

  #assertDepth(depth: number): void {
    if (depth > MAX_JSON_NESTING_DEPTH) {
      invalidRecord("nesting_too_deep");
    }
  }

  #consume(character: string): boolean {
    if (this.#source[this.#position] !== character) {
      return false;
    }
    this.#position += 1;
    return true;
  }

  #skipWhitespace(): void {
    while (
      [" ", "\t", "\n", "\r"].includes(this.#source[this.#position] ?? "")
    ) {
      this.#position += 1;
    }
  }
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_RECORD_BYTES) {
    invalidRecord("response_too_large");
  }
  if (UTF8_BOM.every((byte, index) => bytes[index] === byte)) {
    invalidRecord("utf8_bom");
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    invalidRecord("invalid_utf8", error);
  }

  new JsonStructureScanner(source).scan();
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    invalidRecord("invalid_json", error);
  }
}
