import { describe, it, expect } from 'vitest';
import { addMod, subMod, normalize } from '../../src/utils/modular-arithmetic';

describe('addMod', () => {
  it('adds two numbers within range', () => {
    expect(addMod(3, 4, 8000)).toBe(7);
  });

  it('wraps around when sum exceeds modulus', () => {
    expect(addMod(7999, 1, 8000)).toBe(0);
    expect(addMod(7999, 2, 8000)).toBe(1);
  });

  it('handles zero', () => {
    expect(addMod(0, 0, 8000)).toBe(0);
    expect(addMod(0, 5, 8000)).toBe(5);
  });

  it('handles edge at exactly modulus', () => {
    expect(addMod(4000, 4000, 8000)).toBe(0);
  });
});

describe('subMod', () => {
  it('subtracts within range', () => {
    expect(subMod(7, 3, 8000)).toBe(4);
  });

  it('wraps around when result is negative', () => {
    expect(subMod(0, 1, 8000)).toBe(7999);
    expect(subMod(3, 5, 8000)).toBe(7998);
  });

  it('handles zero', () => {
    expect(subMod(0, 0, 8000)).toBe(0);
    expect(subMod(5, 0, 8000)).toBe(5);
  });
});

describe('normalize', () => {
  it('returns value unchanged when in range', () => {
    expect(normalize(42, 8000)).toBe(42);
  });

  it('wraps positive values', () => {
    expect(normalize(8001, 8000)).toBe(1);
    expect(normalize(16000, 8000)).toBe(0);
  });

  it('wraps negative values', () => {
    expect(normalize(-1, 8000)).toBe(7999);
    expect(normalize(-8000, 8000)).toBe(0);
    expect(normalize(-8001, 8000)).toBe(7999);
  });

  it('handles zero', () => {
    expect(normalize(0, 8000)).toBe(0);
  });
});
