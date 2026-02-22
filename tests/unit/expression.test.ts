import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '../../src/assembler/expression';

describe('ExpressionEvaluator', () => {
  let evaluator: ExpressionEvaluator;

  beforeEach(() => {
    evaluator = new ExpressionEvaluator();
  });

  it('evaluates simple numbers', () => {
    const result = evaluator.evaluate('42');
    expect(result).toEqual({ ok: true, value: 42, overflow: false });
  });

  it('evaluates addition', () => {
    expect(evaluator.evaluate('3+4')).toEqual({ ok: true, value: 7, overflow: false });
  });

  it('evaluates subtraction', () => {
    expect(evaluator.evaluate('10-3')).toEqual({ ok: true, value: 7, overflow: false });
  });

  it('evaluates multiplication', () => {
    expect(evaluator.evaluate('6*7')).toEqual({ ok: true, value: 42, overflow: false });
  });

  it('evaluates division', () => {
    expect(evaluator.evaluate('42/6')).toEqual({ ok: true, value: 7, overflow: false });
  });

  it('evaluates modulo', () => {
    expect(evaluator.evaluate('10%3')).toEqual({ ok: true, value: 1, overflow: false });
  });

  it('handles operator precedence', () => {
    expect(evaluator.evaluate('2+3*4')).toEqual({ ok: true, value: 14, overflow: false });
    expect(evaluator.evaluate('10-2*3')).toEqual({ ok: true, value: 4, overflow: false });
  });

  it('handles parentheses', () => {
    expect(evaluator.evaluate('(2+3)*4')).toEqual({ ok: true, value: 20, overflow: false });
    expect(evaluator.evaluate('((1+2)*(3+4))')).toEqual({ ok: true, value: 21, overflow: false });
  });

  it('handles unary minus', () => {
    expect(evaluator.evaluate('-5')).toEqual({ ok: true, value: -5, overflow: false });
    expect(evaluator.evaluate('3--2')).toEqual({ ok: true, value: 5, overflow: false });
  });

  it('handles unary plus', () => {
    expect(evaluator.evaluate('+5')).toEqual({ ok: true, value: 5, overflow: false });
  });

  it('handles logical NOT', () => {
    expect(evaluator.evaluate('!0')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('!1')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('!42')).toEqual({ ok: true, value: 0, overflow: false });
  });

  it('handles comparison operators', () => {
    expect(evaluator.evaluate('3<5')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('5<3')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('3>5')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('5>3')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('3==3')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('3==4')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('3!=4')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('3!=3')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('3<=3')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('3<=2')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('3>=3')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('4>=5')).toEqual({ ok: true, value: 0, overflow: false });
  });

  it('handles logical AND', () => {
    expect(evaluator.evaluate('1&&1')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('1&&0')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('0&&1')).toEqual({ ok: true, value: 0, overflow: false });
  });

  it('handles logical OR', () => {
    expect(evaluator.evaluate('0||0')).toEqual({ ok: true, value: 0, overflow: false });
    expect(evaluator.evaluate('1||0')).toEqual({ ok: true, value: 1, overflow: false });
    expect(evaluator.evaluate('0||1')).toEqual({ ok: true, value: 1, overflow: false });
  });

  it('handles division by zero', () => {
    expect(evaluator.evaluate('5/0')).toEqual({ ok: false, error: 'DIV_ZERO' });
    expect(evaluator.evaluate('5%0')).toEqual({ ok: false, error: 'DIV_ZERO' });
  });

  it('handles whitespace', () => {
    expect(evaluator.evaluate('  3 + 4  ')).toEqual({ ok: true, value: 7, overflow: false });
    expect(evaluator.evaluate('3\t+\t4')).toEqual({ ok: true, value: 7, overflow: false });
  });

  it('handles registers', () => {
    evaluator.setRegister('A', 10);
    expect(evaluator.evaluate('A')).toEqual({ ok: true, value: 10, overflow: false });
  });

  it('handles register assignment', () => {
    const result = evaluator.evaluate('A=42');
    expect(result).toEqual({ ok: true, value: 42, overflow: false });
  });

  it('handles complex expressions', () => {
    expect(evaluator.evaluate('1+2*3-4/2')).toEqual({ ok: true, value: 5, overflow: false });
  });

  it('handles nested parentheses', () => {
    expect(evaluator.evaluate('((2+3)*(4-1))')).toEqual({ ok: true, value: 15, overflow: false });
  });

  it('handles zero', () => {
    expect(evaluator.evaluate('0')).toEqual({ ok: true, value: 0, overflow: false });
  });

  it('treats overflow as warning, not error', () => {
    // In C pMARS, overflow is a warning — the result is still used
    const result = evaluator.evaluate('2147483647+1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.overflow).toBe(true);
      expect(result.value).toBe(2147483648);
    }
  });

  it('returns BAD_EXPR for empty input', () => {
    expect(evaluator.evaluate('')).toEqual({ ok: false, error: 'BAD_EXPR' });
  });
});
