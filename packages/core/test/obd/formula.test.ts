import { describe, expect, it } from 'vitest';
import { FormulaError, MAX_FORMULA_LENGTH, compileFormula } from '../../src/obd/formula.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const run = (formula: string, ...data: number[]): number => compileFormula(formula)(bytes(...data));

/** Compile `formula`, expecting a FormulaError; returns it for further assertions. */
function compileError(formula: string): FormulaError {
  try {
    compileFormula(formula);
  } catch (error) {
    expect(error).toBeInstanceOf(FormulaError);
    expect(error).toBeInstanceOf(Error);
    return error as FormulaError;
  }
  throw new Error(`expected ${JSON.stringify(formula)} to fail to compile`);
}

describe('compileFormula — typical custom PID formulas', () => {
  it.each([
    ['A', [42], 42],
    ['A-40', [0x7b], 83],
    ['((A*256)+B)/10 - 40', [0x01, 0x90], 0],
    ['(A*256+B)/4', [0x1a, 0xf8], 1726],
    ['A*100/255', [0xff], 100],
    ['(A-128)*100/128', [0x85], 3.90625],
    // TPMS in kPa gauge from a manufacturer PID: ((A*256)+B)/10 − atmospheric
    ['((A*256)+B)/10 - 101.3', [0x0d, 0x5e], 240.9],
  ] as const)('%s with %j = %s', (formula, data, expected) => {
    expect(run(formula, ...data)).toBeCloseTo(expected, 9);
  });

  it('maps A–Z to data bytes 0–25', () => {
    const data = Array.from({ length: 26 }, (_, i) => i + 1);
    for (let i = 0; i < 26; i++) {
      expect(run(String.fromCharCode(65 + i), ...data)).toBe(i + 1);
    }
  });

  it('tolerates whitespace anywhere between tokens', () => {
    expect(run(' ( A * 256 )\t+\nB ', 1, 2)).toBe(258);
  });

  it('returns a reusable, pure function', () => {
    const fn = compileFormula('A*2+B');
    expect(fn(bytes(1, 2))).toBe(4);
    expect(fn(bytes(10, 0))).toBe(20);
    expect(fn(bytes(1, 2))).toBe(4);
  });
});

describe('compileFormula — operators and precedence', () => {
  it.each([
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['2*3+4', 10],
    ['10-4-3', 3],
    ['100/10/5', 2],
    ['7%4*2', 6],
    ['2*7%4', 2],
    ['20%7%4', 2],
    ['1+2*3-4/2', 5],
    ['8-2*3', 2],
    ['(1+2)*(3+4)', 21],
    ['((((5))))', 5],
    ['-2*-3', 6],
    ['-3-2', -5],
    ['--4', 4],
    ['-(2+3)', -5],
    ['+5', 5],
    ['2*-3', -6],
    ['2--3', 5],
    ['-2+3', 1],
    ['-7%4', -3],
    ['0.5*4', 2],
    ['.25*4', 1],
    ['1.5+1.25', 2.75],
    ['007', 7],
  ] as const)('%s = %s', (formula, expected) => {
    expect(run(formula)).toBe(expected);
  });

  it('applies unary minus to variables', () => {
    expect(run('-A+B', 3, 10)).toBe(7);
    expect(run('B-A', 3, 10)).toBe(7);
    expect(run('-A*B', 3, 10)).toBe(-30);
  });

  it('never returns negative zero', () => {
    expect(Object.is(run('-A', 0), 0)).toBe(true);
    expect(Object.is(run('0*-1'), 0)).toBe(true);
  });
});

describe('compileFormula — functions', () => {
  it.each([
    ['min(A, B)', [7, 3], 3],
    ['max(A, B)', [7, 3], 7],
    ['min(A, B, 1)', [7, 3], 1],
    ['max(5)', [], 5],
    ['abs(A-100)', [40], 60],
    ['abs(-A)', [4], 4],
    ['round(A/4)', [10], 3],
    ['round(2.5)', [], 3],
    ['round(-2.5)', [], -2],
    ['floor(A/4)', [11], 2],
    ['floor(-0.5)', [], -1],
    ['ceil(A/4)', [9], 3],
    ['max(0, min(100, A*2))', [80], 100],
    ['max(0, min(100, A*2))', [30], 60],
    ['min(max(A, B), 50) + abs(-1)', [20, 30], 31],
    ['MAX(A, B)', [1, 2], 2],
    ['Round(A / 3)', [10], 3],
  ] as const)('%s with %j = %s', (formula, data, expected) => {
    expect(run(formula, ...data)).toBe(expected);
  });
});

