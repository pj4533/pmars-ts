import { describe, it, expect } from 'vitest';
import { PSpace, computePSpaceSize } from '../../src/simulator/pspace';

describe('PSpace', () => {
  it('initializes non-zero cells to zeros and lastResult to coreSize-1', () => {
    const ps = new PSpace(100, 8000);
    // index 0 returns lastResult which is coreSize - 1
    expect(ps.get(0)).toBe(7999);
    for (let i = 1; i < 100; i++) {
      expect(ps.get(i)).toBe(0);
    }
  });

  it('set and get', () => {
    const ps = new PSpace(100, 8000);
    ps.set(42, 123);
    expect(ps.get(42)).toBe(123);
  });

  it('index 0 returns lastResult', () => {
    const ps = new PSpace(100, 8000);
    ps.lastResult = 42;
    expect(ps.get(0)).toBe(42);
    expect(ps.get(100)).toBe(42);  // 100 % 100 = 0
  });

  it('set index 0 updates lastResult', () => {
    const ps = new PSpace(100, 8000);
    ps.set(0, 99);
    expect(ps.lastResult).toBe(99);
  });

  it('wraps index by size', () => {
    const ps = new PSpace(100, 8000);
    ps.set(1, 10);
    expect(ps.get(101)).toBe(10);  // 101 % 100 = 1
  });

  it('clear resets values', () => {
    const ps = new PSpace(100, 8000);
    ps.set(42, 123);
    ps.clear();
    expect(ps.get(42)).toBe(0);
  });

  it('clearKeepResult preserves lastResult behavior', () => {
    const ps = new PSpace(100, 8000);
    ps.set(42, 123);
    ps.lastResult = 77;
    ps.clearKeepResult();
    expect(ps.get(42)).toBe(0);
  });
});

describe('computePSpaceSize', () => {
  it('computes correct pspace size for standard core sizes', () => {
    expect(computePSpaceSize(8000)).toBe(500);   // 8000 / 16
    expect(computePSpaceSize(800)).toBe(50);      // 800 / 16
    expect(computePSpaceSize(80000)).toBe(5000);  // 80000 / 16
  });

  it('falls back for non-divisible sizes', () => {
    // 17 is prime; 17 % 1 === 0, so returns Math.floor(17/1) = 17
    expect(computePSpaceSize(17)).toBe(17);
  });

  it('handles small core sizes', () => {
    expect(computePSpaceSize(16)).toBe(1);   // 16 / 16
    expect(computePSpaceSize(32)).toBe(2);   // 32 / 16
  });
});
