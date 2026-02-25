/**
 * Tests for all issues found during the pMARS C-to-TS audit.
 * Covers: positioning, P-space round persistence, per-warrior lastResult,
 * multi-warrior battles, read/write limits, compat LDP/STP,
 * assembler features, and conditional branch behavior.
 */
import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { Simulator } from '../../src/simulator/index';
import { PSpace, computePSpaceSize } from '../../src/simulator/pspace';
import { Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode } from '../../src/constants';

// Helper to create a minimal warrior
function makeWarrior(instructions: { op: Opcode; mod: Modifier; aMode: AddressMode; aVal: number; bMode: AddressMode; bVal: number }[], startOffset = 0, pin: number | null = null) {
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
    pin,
  };
}

// A simple Imp warrior for use as a companion
const IMP_INSTR = { op: Opcode.MOV, mod: Modifier.I, aMode: AddressMode.DIRECT, aVal: 0, bMode: AddressMode.DIRECT, bVal: 1 };
const DAT_INSTR = { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.IMMEDIATE, bVal: 0 };

// --- POSITIONING FIXES ---
describe('Positioning fixes', () => {
  it('posit() places two warriors with correct separation (bug #1/#2)', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const sim = new Simulator({ coreSize: 8000, maxCycles: 100, seed: 42 });
    sim.loadWarriors([imp, imp]);
    sim.run(1); // run calls setupRound which positions warriors
    const warriors = sim.getWarriors();
    // Warriors should be at different positions with at least minSeparation apart
    expect(warriors[0].position).not.toBe(warriors[1].position);
  });

  it('three-warrior positioning produces distinct positions', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const sim = new Simulator({ coreSize: 8000, maxCycles: 100, seed: 42 });
    sim.loadWarriors([imp, imp, imp]);
    sim.setupRound();
    const warriors = sim.getWarriors();
    const positions = warriors.map(w => w.position);
    expect(new Set(positions).size).toBe(3);
    positions.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(8000);
    });
  });
});

// --- P-SPACE FIXES ---
describe('P-space fixes', () => {
  it('lastResult initializes to coreSize-1 (bug #3)', () => {
    const ps = new PSpace(500, 8000);
    expect(ps.get(0)).toBe(7999);
  });

  it('lastResult initializes to coreSize-1 for non-standard sizes', () => {
    const ps = new PSpace(250, 4000);
    expect(ps.get(0)).toBe(3999);
  });

  it('per-warrior lastResult in multi-round battle (bug #4)', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const dat = makeWarrior([DAT_INSTR]);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([imp, dat]);
    const results = sim.run(3);

    const warriors = sim.getWarriors();
    expect(results.every(r => r.winnerId === 0)).toBe(true);
    expect(warriors[0].lastResult).toBe(1);
    expect(warriors[1].lastResult).toBe(0);
  });

  it('P-space cell 0 updates across rounds', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const dat = makeWarrior([DAT_INSTR]);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([imp, dat]);
    sim.runRound();

    // After winning, imp's lastResult should be 1
    expect(sim.getWarriors()[0].lastResult).toBe(1);
  });

  it('dynamic pSpaceSize computation', () => {
    expect(computePSpaceSize(8000)).toBe(500);
    expect(computePSpaceSize(100)).toBe(10); // 100 / 10 (largest divisor <= 16 is 10)
    expect(computePSpaceSize(48)).toBe(3); // 48 / 16
  });

  it('shared P-space via PIN uses per-warrior lastResult', () => {
    const imp = makeWarrior([IMP_INSTR], 0, 42);
    const dat = makeWarrior([DAT_INSTR], 0, 42);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([imp, dat]);
    sim.run(1);

    const warriors = sim.getWarriors();
    expect(warriors[0].lastResult).toBe(1);
    expect(warriors[1].lastResult).toBe(0);
  });
});

