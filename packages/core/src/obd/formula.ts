/**
 * Torque-style formula compiler for custom PIDs. A hand-written tokenizer and recursive-descent
 * parser turn the expression into a tree of closures; nothing is ever passed to eval/Function,
 * and identifiers are resolved against fixed tables, so formulas from user config cannot reach
 * JavaScript globals or object prototypes.
 *
 * Grammar (lowest to highest precedence, binary operators left-associative):
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("-" | "+") unary | primary
 *   primary    := number | variable | bit | function "(" expression ("," expression)* ")"
 *               | "(" expression ")"
 *   number     := digits ["." digits] | "." digits
 *   variable   := "A" … "Z"                  data byte 0 … 25
 *   bit        := "{" variable ":" 0…7 "}"   one bit of a byte, 0 = least significant
 *   function   := min | max | abs | round | floor | ceil
 */

/** Longest formula accepted, in characters. */
export const MAX_FORMULA_LENGTH = 1000;

/** Deepest nesting of parentheses, function calls and unary operators accepted. */
const MAX_NESTING = 100;

/** A formula that could not be compiled. `position` is the 1-based character column. */
export class FormulaError extends Error {
  readonly expression: string;
  readonly position: number;

  constructor(expression: string, position: number, detail: string) {
    super(`Invalid formula ${quoteForMessage(expression)} at position ${position}: ${detail}`);
    this.name = 'FormulaError';
    this.expression = expression;
    this.position = position;
  }
}

function quoteForMessage(expression: string): string {
  const shown = expression.length > 60 ? `${expression.slice(0, 57)}...` : expression;
  return JSON.stringify(shown);
}

type Evaluator = (data: Uint8Array) => number;
type Operator = '+' | '-' | '*' | '/' | '%';

type Token =
  | { kind: 'number'; pos: number; text: string; value: number }
  | { kind: 'variable'; pos: number; text: string; index: number }
  | { kind: 'bit'; pos: number; text: string; index: number; bit: number }
  | { kind: 'function'; pos: number; text: string; name: FunctionName }
  | { kind: 'operator'; pos: number; text: string; op: Operator }
  | { kind: '(' | ')' | ','; pos: number; text: string }
  | { kind: 'end'; pos: number; text: string };

interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  build(args: readonly Evaluator[]): Evaluator;
}

const unary =
  (fn: (x: number) => number) =>
  ([arg]: readonly Evaluator[]): Evaluator => {
    const x = arg ?? (() => NaN);
    return (d) => fn(x(d));
  };

const variadic =
  (fn: (...xs: number[]) => number) =>
  (args: readonly Evaluator[]): Evaluator =>
  (d) =>
    fn(...args.map((arg) => arg(d)));

const FUNCTIONS = {
  min: { minArgs: 1, maxArgs: Infinity, build: variadic(Math.min) },
  max: { minArgs: 1, maxArgs: Infinity, build: variadic(Math.max) },
  abs: { minArgs: 1, maxArgs: 1, build: unary(Math.abs) },
  round: { minArgs: 1, maxArgs: 1, build: unary(Math.round) },
  floor: { minArgs: 1, maxArgs: 1, build: unary(Math.floor) },
  ceil: { minArgs: 1, maxArgs: 1, build: unary(Math.ceil) },
} as const satisfies Record<string, FunctionSpec>;

type FunctionName = keyof typeof FUNCTIONS;

const FUNCTION_LIST = Object.keys(FUNCTIONS).join(', ');

function isFunctionName(name: string): name is FunctionName {
  return Object.hasOwn(FUNCTIONS, name);
}

// Sticky regexes, matched at an explicit lastIndex.
const NUMBER_RE = /\d+(?:\.\d+)?|\.\d+/y;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const BIT_RE = /\{\s*([A-Z])\s*:\s*(\d+)\s*\}/y;
const WHITESPACE_RE = /\s/;

