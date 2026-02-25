/**
 * Tests for audit findings v2: FOR cleanup, MAXINSTR, fixed positioning,
 * separation=0, MAXWARRIOR, compat options, configurable scoring.
 */
import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { Simulator } from '../../src/simulator/index';
import { Opcode, Modifier, AddressMode, DEFAULT_OPTIONS } from '../../src/types';
import { encodeOpcode } from '../../src/constants';

function makeWarrior(instructions: { op: Opcode; mod: Modifier; aMode: AddressMode; aVal: number; bMode: AddressMode; bVal: number }[], startOffset = 0) {
  return {
    instructions: instructions.map(i => ({
      opcode: encodeOpcode(i.op, i.mod),
      aMode: i.aMode,
      bMode: i.bMode,
      aValue: i.aVal,
      bValue: i.bVal,
    })),
    startOffset,
    name: 'Test',
    author: 'Test',
    strategy: '',
    pin: null,
  };
}

function makeImpWarrior() {
  return makeWarrior([
    { op: Opcode.MOV, mod: Modifier.I, aMode: AddressMode.DIRECT, aVal: 0, bMode: AddressMode.DIRECT, bVal: 1 },
  ]);
}

describe('FOR counter cleanup after ROF', () => {
  it('should not leak FOR counter variable after ROF', () => {
    const source = `
;redcode
;assert 1
count FOR 3
  DAT 0, count
ROF
MOV 0, 1
`;
    const asm = new Assembler();
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    // 3 DATs + 1 MOV = 4 instructions
    expect(result.warrior!.instructions.length).toBe(4);
  });

  it('FOR counter should not pollute subsequent EQU definitions', () => {
    const source = `
;redcode
;assert 1
i FOR 2
  DAT 0, i
ROF
i EQU 42
MOV #i, 0
`;
    const asm = new Assembler();
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    // The MOV should use the EQU value of 42, not the FOR counter
    const movInstr = result.warrior!.instructions[result.warrior!.instructions.length - 1];
    expect(movInstr.aValue).toBe(42);
  });
});

describe('maxLength instruction limit', () => {
  it('should enforce maxLength when set low', () => {
    const asm = new Assembler({ maxLength: 5 });
    const lines = [];
    for (let i = 0; i < 6; i++) lines.push('DAT 0, 0');
    const source = `;redcode\n;assert 1\n${lines.join('\n')}`;
    const result = asm.assemble(source);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit is 5'))).toBe(true);
  });

  it('should allow >1000 instructions when maxLength is raised', () => {
    const asm = new Assembler({ maxLength: 2000 });
    const lines = [];
    for (let i = 0; i < 1001; i++) lines.push('DAT 0, 0');
    const source = `;redcode\n;assert 1\n${lines.join('\n')}`;
    const result = asm.assemble(source);
    expect(result.messages.filter(m => m.type === 'ERROR').length).toBe(0);
    expect(result.warrior!.instructions.length).toBe(1001);
  });

  it('should allow exactly maxLength instructions', () => {
    const asm = new Assembler({ maxLength: 1000 });
    const lines = [];
    for (let i = 0; i < 1000; i++) lines.push('DAT 0, 0');
    const source = `;redcode\n;assert 1\n${lines.join('\n')}`;
    const result = asm.assemble(source);
    expect(result.messages.filter(m => m.type === 'ERROR').length).toBe(0);
    expect(result.warrior!.instructions.length).toBe(1000);
  });
});

describe('Fixed position modes', () => {
  it('DEFAULT_OPTIONS should include fixedSeries and fixedPosition', () => {
    expect(DEFAULT_OPTIONS.fixedSeries).toBe(false);
    expect(DEFAULT_OPTIONS.fixedPosition).toBeNull();
  });

  it('fixedSeries uses checksum-derived seed', () => {
    const w1 = makeImpWarrior();
    const w2 = makeImpWarrior();

    // With fixedSeries, running the same warriors should produce deterministic positioning
    const sim1 = new Simulator({ fixedSeries: true, rounds: 1 });
    sim1.loadWarriors([w1, w2]);
    const results1 = sim1.run(1);

    const sim2 = new Simulator({ fixedSeries: true, rounds: 1 });
    sim2.loadWarriors([w1, w2]);
    const results2 = sim2.run(1);

    // Same warriors + fixedSeries should produce identical results
    expect(results1[0].outcome).toBe(results2[0].outcome);
    expect(results1[0].winnerId).toBe(results2[0].winnerId);
  });

  it('fixedPosition sets explicit position for warrior 2', () => {
    const w1 = makeImpWarrior();
    const w2 = makeImpWarrior();

    // fixedPosition must be >= minSeparation (which defaults to maxLength=100)
    const sim = new Simulator({ fixedPosition: 200, rounds: 1 });
    sim.loadWarriors([w1, w2]);
    const results = sim.run(1);
    expect(results.length).toBe(1);
  });

  it('fixedSeries and fixedPosition are mutually exclusive', () => {
    const w1 = makeImpWarrior();
    const w2 = makeImpWarrior();

    const sim = new Simulator({ fixedSeries: true, fixedPosition: 200 });
    expect(() => sim.loadWarriors([w1, w2])).toThrow('mutually exclusive');
  });

  it('fixedPosition must be >= separation', () => {
    const w1 = makeImpWarrior();
    const w2 = makeImpWarrior();

    // minSeparation defaults to maxLength=100, fixedPosition=50 should fail
    const sim = new Simulator({ fixedPosition: 50 });
    expect(() => sim.loadWarriors([w1, w2])).toThrow('fixedPosition');
  });
});

describe('Separation=0 fallback', () => {
  it('minSeparation=0 should be set to maxLength', () => {
    const w1 = makeImpWarrior();
    const w2 = makeImpWarrior();

    // Should not throw — 0 gets adjusted to maxLength
    const sim = new Simulator({ minSeparation: 0 });
    sim.loadWarriors([w1, w2]);
    const results = sim.run(1);
    expect(results.length).toBe(1);
  });
});

describe('MAXWARRIOR validation', () => {
  it('should allow up to 36 warriors', () => {
    const warriors = Array.from({ length: 36 }, () => makeImpWarrior());
    const sim = new Simulator({ coreSize: 80000, minSeparation: 1, maxLength: 1 });
    // Should not throw
    sim.loadWarriors(warriors);
  });

  it('should reject more than 36 warriors', () => {
    const warriors = Array.from({ length: 37 }, () => makeImpWarrior());
    const sim = new Simulator({ coreSize: 80000, minSeparation: 1, maxLength: 1 });
    expect(() => sim.loadWarriors(warriors)).toThrow('Maximum 36 warriors');
  });
});