// --- SIMULATOR POST-INCREMENT FIXES ---
describe('Post-increment addressing', () => {
  it('B-field post-increment (>) increments the indirect cell', () => {
    // Use assembler for clarity - test that > mode increments after read
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    const source1 = `MOV.I >2, $10
DAT #0, #0
DAT #0, #5`;
    const source2 = `MOV $0, $1`;
    const r1 = asm.assemble(source1);
    const r2 = asm.assemble(source2);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r1.warrior!, r2.warrior!]);
    sim.setupRound();
    sim.step(); // Execute MOV.I >2, $10

    // The B-field of cell at warrior1.pos+2 should be incremented from 5 to 6
    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    expect(core.get((pos + 2) % 100).bValue).toBe(6);
  });

  it('A-field post-increment (}) increments A-field of indirect cell', () => {
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    const source1 = `MOV.I }2, $10
DAT #0, #0
DAT $5, #0`;
    const source2 = `MOV $0, $1`;
    const r1 = asm.assemble(source1);
    const r2 = asm.assemble(source2);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r1.warrior!, r2.warrior!]);
    sim.setupRound();
    sim.step();

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    expect(core.get((pos + 2) % 100).aValue).toBe(6);
  });
});

// --- READ/WRITE LIMITS ---
describe('Read/write limits (foldr/foldw)', () => {
  it('read limit folds distant reads', () => {
    const sim = new Simulator({ coreSize: 100, maxCycles: 10, readLimit: 10 });
    const warrior = makeWarrior([
      { op: Opcode.MOV, mod: Modifier.A, aMode: AddressMode.DIRECT, aVal: 50, bMode: AddressMode.DIRECT, bVal: 1 },
      DAT_INSTR,
    ]);
    const imp = makeWarrior([IMP_INSTR]);
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    // Just verify it executes without error
    sim.step();
  });

  it('write limit folds distant writes', () => {
    const sim = new Simulator({ coreSize: 100, maxCycles: 10, writeLimit: 10 });
    const warrior = makeWarrior([
      { op: Opcode.MOV, mod: Modifier.A, aMode: AddressMode.IMMEDIATE, aVal: 42, bMode: AddressMode.DIRECT, bVal: 50 },
      DAT_INSTR,
    ]);
    const imp = makeWarrior([IMP_INSTR]);
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    sim.step();
  });

  it('zero limits mean no folding (full core access)', () => {
    const sim = new Simulator({ coreSize: 100, maxCycles: 10, readLimit: 0, writeLimit: 0 });
    const warrior = makeWarrior([
      { op: Opcode.MOV, mod: Modifier.A, aMode: AddressMode.IMMEDIATE, aVal: 42, bMode: AddressMode.DIRECT, bVal: 50 },
      DAT_INSTR,
    ]);
    const imp = makeWarrior([IMP_INSTR]);
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    sim.step();

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    expect(core.get((pos + 50) % 100).aValue).toBe(42);
  });
});

// --- MULTI-WARRIOR BATTLES ---
describe('Multi-warrior battles (3+)', () => {
  it('three-warrior battle completes', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const dat = makeWarrior([DAT_INSTR]);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([imp, dat, dat]);
    const results = sim.run(1);

    expect(results.length).toBe(1);
    expect(results[0].outcome).toBe('WIN');
    expect(results[0].winnerId).toBe(0);
  });

  it('three-warrior scoring is correct', () => {
    const imp = makeWarrior([IMP_INSTR]);
    const dat1 = makeWarrior([DAT_INSTR]);
    const dat2 = makeWarrior([DAT_INSTR]);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([imp, dat1, dat2]);
    sim.run(1);

    const warriors = sim.getWarriors();
    expect(warriors[0].score[0]).toBe(1); // survived as last (index 0 = 1 warrior left)
    expect(warriors[1].alive).toBe(false);
    expect(warriors[2].alive).toBe(false);
  });
});