function matchAt(re: RegExp, source: string, index: number): RegExpExecArray | null {
  re.lastIndex = index;
  return re.exec(source);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const fail = (index: number, detail: string): never => {
    throw new FormulaError(source, index + 1, detail);
  };

  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const pos = i + 1;

    if (WHITESPACE_RE.test(ch)) {
      i++;
      continue;
    }

    if (/[\d.]/.test(ch)) {
      const text = matchAt(NUMBER_RE, source, i)?.[0];
      if (text === undefined) {
        fail(i, `unexpected character ${JSON.stringify(ch)}`);
      } else if (source.charAt(i + text.length) === '.') {
        fail(i, 'malformed number');
      } else {
        tokens.push({ kind: 'number', pos, text, value: Number(text) });
        i += text.length;
      }
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const text = matchAt(IDENTIFIER_RE, source, i)?.[0] ?? ch;
      const lower = text.toLowerCase();
      if (/^[A-Z]$/.test(text)) {
        tokens.push({ kind: 'variable', pos, text, index: text.charCodeAt(0) - 65 });
      } else if (isFunctionName(lower)) {
        tokens.push({ kind: 'function', pos, text, name: lower });
      } else if (/^[a-z]$/.test(text)) {
        fail(
          i,
          `unknown variable '${text}' (data bytes are capital letters, did you mean '${text.toUpperCase()}'?)`,
        );
      } else {
        fail(
          i,
          `unknown name '${text}' (use single capital letters A–Z for data bytes, or one of the functions ${FUNCTION_LIST})`,
        );
      }
      i += text.length;
      continue;
    }

    if (ch === '{') {
      const m = matchAt(BIT_RE, source, i);
      const letter = m?.[1];
      const bitText = m?.[2];
      if (!m || letter === undefined || bitText === undefined) {
        fail(i, "malformed bit reference (expected e.g. '{A:7}' for bit 7 of byte A)");
      } else {
        const bit = Number(bitText);
        if (bit > 7) fail(i, `bit index ${bitText} is out of range (bits are numbered 0–7)`);
        tokens.push({ kind: 'bit', pos, text: m[0], index: letter.charCodeAt(0) - 65, bit });
        i += m[0].length;
      }
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      tokens.push({ kind: 'operator', pos, text: ch, op: ch });
      i++;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ kind: ch, pos, text: ch });
      i++;
      continue;
    }

    fail(i, `unexpected character ${JSON.stringify(ch)}`);
  }
  return tokens;
}

/** Normalise −0 to 0 so callers never see a signed zero. */
const plainZero = (x: number): number => (x === 0 ? 0 : x);

const BINARY: Readonly<Record<Operator, (l: Evaluator, r: Evaluator) => Evaluator>> = {
  '+': (l, r) => (d) => l(d) + r(d),
  '-': (l, r) => (d) => l(d) - r(d),
  '*': (l, r) => (d) => l(d) * r(d),
  '/': (l, r) => (d) => {
    const left = l(d);
    const right = r(d);
    return right === 0 ? NaN : left / right;
  },
  '%': (l, r) => (d) => {
    const left = l(d);
    const right = r(d);
    return right === 0 ? NaN : left % right;
  },
};

class Parser {
  private readonly source: string;
  private readonly tokens: readonly Token[];
  private readonly end: Token;
  private index = 0;
  private depth = 0;
  /** Highest data byte index referenced, −1 when the formula references none. */
  maxByteIndex = -1;

  constructor(source: string, tokens: readonly Token[]) {
    this.source = source;
    this.tokens = tokens;
    this.end = { kind: 'end', pos: source.length + 1, text: 'end of formula' };
  }

  parse(): Evaluator {
    const root = this.expression();
    const next = this.peek();
    if (next.kind !== 'end') {
      this.fail(
        next,
        next.kind === ')' ? "unmatched ')'" : `expected an operator before ${describe(next)}`,
      );
    }
    return root;
  }

  /** The current token; past the last one it is the synthetic end-of-formula token. */
  private peek(): Token {
    return this.tokens[this.index] ?? this.end;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index++;
    return token;
  }

  private fail(token: Token, detail: string): never {
    throw new FormulaError(this.source, token.pos, detail);
  }