describe('compileFormula — Torque bit syntax {X:n}', () => {
  it('reads single bits, 0 = least significant', () => {
    expect(run('{A:7}', 0x80)).toBe(1);
    expect(run('{A:7}', 0x7f)).toBe(0);
    expect(run('{A:0}', 0x01)).toBe(1);
    expect(run('{A:0}', 0xfe)).toBe(0);
    expect(run('{B:3}', 0x00, 0x08)).toBe(1);
  });

  it('combines with arithmetic', () => {
    expect(run('{A:3}*10 + {A:2}', 0x0c)).toBe(11);
    expect(run('{ A : 7 }', 0x80)).toBe(1);
  });

  it('returns NaN when the referenced byte is missing', () => {
    expect(run('{B:0}', 0xff)).toBeNaN();
  });

  it.each([
    '{A:8}',
    '{A:10}',
    '{A}',
    '{A:}',
    '{a:1}',
    '{A:-1}',
    '{AB:1}',
    '{A:1',
    '{:1}',
    '{A:1.5}',
  ])('rejects %j', (formula) => {
    expect(compileError(formula).position).toBe(1);
  });
});

describe('compileFormula — missing bytes and division by zero', () => {
  it('returns NaN when a referenced byte is missing', () => {
    expect(run('A')).toBeNaN();
    expect(run('A+B', 1)).toBeNaN();
    expect(run('0*B', 1)).toBeNaN();
    expect(run('min(A, Z)', ...Array.from({ length: 25 }, () => 1))).toBeNaN();
    expect(run('Z', ...Array.from({ length: 26 }, () => 9))).toBe(9);
  });

  it('does not need bytes when the formula references none', () => {
    expect(run('42')).toBe(42);
  });

  it('yields NaN (not ±Infinity) for division or modulo by zero', () => {
    expect(run('A/B', 1, 0)).toBeNaN();
    expect(run('-A/B', 1, 0)).toBeNaN();
    expect(run('0/0')).toBeNaN();
    expect(run('A%B', 5, 0)).toBeNaN();
    expect(run('1/(A-A)', 7)).toBeNaN();
    expect(run('max(1, A/0)', 3)).toBeNaN();
  });
});

describe('compileFormula — syntax errors', () => {
  it.each([
    ['', 1, 'empty'],
    ['   ', 1, 'empty'],
    ['A+', 3, 'end of the formula'],
    ['+', 2, 'end of the formula'],
    ['*A', 1, "'*'"],
    ['A B', 3, 'expected an operator'],
    ['2 3', 3, 'expected an operator'],
    ['A,B', 2, 'expected an operator'],
    ['(A+B', 5, "missing ')'"],
    ['((A)', 5, "missing ')'"],
    ['A+B)', 4, "unmatched ')'"],
    ['()', 2, "')'"],
    ['abs', 4, "expected '('"],
    ['abs A', 5, "expected '('"],
    ['abs(A,B)', 1, 'exactly 1 argument'],
    ['round()', 1, 'exactly 1 argument'],
    ['min()', 1, 'at least 1 argument'],
    ['max(A,)', 7, "')'"],
    ['max(A B)', 7, "missing ')'"],
    ['foo(A)', 1, "unknown name 'foo'"],
    ['sqrt(A)', 1, "unknown name 'sqrt'"],
    ['a+1', 1, "did you mean 'A'"],
    ['AB', 1, "unknown name 'AB'"],
    ['1.2.3', 1, 'malformed number'],
    ['5.', 1, 'malformed number'],
    ['.', 1, 'unexpected character'],
    ['1e3', 2, "unknown name 'e3'"],
    ['A^2', 2, 'unexpected character "^"'],
    ['A**2', 3, "'*'"],
    ['A−B', 2, 'unexpected character'], // U+2212 minus sign is not ASCII '-'
  ] as const)('%j fails at position %i (%s)', (formula, position, fragment) => {
    const error = compileError(formula);
    expect(error.position).toBe(position);
    expect(error.expression).toBe(formula);
    expect(error.message).toContain(fragment);
    expect(error.message).toContain(`position ${position}`);
    expect(error.name).toBe('FormulaError');
  });

  it('abbreviates very long formulas in the message', () => {
    const formula = `${'A+'.repeat(100)}?`;
    const error = compileError(formula);
    expect(error.position).toBe(201);
    expect(error.message.length).toBeLessThan(200);
  });
});