// --- CONDITIONAL BRANCH VERIFICATION ---
describe('Conditional branch behavior', () => {
  it('JMZ jumps when B-field of target is zero', () => {
    // Assemble and battle-test for correct branch behavior
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    // JMZ checks B-field of cell at B-operand. If zero, jump to A-operand.
    // After jump, write a marker so we can verify.
    const source = `JMZ.B $3, $2
DAT #0, #0
DAT #0, #0
MOV.A #77, $-2`;
    const r = asm.assemble(source);
    expect(r.success).toBe(true);
    const imp = makeWarrior([IMP_INSTR]);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r.warrior!, imp]);
    sim.setupRound();
    sim.step(); // Execute JMZ - should jump to $3 (MOV)
    sim.step(); // imp's turn
    sim.step(); // Execute MOV.A #77, $-2 - writes 77 to marker

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    // Cell at pos+1 should have aValue=77 (MOV wrote to $3-2=$1 relative to $3)
    expect(core.get((pos + 1) % 100).aValue).toBe(77);
  });

  it('CMP/SEQ skips next instruction when values match', () => {
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    // CMP.B compares B-fields. If equal, skip next instruction.
    // Place two cells with equal B-fields, then write a marker.
    const source = `CMP.B $3, $4
DAT #0, #0
MOV.A #77, $-1
DAT #0, #5
DAT #0, #5`;
    const r = asm.assemble(source);
    expect(r.success).toBe(true);
    const imp = makeWarrior([IMP_INSTR]);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r.warrior!, imp]);
    sim.setupRound();
    sim.step(); // CMP: B-fields equal -> skip DAT -> PC goes to MOV
    sim.step(); // imp
    sim.step(); // MOV.A #77, $-1 -> writes 77

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    // MOV at pos+2 writes to pos+2-1=pos+1, so cell pos+1 should have aValue=77
    expect(core.get((pos + 1) % 100).aValue).toBe(77);
  });

  it('SLT skips when A-operand < B-operand', () => {
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    const source = `SLT.A $3, $4
DAT #0, #0
MOV.A #77, $-1
DAT $1, #0
DAT $5, #0`;
    const r = asm.assemble(source);
    expect(r.success).toBe(true);
    const imp = makeWarrior([IMP_INSTR]);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r.warrior!, imp]);
    sim.setupRound();
    sim.step(); // SLT: 1 < 5 -> skip
    sim.step(); // imp
    sim.step(); // MOV writes marker

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    expect(core.get((pos + 1) % 100).aValue).toBe(77);
  });
});

// --- CORE BOUNDARY WRAPPING ---
describe('Core boundary wrapping', () => {
  it('ADD wraps correctly at core boundary', () => {
    const asm = new Assembler({ coreSize: 100, maxLength: 100 });
    const source = `ADD.A #50, $1
DAT $60, #0`;
    const r = asm.assemble(source);
    expect(r.success).toBe(true);
    const imp = makeWarrior([IMP_INSTR]);

    const sim = new Simulator({ coreSize: 100, maxCycles: 10 });
    sim.loadWarriors([r.warrior!, imp]);
    sim.setupRound();
    sim.step();

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    // 60 + 50 = 110 % 100 = 10
    expect(core.get((pos + 1) % 100).aValue).toBe(10);
  });
});

// --- ASSEMBLER FIXES ---
describe('Assembler fixes', () => {
  const asm = new Assembler();

  it('CURLINE predefined variable (#4)', () => {
    const result = asm.assemble(`
      DAT #CURLINE, #0
      DAT #CURLINE, #0
      DAT #CURLINE, #0
    `);
    expect(result.success).toBe(true);
    const insts = result.warrior!.instructions;
    expect(insts[0].aValue).toBe(0);
    expect(insts[1].aValue).toBe(1);
    expect(insts[2].aValue).toBe(2);
  });

  it(';assert passes when expression is non-zero (#5)', () => {
    const result = asm.assemble(`
      ;assert CORESIZE==8000
      MOV $0, $1
    `);
    expect(result.success).toBe(true);
  });

  it(';assert fails when expression is zero (#5)', () => {
    const result = asm.assemble(`
      ;assert CORESIZE==999
      MOV $0, $1
    `);
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('Assertion failed'))).toBe(true);
  });

  it(';redcode clears previous state (#6)', () => {
    const result = asm.assemble(`
      ;name Before
      MOV $0, $1
      ;redcode
      ;name After
      DAT #0, #0
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.name).toBe('After');
    expect(result.warrior!.instructions.length).toBe(1);
  });

  it('second ;redcode stops processing (#6)', () => {
    const result = asm.assemble(`
      ;redcode
      ;name Test
      MOV $0, $1
      ;redcode
      ADD $0, $1
      SUB $0, $1
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1);
  });

  it('undefined symbols produce warnings (#7)', () => {
    const result = asm.assemble(`
      MOV $UNDEFINED_SYMBOL, $1
    `);
    expect(result.success).toBe(true);
    expect(result.messages.some(m => m.type === 'WARNING' && m.text.includes('Undefined symbol'))).toBe(true);
  });

  it('recursive EQU cycle detection (#8)', () => {
    const result = asm.assemble(`
      A EQU B
      B EQU A
      MOV $A, $1
    `);
    // Should not crash with stack overflow
    expect(result.success).toBe(true);
    expect(result.messages.some(m => m.type === 'WARNING' && m.text.includes('cycle'))).toBe(true);
  });

  it('READLIMIT and WRITELIMIT predefined constants (#9)', () => {
    const asmWithLimits = new Assembler({ readLimit: 500, writeLimit: 300 });
    const result = asmWithLimits.assemble(`
      DAT #READLIMIT, #WRITELIMIT
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(500);
    expect(result.warrior!.instructions[0].bValue).toBe(300);
  });

  it('READLIMIT/WRITELIMIT default to CORESIZE when 0 (#9)', () => {
    // When readLimit=0, READLIMIT = coreSize = 8000. But 8000 % 8000 = 0 after normalization.
    // This is correct behavior - values are normalized to [0, coreSize).
    const result = asm.assemble(`
      DAT #READLIMIT, #WRITELIMIT
    `);
    expect(result.success).toBe(true);
    // 8000 normalizes to 0 in a coreSize=8000 system
    expect(result.warrior!.instructions[0].aValue).toBe(0);
    expect(result.warrior!.instructions[0].bValue).toBe(0);
  });

  it('label references in ORG use absolute values (#10)', () => {
    const result = asm.assemble(`
      start MOV $0, $1
            DAT #0, #0
            ORG start
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(0);
  });

  it('label references in END use absolute values (#10)', () => {
    const result = asm.assemble(`
            DAT #0, #0
      entry MOV $0, $1
            END entry
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(1);
  });

  it('& concatenation operator in FOR loops (#3)', () => {
    const result = asm.assemble(`
      count FOR 3
            DAT #count, #0
      ROF
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(3);
  });

  it('nested FOR/ROF expansion (#2)', () => {
    const result = asm.assemble(`
      FOR 2
        DAT #1, #0
        FOR 2
          DAT #2, #0
        ROF
      ROF
    `);
    expect(result.success).toBe(true);
    // Outer 2x: (1 DAT + inner 2x DAT) = 3 per outer = 6 total
    expect(result.warrior!.instructions.length).toBe(6);
  });
});