  private nested<T>(token: Token, parse: () => T): T {
    if (++this.depth > MAX_NESTING) this.fail(token, 'formula is nested too deeply');
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  private expression(): Evaluator {
    let left = this.term();
    for (
      let t = this.peek();
      t.kind === 'operator' && (t.op === '+' || t.op === '-');
      t = this.peek()
    ) {
      this.next();
      left = BINARY[t.op](left, this.term());
    }
    return left;
  }

  private term(): Evaluator {
    let left = this.unary();
    for (
      let t = this.peek();
      t.kind === 'operator' && (t.op === '*' || t.op === '/' || t.op === '%');
      t = this.peek()
    ) {
      this.next();
      left = BINARY[t.op](left, this.unary());
    }
    return left;
  }

  private unary(): Evaluator {
    const t = this.peek();
    if (t.kind === 'operator' && (t.op === '-' || t.op === '+')) {
      this.next();
      const operand = this.nested(t, () => this.unary());
      return t.op === '-' ? (d) => -operand(d) : operand;
    }
    return this.primary();
  }

  private primary(): Evaluator {
    const t = this.next();
    switch (t.kind) {
      case 'number': {
        const value = t.value;
        return () => value;
      }
      case 'variable': {
        const index = t.index;
        this.maxByteIndex = Math.max(this.maxByteIndex, index);
        return (d) => d[index] ?? NaN;
      }
      case 'bit': {
        const { index, bit } = t;
        this.maxByteIndex = Math.max(this.maxByteIndex, index);
        return (d) => {
          const value = d[index];
          return value === undefined ? NaN : (value >> bit) & 1;
        };
      }
      case 'function':
        return this.nested(t, () => this.call(t.name, t));
      case '(':
        return this.nested(t, () => {
          const inner = this.expression();
          this.expect(')', `missing ')' to close the '(' at position ${t.pos}`);
          return inner;
        });
      default:
        return this.fail(t, `expected a number, byte or function but found ${describe(t)}`);
    }
  }

  private call(name: FunctionName, token: Token): Evaluator {
    const spec: FunctionSpec = FUNCTIONS[name];
    this.expect('(', `expected '(' after function '${token.text}'`);
    const args: Evaluator[] = [];
    if (this.peek().kind !== ')') {
      args.push(this.expression());
      while (this.peek().kind === ',') {
        this.next();
        args.push(this.expression());
      }
    }
    this.expect(')', `missing ')' to close the call to '${token.text}'`);
    if (args.length < spec.minArgs || args.length > spec.maxArgs) {
      const expected =
        spec.maxArgs === Infinity
          ? `at least ${spec.minArgs} argument${spec.minArgs === 1 ? '' : 's'}`
          : `exactly ${spec.minArgs} argument${spec.minArgs === 1 ? '' : 's'}`;
      this.fail(token, `'${token.text}' takes ${expected} but got ${args.length}`);
    }
    return spec.build(args);
  }

  private expect(kind: '(' | ')', detail: string): void {
    const t = this.peek();
    if (t.kind !== kind) this.fail(t, `${detail} but found ${describe(t)}`);
    this.next();
  }
}

function describe(token: Token): string {
  return token.kind === 'end' ? 'the end of the formula' : `'${token.text}'`;
}

/**
 * Compile a Torque-style formula for custom PIDs, e.g. "((A*256)+B)/10 - 40".
 * Variables A–Z map to data bytes 0–25; supports + − * / % ( ), unary minus, decimals,
 * and the functions min, max, abs, round, floor, ceil. Anything else is a compile error
 * (no eval). The compiled function returns NaN if it references a missing byte.
 *
 * Also supports Torque's bit syntax "{A:7}" (bit 7 of byte A → 0 or 1). Division or modulo by
 * zero yields NaN rather than ±Infinity.
 *
 * @throws FormulaError (an Error) naming the problem and its 1-based position.
 */
export function compileFormula(expression: string): (data: Uint8Array) => number {
  if (expression.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(
      expression,
      MAX_FORMULA_LENGTH + 1,
      `formula is longer than ${MAX_FORMULA_LENGTH} characters`,
    );
  }
  if (expression.trim() === '') throw new FormulaError(expression, 1, 'formula is empty');

  const parser = new Parser(expression, tokenize(expression));
  const root = parser.parse();
  const maxByteIndex = parser.maxByteIndex;
  return (data) => (data.length <= maxByteIndex ? NaN : plainZero(root(data)));
}
