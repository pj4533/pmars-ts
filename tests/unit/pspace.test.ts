import { describe, it, expect } from 'vitest';
import { PSpace } from '../../src/simulator/pspace';

describe('PSpace', () => {
  it('initializes to zeros', () => {
    const ps = new PSpace(100);
    for (let i = 0; i < 100; i++) {
      expect(ps.get(i)).toBe(0);
    }
  });

  it('set and get', () => {
    const ps = new PSpace(100);
    ps.set(42, 123);
    expect(ps.get(42)).toBe(123);
  });

  it('index 0 returns lastResult', () => {
    const ps = new PSpace(100);
    ps.lastResult = 42;
    expect(ps.get(0)).toBe(42);
    expect(ps.get(100)).toBe(42);  // 100 % 100 = 0
  });

  it('set index 0 updates lastResult', () => {
    const ps = new PSpace(100);
    ps.set(0, 99);
    expect(ps.lastResult).toBe(99);
  });

  it('wraps index by size', () => {
    const ps = new PSpace(100);
    ps.set(1, 10);
    expect(ps.get(101)).toBe(10);  // 101 % 100 = 1
  });

  it('clear resets values', () => {
    const ps = new PSpace(100);
    ps.set(42, 123);
    ps.clear();
    expect(ps.get(42)).toBe(0);
  });

  it('clearKeepResult preserves lastResult behavior', () => {
    const ps = new PSpace(100);
    ps.set(42, 123);
    ps.lastResult = 77;
    ps.clearKeepResult();
    expect(ps.get(42)).toBe(0);
  });
});