describe('compileFormula — hostile input', () => {
  it.each([
    'constructor',
    '__proto__',
    'prototype',
    'toString',
    'valueOf(A)',
    'hasOwnProperty(A)',
    'A;process.exit()',
    'process.exit(1)',
    'A.constructor',
    "A['constructor']",
    'A[0]',
    'this',
    'globalThis',
    'window.alert(1)',
    "require('fs')",
    "import('fs')",
    'eval(A)',
    "Function('return 1')()",
    'new Date()',
    '`${A}`',
    'A=1',
    'A==1',
    'A&&B',
    'A|B',
    'A?B:C',
    '() => A',
    '/* comment */ A',
    'A // comment',
    '{A:7}.constructor',
    'min.constructor',
  ])('rejects %j without evaluating it', (formula) => {
    compileError(formula);
  });

  it('rejects formulas longer than the limit', () => {
    const tooLong = `${'A+'.repeat(MAX_FORMULA_LENGTH / 2)}A`;
    expect(tooLong.length).toBeGreaterThan(MAX_FORMULA_LENGTH);
    expect(compileError(tooLong).message).toContain('longer than');

    const atLimit = `${'1+'.repeat(MAX_FORMULA_LENGTH / 2 - 1)}11`;
    expect(atLimit).toHaveLength(MAX_FORMULA_LENGTH);
    expect(compileFormula(atLimit)(bytes())).toBe(MAX_FORMULA_LENGTH / 2 - 1 + 11);
  });

  it('rejects pathological nesting with a FormulaError instead of overflowing the stack', () => {
    expect(compileError(`${'('.repeat(150)}A${')'.repeat(150)}`).message).toContain('nested');
    expect(compileError(`${'-'.repeat(200)}A`).message).toContain('nested');
    expect(compileError(`${'abs('.repeat(120)}A${')'.repeat(120)}`).message).toContain('nested');
    expect(run(`${'('.repeat(50)}A${')'.repeat(50)}`, 3)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Differential check: random expression trees rendered with minimal parentheses (relying on
// precedence and left-associativity) and with full parentheses must both evaluate exactly like
// the tree itself.
// ---------------------------------------------------------------------------------------------

type Tree =
  | { kind: 'num'; value: number }
  | { kind: 'var'; index: number }
  | { kind: 'neg'; operand: Tree }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '%'; left: Tree; right: Tree };

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 } as const;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomTree(rand: () => number, depth: number): Tree {
  const r = rand();
  if (depth <= 0 || r < 0.25) {
    return rand() < 0.5
      ? { kind: 'num', value: Math.floor(rand() * 20) / (rand() < 0.3 ? 4 : 1) }
      : { kind: 'var', index: Math.floor(rand() * 4) };
  }
  if (r < 0.35) return { kind: 'neg', operand: randomTree(rand, depth - 1) };
  const ops = ['+', '-', '*', '/', '%'] as const;
  return {
    kind: 'bin',
    op: ops[Math.floor(rand() * ops.length)] ?? '+',
    left: randomTree(rand, depth - 1),
    right: randomTree(rand, depth - 1),
  };
}

function evaluate(tree: Tree, data: Uint8Array): number {
  switch (tree.kind) {
    case 'num':
      return tree.value;
    case 'var':
      return data[tree.index] ?? NaN;
    case 'neg':
      return -evaluate(tree.operand, data);
    case 'bin': {
      const l = evaluate(tree.left, data);
      const r = evaluate(tree.right, data);
      if (tree.op === '+') return l + r;
      if (tree.op === '-') return l - r;
      if (tree.op === '*') return l * r;
      if (r === 0) return NaN;
      return tree.op === '/' ? l / r : l % r;
    }
  }
}

function renderFull(tree: Tree): string {
  switch (tree.kind) {
    case 'num':
      return String(tree.value);
    case 'var':
      return String.fromCharCode(65 + tree.index);
    case 'neg':
      return `(-${renderFull(tree.operand)})`;
    case 'bin':
      return `(${renderFull(tree.left)}${tree.op}${renderFull(tree.right)})`;
  }
}

/** Parenthesise only where precedence / left-associativity require it. */
function renderMinimal(tree: Tree): string {
  switch (tree.kind) {
    case 'num':
      return String(tree.value);
    case 'var':
      return String.fromCharCode(65 + tree.index);
    case 'neg': {
      const inner = renderMinimal(tree.operand);
      return tree.operand.kind === 'bin' ? `-(${inner})` : `-${inner}`;
    }
    case 'bin': {
      const p = PRECEDENCE[tree.op];
      const wrap = (child: Tree, isRight: boolean): string => {
        const text = renderMinimal(child);
        if (child.kind !== 'bin') return text;
        const cp = PRECEDENCE[child.op];
        return cp < p || (isRight && cp === p) ? `(${text})` : text;
      };
      return `${wrap(tree.left, false)} ${tree.op} ${wrap(tree.right, true)}`;
    }
  }
}

describe('compileFormula — randomised precedence check', () => {
  it('agrees with direct tree evaluation for 500 random expressions', () => {
    const rand = lcg(0xc0ffee);
    const samples = [bytes(0, 1, 2, 3), bytes(7, 3, 255, 128), bytes(12, 0, 5, 1)];
    for (let i = 0; i < 500; i++) {
      const tree = randomTree(rand, 5);
      const minimal = compileFormula(renderMinimal(tree));
      const full = compileFormula(renderFull(tree));
      for (const data of samples) {
        const raw = evaluate(tree, data);
        const expected = raw === 0 ? 0 : raw;
        expect(minimal(data), renderMinimal(tree)).toBe(expected);
        expect(full(data), renderFull(tree)).toBe(expected);
      }
    }
  });
});
