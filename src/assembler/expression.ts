const IDENT = 0x7F;
const EQUAL = 0x80;
const NEQU = 0x81;
const GTE = 0x82;
const LTE = 0x83;
const AND = 0x84;
const OR = 0x85;

function precedence(op: number): number {
  if (op === '*'.charCodeAt(0) || op === '/'.charCodeAt(0) || op === '%'.charCodeAt(0)) return 5;
  if (op === '+'.charCodeAt(0) || op === '-'.charCodeAt(0)) return 4;
  if (op === '>'.charCodeAt(0) || op === '<'.charCodeAt(0) || op === EQUAL || op === NEQU || op === GTE || op === LTE) return 3;
  if (op === AND) return 2;
  if (op === OR) return 1;
  return 0;
}

function isTerminal(ch: string): boolean {
  return ch === ')' || ch === '' || ch === undefined;
}

export type EvalResult = { ok: true; value: number; overflow: boolean } | { ok: false; error: 'BAD_EXPR' | 'DIV_ZERO' };

const MAX_EXPR_DEPTH = 256;

export class ExpressionEvaluator {
  private registers: number[] = new Array(26).fill(0);
  private saveOper = 0;
  private error: 'BAD_EXPR' | 'DIV_ZERO' | 'OVERFLOW' | null = null;

  resetRegisters(): void {
    this.registers.fill(0);
  }

  setRegister(name: string, value: number): void {
    const idx = name.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    if (idx >= 0 && idx < 26) this.registers[idx] = value;
  }

  evaluate(expr: string): EvalResult {
    this.error = null;
    this.saveOper = 0;

    const ctx = { pos: 0, src: expr.trim() };
    const result = this.evalExpr(ctx, -1, 0, IDENT, 0);

    this.skipSpace(ctx);
    if (ctx.pos < ctx.src.length) {
      return { ok: false, error: 'BAD_EXPR' };
    }

    if (this.error === 'OVERFLOW') {
      return { ok: true, value: result, overflow: true };
    }

    if (this.error) {
      return { ok: false, error: this.error };
    }

    return { ok: true, value: result, overflow: false };
  }

  private evalExpr(ctx: { pos: number; src: string }, prevPrec: number, val1: number, oper1: number, depth: number): number {
    if (depth > MAX_EXPR_DEPTH) {
      this.error = 'BAD_EXPR';
      return 0;
    }
    this.saveOper = 0;
    const val2 = this.getVal(ctx, depth);

    this.skipSpace(ctx);
    if (isTerminal(ctx.src[ctx.pos])) {
      return this.calc(val1, val2, oper1);
    }

    const oper2 = this.getOp(ctx);
    const prec1 = precedence(oper1);
    const prec2 = precedence(oper2);

    if (prec1 >= prec2) {
      if (prec2 > prevPrec) {
        return this.evalExpr(ctx, prevPrec, this.calc(val1, val2, oper1), oper2, depth + 1);
      } else {
        this.saveOper = oper2;
        return this.calc(val1, val2, oper1);
      }
    } else {
      const result2 = this.evalExpr(ctx, prec1, val2, oper2, depth + 1);
      let result = this.calc(val1, result2, oper1);

      if (this.saveOper && precedence(this.saveOper) >= prevPrec) {
        result = this.evalExpr(ctx, prevPrec, result, this.saveOper, depth + 1);
      }

      return result;
    }
  }

