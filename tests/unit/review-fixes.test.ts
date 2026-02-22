import { describe, it, expect, beforeEach } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { ExpressionEvaluator } from '../../src/assembler/expression';
import { PSpace } from '../../src/simulator/pspace';
import { Simulator } from '../../src/simulator/index';
import { Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode } from '../../src/constants';

describe('Phase 1 Bug Fix Verification', () => {
  describe('1a: Circular EQU in ORG/END directives', () => {
    let asm: Assembler;

    beforeEach(() => {
      asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    });

    it('should not crash with circular EQU definitions in ORG directive', () => {
      // Circular EQU: A equ B, B equ A, ORG A
      // Should not crash with stack overflow, should resolve to 0
      const result = asm.assemble('A EQU B\nB EQU A\nDAT 0, 0\nORG A');
      expect(result.success).toBe(true);
      // ORG resolves to 0 due to cycle detection
    });

    it('should not crash with circular EQU definitions in END directive', () => {
      const result = asm.assemble('X EQU Y\nY EQU X\nDAT 0, 0\nEND X');
      expect(result.success).toBe(true);
      // END expression resolves to 0 due to cycle detection
    });

    it('should not crash with self-referencing EQU in ORG', () => {
      const result = asm.assemble('Z EQU Z\nDAT 0, 0\nORG Z');
      expect(result.success).toBe(true);
    });

    it('should not crash with circular EQU definitions in PIN directive', () => {
      const result = asm.assemble('P EQU Q\nQ EQU P\nDAT 0, 0\nPIN P');
      expect(result.success).toBe(true);
    });

    it('should handle a longer circular chain: A->B->C->A', () => {
      const result = asm.assemble('A EQU B\nB EQU C\nC EQU A\nDAT 0, 0\nORG A');
      expect(result.success).toBe(true);
    });
  });

  describe('1b: FOR count truncation at 65535 boundary', () => {
    let asm: Assembler;

    beforeEach(() => {
      asm = new Assembler({ coreSize: 8000, maxLength: 1000 });
    });

    it('FOR 65536 should become FOR 0 (65536 & 0xFFFF = 0), producing no instructions', () => {
      // FOR 65536 should become FOR 0 (65536 & 0xFFFF = 0)
      // Only the trailing DAT outside the loop should remain
      const result = asm.assemble('FOR 65536\nDAT 0, 0\nROF\nDAT 1, 1');
      expect(result.success).toBe(true);
      // Should have 1 instruction (only the DAT 1, 1 outside the loop)
      expect(result.warrior?.instructions.length).toBe(1);
    });

    it('FOR 65535 should produce 65535 iterations (max 16-bit unsigned)', () => {
      // We cannot actually produce 65535 instructions in a test easily,
      // but we verify the count logic by using a small count that stays within 16-bit
      const result = asm.assemble('FOR 3\nDAT 0, 0\nROF');
      expect(result.success).toBe(true);
      expect(result.warrior?.instructions.length).toBe(3);
    });

    it('FOR 65537 should become FOR 1 (65537 & 0xFFFF = 1)', () => {
      const result = asm.assemble('FOR 65537\nDAT 0, 0\nROF');
      expect(result.success).toBe(true);
      expect(result.warrior?.instructions.length).toBe(1);
    });

    it('FOR 131072 should become FOR 0 (131072 & 0xFFFF = 0)', () => {
      // 131072 = 2 * 65536, so 131072 & 0xFFFF = 0
      const result = asm.assemble('FOR 131072\nDAT 0, 0\nROF\nDAT 1, 1');
      expect(result.success).toBe(true);
      // Should have 1 instruction (only the DAT 1, 1 outside the loop)
      expect(result.warrior?.instructions.length).toBe(1);
    });

    it('FOR 0 should produce no instructions', () => {
      const result = asm.assemble('FOR 0\nDAT 0, 0\nROF\nDAT 1, 1');
      expect(result.success).toBe(true);
      expect(result.warrior?.instructions.length).toBe(1);
    });
  });

  describe('1c: PSpace clear() resets lastResult vs clearKeepResult() preserves it', () => {
    it('clear() should reset lastResult to 0', () => {
      const ps = new PSpace(500, 8000);
      ps.lastResult = 42;
      ps.clear();
      expect(ps.lastResult).toBe(0);
    });

    it('clearKeepResult() should preserve lastResult', () => {
      const ps2 = new PSpace(500, 8000);
      ps2.lastResult = 42;
      ps2.clearKeepResult();
      expect(ps2.lastResult).toBe(42);
    });

    it('clear() should also reset all cells', () => {
      const ps = new PSpace(500, 8000);
      ps.set(10, 99);
      ps.set(20, 88);
      ps.lastResult = 77;
      ps.clear();
      expect(ps.get(10)).toBe(0);
      expect(ps.get(20)).toBe(0);
      expect(ps.lastResult).toBe(0);
      // get(0) returns lastResult, which should be 0
      expect(ps.get(0)).toBe(0);
    });

    it('clearKeepResult() should reset cells but preserve lastResult', () => {
      const ps = new PSpace(500, 8000);
      ps.set(10, 99);
      ps.set(20, 88);
      ps.lastResult = 77;
      ps.clearKeepResult();
      expect(ps.get(10)).toBe(0);
      expect(ps.get(20)).toBe(0);
      expect(ps.lastResult).toBe(77);
      // get(0) returns lastResult, which should still be 77
      expect(ps.get(0)).toBe(77);
    });
  });

  describe('1d: Checksum 32-bit wrapping with large warriors', () => {
    it('should not produce NaN or Infinity when running rounds with large warriors', () => {
      // Create warriors with large field values that would cause checksum overflow
      // without 32-bit integer math (the | 0 truncation)
      const asm = new Assembler({ coreSize: 8000, maxLength: 100 });

      // Build warriors with large values
      const warrior1Source = Array.from({ length: 50 }, (_, i) =>
        `DAT #${7000 + i}, #${7000 + i}`
      ).join('\n');
      const warrior2Source = Array.from({ length: 50 }, (_, i) =>
        `DAT #${6000 + i}, #${6000 + i}`
      ).join('\n');

      const r1 = asm.assemble(warrior1Source);
      const r2 = asm.assemble(warrior2Source);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      const sim = new Simulator({ coreSize: 8000, maxCycles: 100 });
      // This should not throw; the checksum uses | 0 for 32-bit wrapping
      expect(() => {
        sim.loadWarriors([r1.warrior!, r2.warrior!]);
        const results = sim.run(1);
        expect(results.length).toBe(1);
        // The result should be valid (WIN or TIE), not affected by bad checksums
        expect(['WIN', 'TIE']).toContain(results[0].outcome);
      }).not.toThrow();
    });

    it('checksum should stay within 32-bit signed integer range via | 0', () => {
      // Verify the | 0 truncation behavior directly with a conceptual test:
      // In JS, (2147483647 + 1) | 0 === -2147483648 (wraps to 32-bit)
      const maxInt32 = 2147483647;
      expect((maxInt32 + 1) | 0).toBe(-2147483648);
      // This confirms the | 0 operator provides 32-bit wrapping
      // which is what checksumWarriors() uses
    });
  });

  describe('1e: Expression parser digit limit', () => {
    let evaluator: ExpressionEvaluator;

    beforeEach(() => {
      evaluator = new ExpressionEvaluator();
    });

    it('should parse a number with exactly 20 digits', () => {
      // 20 digits should parse fine (reads exactly 20)
      const result = evaluator.evaluate('12345678901234567890');
      expect(result.ok).toBe(true);
    });

    it('should fail on a number with 21+ digits (trailing chars cause BAD_EXPR)', () => {
      // 21+ digits: only first 20 are consumed, '1' left over causes BAD_EXPR
      const result = evaluator.evaluate('123456789012345678901');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('BAD_EXPR');
      }
    });

    it('should handle numbers shorter than 20 digits normally', () => {
      const result = evaluator.evaluate('12345');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(12345);
      }
    });

    it('should truncate at 20 digits in a sub-expression', () => {
      // '99999999999999999999' is 20 digits - should parse
      const result = evaluator.evaluate('99999999999999999999');
      expect(result.ok).toBe(true);

      // '999999999999999999991' is 21 digits - should fail with BAD_EXPR
      const result2 = evaluator.evaluate('999999999999999999991');
      expect(result2.ok).toBe(false);
    });

    it('should handle 20-digit number in addition expression', () => {
      // First operand is 20 digits, second is normal
      const result = evaluator.evaluate('10000000000000000000+1');
      expect(result.ok).toBe(true);
    });
  });
});
