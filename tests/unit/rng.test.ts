import { describe, it, expect } from 'vitest';
import { rng } from '../../src/utils/rng';

describe('rng (Park-Miller Lehmer RNG)', () => {
  it('produces deterministic output for a given seed', () => {
    const result = rng(1);
    expect(result).toBe(16807);
  });

  it('produces correct sequence', () => {
    let seed = 1;
    seed = rng(seed); // 16807
    seed = rng(seed); // 282475249
    seed = rng(seed); // 1622650073
    expect(seed).toBe(1622650073);
  });

  it('stays within valid range', () => {
    let seed = 12345;
    for (let i = 0; i < 1000; i++) {
      seed = rng(seed);
      expect(seed).toBeGreaterThan(0);
      expect(seed).toBeLessThan(2147483647);
    }
  });

  it('different seeds produce different outputs', () => {
    const a = rng(42);
    const b = rng(43);
    expect(a).not.toBe(b);
  });
});