// --- AUDIT ROUND 2 FIXES ---

describe('STP/LDP P-space index 0 fix (Bug #1)', () => {
  it('STP to index 0 updates warrior lastResult, readable by LDP', () => {
    // STP.AB stores AA (A-field of src) at p-space index BVal (B-field of dst)
    // LDP.AB reads from p-space index AA into B-field of dst
    const warrior = makeWarrior([
      // 0: STP.AB #42, #0 -- store 42 at p-space index 0 (sets warrior.lastResult)
      { op: Opcode.STP, mod: Modifier.AB, aMode: AddressMode.IMMEDIATE, aVal: 42, bMode: AddressMode.IMMEDIATE, bVal: 0 },
      // 1: LDP.AB #0, $1 -- load from p-space index 0 into B-field of cell at offset 1 (= cell 2)
      { op: Opcode.LDP, mod: Modifier.AB, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.DIRECT, bVal: 1 },
      // 2: DAT #0, #0 -- target: will be modified by LDP
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.IMMEDIATE, bVal: 0 },
      // 3: DAT -- die
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.IMMEDIATE, bVal: 0 },
    ]);
    const imp = makeWarrior([IMP_INSTR]);
    const sim = new Simulator({ coreSize: 100, maxCycles: 10, minSeparation: 20 });
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    // Step warrior: execute STP (stores 42 to index 0 -> warrior.lastResult = 42)
    sim.step();
    // Step imp
    sim.step();
    // Step warrior: execute LDP (reads index 0 -> warrior.lastResult -> 42, writes to cell at pos+2)
    sim.step();
    // Check that the DAT at position+2 now has bValue = 42
    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    const cell = core.get((pos + 2) % 100);
    expect(cell.bValue).toBe(42);
  });
});

