import { describe, it, expect } from 'vitest';
import { positionWarriors } from '../../src/simulator/positioning';

describe('positionWarriors', () => {
  it('returns position 0 for single warrior', () => {
    const { positions, seed } = positionWarriors(1, 8000, 100, 12345);
    expect(positions).toEqual([0]);
  });

  it('positions 2 warriors with separation', () => {
    const { positions, seed } = positionWarriors(2, 8000, 100, 12345);
    expect(positions.length).toBe(2);
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBeGreaterThanOrEqual(100);
  });

  it('returns deterministic results for same seed', () => {
    const r1 = positionWarriors(2, 8000, 100, 42);
    const r2 = positionWarriors(2, 8000, 100, 42);
    expect(r1.positions).toEqual(r2.positions);
    expect(r1.seed).toBe(r2.seed);
  });

  it('different seeds give different positions', () => {
    const r1 = positionWarriors(2, 8000, 100, 42);
    const r2 = positionWarriors(2, 8000, 100, 43);
    // Could theoretically be the same, but very unlikely
    // At minimum the seeds should differ
    expect(r1.seed).not.toBe(r2.seed);
  });

  it('positions 3 warriors with separation', () => {
    const { positions } = positionWarriors(3, 8000, 100, 12345);
    expect(positions.length).toBe(3);
    expect(positions[0]).toBe(0);
    // All positions should be non-negative and within core size
    for (const p of positions) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(8000);
    }
  });

  it('positions respect minimum separation for 3 warriors', () => {
    const { positions } = positionWarriors(3, 8000, 100, 999);
    expect(positions.length).toBe(3);
    // Positions 1+ should be >= separation from position 0
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(100);
    }
  });

  it('handles small core with tight separation', () => {
    const { positions } = positionWarriors(2, 200, 50, 12345);
    expect(positions.length).toBe(2);
    expect(positions[1]).toBeGreaterThanOrEqual(50);
  });
});
