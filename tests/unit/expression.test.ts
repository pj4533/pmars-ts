import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '../../src/assembler/expression';

describe('ExpressionEvaluator', () => {
  let evaluator: ExpressionEvaluator;

  beforeEach(() => {
    evaluator = new ExpressionEvaluator();
  });

  it('evaluates simple numbers', () => {
    const result = evaluator.evaluate('42');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('evaluates addition', () => {
    expect(evaluator.evaluate('3+4')).toEqual({ ok: true, value: 7 });
  });

  it('evaluates subtraction', () => {
    expect(evaluator.evaluate('10-3')).toEqual({ ok: true, value: 7 });
  });

  it('evaluates multiplication', () => {
    expect(evaluator.evaluate('6*7')).toEqual({ ok: true, value: 42 });
  });

  it('evaluates division', () => {
    expect(evaluator.evaluate('42/6')).toEqual({ ok: true, value: 7 });
  });

  it('evaluates modulo', () => {
    expect(evaluator.evaluate('10%3')).toEqual({ ok: true, value: 1 });
  });

  it('handles operator precedence', () => {
    expect(evaluator.evaluate('2+3*4')).toEqual({ ok: true, value: 14 });
    expect(evaluator.evaluate('10-2*3')).toEqual({ ok: true, value: 4 });
  });

  it('handles parentheses', () => {
    expect(evaluator.evaluate('(2+3)*4')).toEqual({ ok: true, value: 20 });
    expect(evaluator.evaluate('((1+2)*(3+4))')).toEqual({ ok: true, value: 21 });
  });

  it('handles unary minus', () => {
    expect(evaluator.evaluate('-5')).toEqual({ ok: true, value: -5 });
    expect(evaluator.evaluate('3--2')).toEqual({ ok: true, value: 5 });
  });

  it('handles unary plus', () => {
    expect(evaluator.evaluate('+5')).toEqual({ ok: true, value: 5 });
  });

  it('handles logical NOT', () => {
    expect(evaluator.evaluate('!0')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('!1')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('!42')).toEqual({ ok: true, value: 0 });
  });

  it('handles comparison operators', () => {
    expect(evaluator.evaluate('3<5')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('5<3')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('3>5')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('5>3')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('3==3')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('3==4')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('3!=4')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('3!=3')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('3<=3')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('3<=2')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('3>=3')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('4>=5')).toEqual({ ok: true, value: 0 });
  });

  it('handles logical AND', () => {
    expect(evaluator.evaluate('1&&1')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('1&&0')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('0&&1')).toEqual({ ok: true, value: 0 });
  });

  it('handles logical OR', () => {
    expect(evaluator.evaluate('0||0')).toEqual({ ok: true, value: 0 });
    expect(evaluator.evaluate('1||0')).toEqual({ ok: true, value: 1 });
    expect(evaluator.evaluate('0||1')).toEqual({ ok: true, value: 1 });
  });

  it('handles division by zero', () => {
    expect(evaluator.evaluate('5/0')).toEqual({ ok: false, error: 'DIV_ZERO' });
    expect(evaluator.evaluate('5%0')).toEqual({ ok: false, error: 'DIV_ZERO' });
  });

  it('handles whitespace', () => {
    expect(evaluator.evaluate('  3 + 4  ')).toEqual({ ok: true, value: 7 });
    expect(evaluator.evaluate('3\t+\t4')).toEqual({ ok: true, value: 7 });
  });

  it('handles registers', () => {
    evaluator.setRegister('A', 10);
    expect(evaluator.evaluate('A')).toEqual({ ok: true, value: 10 });
  });

  it('handles register assignment', () => {
    const result = evaluator.evaluate('A=42');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('handles complex expressions', () => {
    expect(evaluator.evaluate('1+2*3-4/2')).toEqual({ ok: true, value: 5 });
  });

  it('handles nested parentheses', () => {
    expect(evaluator.evaluate('((2+3)*(4-1))')).toEqual({ ok: true, value: 15 });
  });

  it('handles zero', () => {
    expect(evaluator.evaluate('0')).toEqual({ ok: true, value: 0 });
  });

  it('returns BAD_EXPR for empty input', () => {
    expect(evaluator.evaluate('')).toEqual({ ok: false, error: 'BAD_EXPR' });
  });
});