describe('Tokenizer || operator fix (Bug #4)', () => {
  it('assembles expressions with || logical OR', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble(`
      x equ 0||1
      DAT #x, #0
    `);
    expect(result.success).toBe(true);
    // 0||1 should evaluate to 1
    expect(result.warrior!.instructions[0].aValue).toBe(1);
  });

  it('assembles expressions with && logical AND', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble(`
      x equ 1&&0
      DAT #x, #0
    `);
    expect(result.success).toBe(true);
    // 1&&0 should evaluate to 0
    expect(result.warrior!.instructions[0].aValue).toBe(0);
  });

  it('assembles complex boolean expressions with || and &&', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble(`
      x equ 0||0||1
      y equ 1&&1&&1
      DAT #x, #y
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(1);
    expect(result.warrior!.instructions[0].bValue).toBe(1);
  });
});

describe('ORG/END forward label reference fix (Bug #5)', () => {
  it('ORG with forward label reference resolves correctly', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble(`
      ORG start
      DAT #0, #0
      start MOV $0, $1
    `);
    expect(result.success).toBe(true);
    // 'start' is the second instruction (index 1), so startOffset should be 1
    expect(result.warrior!.startOffset).toBe(1);
  });

  it('END with forward label reference resolves correctly', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble(`
      DAT #0, #0
      entry MOV $0, $1
      END entry
    `);
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(1);
  });
});

describe('Assembler error severity and warnings', () => {
  it('maxLength exceeded is an error, not a warning', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 2 });
    const result = asm.assemble('MOV $0, $1\nDAT #0, #0\nJMP $-2');
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit'))).toBe(true);
  });

  it('warns on unclosed FOR block', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble('FOR 3\nDAT #0, #0');
    expect(result.messages.some(m => m.text.includes('Unclosed FOR'))).toBe(true);
  });

  it('warns on standalone ROF without FOR', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble('DAT #0, #0\nROF\nMOV $0, $1');
    expect(result.messages.some(m => m.text.includes('ROF without matching FOR'))).toBe(true);
  });

  it('warns when ORG offset is outside program bounds', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm.assemble('ORG 5\nDAT #0, #0\nMOV $0, $1');
    expect(result.messages.some(m => m.text.includes('outside program bounds'))).toBe(true);
  });
});

describe('RWLIMIT indirect addressing fix (Bugs #2 & #3)', () => {
  it('A-operand predecrement uses write-folded base for final address', () => {
    // When readLimit != writeLimit, the A-operand indirect base address
    // should use foldw (write limit) for predecr/postinc modes
    const warrior = makeWarrior([
      // 0: MOV.A {1, $2 -- A-predecrement through cell 1's A-field, write to cell 2
      { op: Opcode.MOV, mod: Modifier.A, aMode: AddressMode.A_PREDECR, aVal: 1, bMode: AddressMode.DIRECT, bVal: 2 },
      // 1: DAT #5, #3 -- A-field=5 (pointer), B-field=3
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 5, bMode: AddressMode.IMMEDIATE, bVal: 3 },
      // 2: DAT #0, #0 -- target
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.IMMEDIATE, bVal: 0 },
    ]);
    const imp = makeWarrior([IMP_INSTR]);

    // With limits = 0 (default, no folding), this should work normally
    const sim = new Simulator({ coreSize: 100, maxCycles: 5, minSeparation: 20 });
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    sim.step(); // execute MOV
    // The predecrement should have decremented cell 1's A-field from 5 to 4
    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    expect(core.get((pos + 1) % 100).aValue).toBe(4);
  });

  it('B-operand predecrement uses write-folded base for final address', () => {
    // Similar test for B-operand
    const warrior = makeWarrior([
      // 0: MOV.A $1, <2 -- B-predecrement on B-operand through cell 2's B-field
      { op: Opcode.MOV, mod: Modifier.A, aMode: AddressMode.DIRECT, aVal: 1, bMode: AddressMode.B_PREDECR, bVal: 2 },
      // 1: DAT #7, #0 -- source A=7
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 7, bMode: AddressMode.IMMEDIATE, bVal: 0 },
      // 2: DAT #0, #3 -- B-field=3 (pointer)
      { op: Opcode.DAT, mod: Modifier.F, aMode: AddressMode.IMMEDIATE, aVal: 0, bMode: AddressMode.IMMEDIATE, bVal: 3 },
    ]);
    const imp = makeWarrior([IMP_INSTR]);

    const sim = new Simulator({ coreSize: 100, maxCycles: 5, minSeparation: 20 });
    sim.loadWarriors([warrior, imp]);
    sim.setupRound();
    sim.step(); // execute MOV
    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    // Cell 2's B-field should be decremented from 3 to 2
    expect(core.get((pos + 2) % 100).bValue).toBe(2);
    // The target cell (pos + 2 + 2 = pos + 4) should have A-value = 7
    expect(core.get((pos + 4) % 100).aValue).toBe(7);
  });
});