  private getVal(ctx: { pos: number; src: string }, depth: number): number {
    if (depth > MAX_EXPR_DEPTH) {
      this.error = 'BAD_EXPR';
      return 0;
    }
    this.skipSpace(ctx);
    const ch = ctx.src[ctx.pos];

    if (ch === '(') {
      ctx.pos++;
      const val = this.evalExpr(ctx, -1, 0, IDENT, depth + 1);
      if (ctx.src[ctx.pos] !== ')') {
        this.error = 'BAD_EXPR';
      }
      ctx.pos++;
      return val;
    }

    if (ch === '-') {
      ctx.pos++;
      return -this.getVal(ctx, depth + 1);
    }

    if (ch === '!') {
      ctx.pos++;
      const v = this.getVal(ctx, depth + 1);
      return v ? 0 : 1;
    }

    if (ch === '+') {
      ctx.pos++;
      return this.getVal(ctx, depth + 1);
    }

    const upper = ch?.toUpperCase();
    if (upper && upper >= 'A' && upper <= 'Z') {
      ctx.pos++;
      const regId = upper.charCodeAt(0) - 'A'.charCodeAt(0);
      this.skipSpace(ctx);
      if (ctx.src[ctx.pos] === '=' && ctx.src[ctx.pos + 1] !== '=') {
        ctx.pos++;
        const val = this.evalExpr(ctx, -1, 0, IDENT, depth + 1);
        this.registers[regId] = val;
        return val;
      }
      return this.registers[regId];
    }

    // Parse number
    let numStr = '';
    while (ctx.pos < ctx.src.length && ctx.src[ctx.pos] >= '0' && ctx.src[ctx.pos] <= '9' && numStr.length < 20) {
      numStr += ctx.src[ctx.pos];
      ctx.pos++;
    }

    if (numStr.length === 0) {
      this.error = 'BAD_EXPR';
      return 0;
    }

    return parseInt(numStr, 10);
  }

  private getOp(ctx: { pos: number; src: string }): number {
    const ch = ctx.src[ctx.pos];
    ctx.pos++;

    switch (ch) {
      case '&':
        if (ctx.src[ctx.pos] === '&') { ctx.pos++; return AND; }
        return ch.charCodeAt(0);
      case '|':
        if (ctx.src[ctx.pos] === '|') { ctx.pos++; return OR; }
        return ch.charCodeAt(0);
      case '=':
        if (ctx.src[ctx.pos] === '=') { ctx.pos++; return EQUAL; }
        return ch.charCodeAt(0);
      case '!':
        if (ctx.src[ctx.pos] === '=') { ctx.pos++; return NEQU; }
        return ch.charCodeAt(0);
      case '<':
        if (ctx.src[ctx.pos] === '=') { ctx.pos++; return LTE; }
        return ch.charCodeAt(0);
      case '>':
        if (ctx.src[ctx.pos] === '=') { ctx.pos++; return GTE; }
        return ch.charCodeAt(0);
      default:
        return ch.charCodeAt(0);
    }
  }

  private checkOverflow(result: number): number {
    if (result > 2147483647 || result < -2147483648) this.error = 'OVERFLOW';
    return result;
  }

  private calc(x: number, y: number, op: number): number {
    switch (op) {
      case '+'.charCodeAt(0): return this.checkOverflow(x + y);
      case '-'.charCodeAt(0): return this.checkOverflow(x - y);
      case '*'.charCodeAt(0): return this.checkOverflow(x * y);
      case '/'.charCodeAt(0):
        if (y === 0) { this.error = 'DIV_ZERO'; return 0; }
        return Math.trunc(x / y);
      case '%'.charCodeAt(0):
        if (y === 0) { this.error = 'DIV_ZERO'; return 0; }
        return x % y;
      case AND: return (x && y) ? 1 : 0;
      case OR: return (x || y) ? 1 : 0;
      case EQUAL: return x === y ? 1 : 0;
      case NEQU: return x !== y ? 1 : 0;
      case '<'.charCodeAt(0): return x < y ? 1 : 0;
      case '>'.charCodeAt(0): return x > y ? 1 : 0;
      case LTE: return x <= y ? 1 : 0;
      case GTE: return x >= y ? 1 : 0;
      case IDENT: return y;
      default:
        this.error = 'BAD_EXPR';
        return 0;
    }
  }

  private skipSpace(ctx: { pos: number; src: string }): void {
    while (ctx.pos < ctx.src.length) {
      const ch = ctx.src[ctx.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
        ctx.pos++;
      } else {
        break;
      }
    }
  }
}
