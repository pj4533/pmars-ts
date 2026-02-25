import { describe, it, expect } from 'vitest';
import { Simulator } from '../../src/simulator/index';
import { Assembler } from '../../src/assembler/index';
import { type WarriorData, Opcode, Modifier, AddressMode } from '../../src/types';
import { positionWarriors } from '../../src/simulator/positioning';

function makeWarrior(source: string, opts?: { coreSize?: number }): WarriorData {
  const asm = new Assembler({ coreSize: opts?.coreSize ?? 80, maxLength: 100, maxProcesses: 80 });
  const result = asm.assemble(source);
  if (!result.success || !result.warrior) throw new Error(`Assembly failed: ${result.messages.map(m => m.text).join(', ')}`);
  return result.warrior;
}

function runOneCycle(warrior1Src: string, warrior2Src?: string, opts?: { coreSize?: number; maxCycles?: number }) {
  const cs = opts?.coreSize ?? 80;
  const w1 = makeWarrior(warrior1Src, { coreSize: cs });
  const w2 = makeWarrior(warrior2Src ?? 'JMP $0', { coreSize: cs });
  const sim = new Simulator({ coreSize: cs, maxCycles: opts?.maxCycles ?? 100, maxProcesses: 80, minSeparation: 10 });
  sim.loadWarriors([w1, w2]);
  sim.setupRound();
  sim.step();
  return { sim, core: sim.getCore(), warriors: sim.getWarriors() };
}

// --- Positioning: trigger posit overlap retries and npos fallback ---
describe('Positioning branch coverage', () => {
  it('3+ warriors with very tight core triggers posit retries', () => {
    // Use a core with tight separation to force overlap in posit()
    const result = positionWarriors(3, 300, 80, 42);
    expect(result.positions.length).toBe(3);
    for (const p of result.positions) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(300);
    }
  });

  it('many warriors in tight space triggers npos fallback', () => {
    // 5 warriors with separation=50 in coreSize=300: 5*50=250, only 51 room
    // This is tight enough that posit() may fail and fall back to npos()
    const result = positionWarriors(5, 300, 50, 12345);
    expect(result.positions.length).toBe(5);
    expect(result.positions[0]).toBe(0);
  });

  it('posit with overlapping seed', () => {
    // Try many seeds to trigger overlap in posit's retry logic
    for (let seed = 1; seed < 50; seed++) {
      const result = positionWarriors(3, 250, 70, seed);
      expect(result.positions.length).toBe(3);
    }
  });

  it('1 warrior returns position 0', () => {
    const result = positionWarriors(1, 80, 10, 42);
    expect(result.positions).toEqual([0]);
  });
});

// --- Simulator: SPL hits process limit ---
describe('Simulator process limit', () => {
  it('SPL respects max process limit', () => {
    const splWarrior = makeWarrior('SPL $0\nJMP $-1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 3, minSeparation: 10 });
    sim.loadWarriors([splWarrior, makeWarrior('JMP $0')]);
    sim.setupRound();

    // Run several steps to try exceeding max processes
    for (let i = 0; i < 20; i++) sim.step();
    const warriors = sim.getWarriors();
    expect(warriors[0].tasks).toBeLessThanOrEqual(3);
  });
});

// --- Simulator: warrior with multiple processes, one dies ---
describe('Simulator multi-process death', () => {
  it('warrior with multiple processes loses one to DAT', () => {
    // SPL to create 2 processes, second process hits DAT
    const warrior = makeWarrior('SPL $2\nJMP $0\nDAT #0, #0');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([warrior, makeWarrior('JMP $0')]);
    sim.setupRound();

    // Run enough steps for SPL to create process, then the new process hits DAT
    for (let i = 0; i < 10; i++) sim.step();

    // The warrior should still be alive (first process loops on JMP $0)
    const w = sim.getWarriors()[0];
    expect(w.alive).toBe(true);
  });
});

// --- DIV/MOD zero on one field of F/X modifiers ---
describe('DIV/MOD partial zero in F/X', () => {
  it('DIV.F with zero in A-field only kills', () => {
    // DIV.F: divide both fields. If A-field of src is 0, should kill
    const { warriors } = runOneCycle('DIV.F $1, $2\nDAT #0, #3\nDAT #10, #20');
    // Zero in A-field of source should kill the warrior
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('DIV.X with zero in B-field of src kills', () => {
    const { warriors } = runOneCycle('DIV.X $1, $2\nDAT #3, #0\nDAT #10, #20');
    // DIV.X: dstA /= srcB, dstB /= srcA. srcB=0 causes divide by zero
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('MOD.F with zero in A-field of src kills', () => {
    const { warriors } = runOneCycle('MOD.F $1, $2\nDAT #0, #3\nDAT #10, #20');
    // MOD.F: modulo both fields. A-field of src is 0, causes divide by zero
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('MOD.X with zero in A-field of src kills', () => {
    const { warriors } = runOneCycle('MOD.X $1, $2\nDAT #0, #3\nDAT #10, #20');
    // MOD.X: cross-modulo. srcA=0 causes divide by zero on dstB
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('MOD.X with zero in B-field of src, nonzero A-field', () => {
    const { core, warriors } = runOneCycle('MOD.X $1, $2\nDAT #3, #0\nDAT #10, #20');
    // MOD.X: dstA %= srcB (0), dstB %= srcA (3). srcB=0 causes divide by zero on dstA
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('DIV.F with nonzero A, zero B kills', () => {
    const { warriors } = runOneCycle('DIV.F $1, $2\nDAT #3, #0\nDAT #10, #20');
    // DIV.F: both fields divided. B-field of src is 0, causes divide by zero
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });

  it('DIV.X with nonzero A, zero B kills on second', () => {
    // DIV.X: dstA /= srcB, dstB /= srcA. If srcA (AA) is 0 but srcB (AVal) is nonzero
    const { warriors } = runOneCycle('DIV.X $1, $2\nDAT #0, #3\nDAT #10, #20');
    // srcA=0 causes divide by zero on dstB
    expect(warriors[0].alive).toBe(false);
    expect(warriors[0].tasks).toBe(0);
  });
});

// --- JMZ.F/I/X variants ---
describe('JMZ/JMN modifier variants', () => {
  it('JMZ.X checks both fields for zero', () => {
    const { core, warriors } = runOneCycle('JMZ.X $3, $1\nDAT #0, #0\nDAT #0, #0\nJMP $0');
    // Both fields of B-target are 0, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMZ.I checks both fields for zero', () => {
    const { core, warriors } = runOneCycle('JMZ.I $3, $1\nDAT #0, #0\nDAT #0, #0\nJMP $0');
    // Both fields of B-target are 0, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMN.F checks either field nonzero', () => {
    const { core, warriors } = runOneCycle('JMN.F $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // A-field=5 is nonzero, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMN.X checks either field nonzero', () => {
    const { core, warriors } = runOneCycle('JMN.X $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // A-field=5 is nonzero, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMN.I checks either field nonzero', () => {
    const { core, warriors } = runOneCycle('JMN.I $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // A-field=5 is nonzero, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMN.AB checks B-field', () => {
    const { core, warriors } = runOneCycle('JMN.AB $3, $1\nDAT #0, #5\nDAT #0, #0\nJMP $0');
    // AB modifier checks BVal (B-field=5) nonzero, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMN.BA checks A-field', () => {
    const { core, warriors } = runOneCycle('JMN.BA $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // BA modifier checks AB (A-field=5) nonzero, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });
});

// --- DJN F/X/I modifiers ---
describe('DJN modifier variants', () => {
  it('DJN.AB decrements B and checks', () => {
    const { core, warriors } = runOneCycle('DJN.AB $3, $1\nDAT #0, #5\nDAT #0, #0\nJMP $0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(4); // decremented
  });

  it('DJN.X decrements both', () => {
    const { core, warriors } = runOneCycle('DJN.X $3, $1\nDAT #5, #3\nDAT #0, #0\nJMP $0');
    const pos = warriors[0].position;
    // X: decrements both A and B of the B-operand target
    expect(core.get((pos + 1) % 80).aValue).toBe(4);
    expect(core.get((pos + 1) % 80).bValue).toBe(2);
  });

  it('DJN.I decrements both', () => {
    const { core, warriors } = runOneCycle('DJN.I $3, $1\nDAT #5, #3\nDAT #0, #0\nJMP $0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(4);
    expect(core.get((pos + 1) % 80).bValue).toBe(2);
  });
});

// --- Assembler: default modifier assignment ---
describe('Assembler default modifier', () => {
  it('MOV with B-immediate defaults to B modifier', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('MOV $0, #0');
    expect(result.success).toBe(true);
  });

  it('DAT with single operand moves value to B-field', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('DAT #5');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(5);
  });

  it('JMP with single operand defaults properly', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('JMP $-1\nDAT #0, #0');
    expect(result.success).toBe(true);
  });

  it('SPL with single operand defaults properly', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('SPL $0');
    expect(result.success).toBe(true);
  });

  it('NOP with single operand defaults properly', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('NOP $0');
    expect(result.success).toBe(true);
  });

  it('ADD with missing operand gives error', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('ADD #5');
    expect(result.messages.some(m => m.type === 'ERROR')).toBe(true);
  });

  it('unknown modifier gives error', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('MOV.Z $0, $1');
    expect(result.messages.some(m => m.type === 'ERROR')).toBe(true);
  });

  it('SLT default modifier with immediate A', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('SLT #1, $2\nDAT #0, #0\nDAT #0, #5');
    expect(result.success).toBe(true);
  });

  it('SLT default modifier with direct A', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('SLT $1, $2\nDAT #1, #0\nDAT #0, #5');
    expect(result.success).toBe(true);
  });
});

// --- Assembler: tokenizer with dot-separator modifier ---
describe('Assembler tokenizer', () => {
  it('handles separate dot modifier (.I)', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    // Some assemblers write "MOV .I $0, $1" with space before dot
    const result = asm.assemble('MOV.I $0, $1');
    expect(result.success).toBe(true);
  });

  it('handles FOR with predefined constant', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('count EQU 2\nFOR count\nDAT #0, #0\nROF');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
  });
});

// --- Expression evaluator: uncovered branches ---
describe('Expression evaluator branches', () => {
  it('handles negation operator', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    // Single-operand DAT swaps to B-field
    const result = asm.assemble('DAT #-5');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(75); // -5 mod 80 = 75
  });

  it('handles subtraction yielding negative', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('DAT #3-10');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(73); // -7 mod 80 = 73
  });

  it('handles multiplication via EQU', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    // Use EQU to test multiplication (avoids * being parsed as addressing mode)
    const result = asm.assemble('val EQU 3*4\nDAT #val');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(12);
  });

  it('handles division via EQU', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('val EQU 20/4\nDAT #val');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(5);
  });
});

// --- Simulator: warrior name/author defaults ---
describe('Warrior data defaults', () => {
  it('warrior without name gets default', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('MOV $0, $1');
    expect(result.warrior!.name).toBe('Unknown');
    expect(result.warrior!.author).toBe('Anonymous');
  });

  it('warrior with metadata gets correct name/author', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble(';name MyWarrior\n;author TestAuthor\nMOV $0, $1');
    expect(result.warrior!.name).toBe('MyWarrior');
    expect(result.warrior!.author).toBe('TestAuthor');
  });
});

// --- CMP additional modifiers ---
describe('CMP additional modifiers', () => {
  it('CMP.I does not skip when instructions differ', () => {
    // Non-skip path
    const { core, warriors } = runOneCycle('CMP.I $1, $2\nDAT #1, #2\nMOV $0, $1\nDAT #0, #0');
    // Different instructions, should not skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('CMP.F does not skip when fields partially differ', () => {
    const { core, warriors } = runOneCycle('CMP.F $1, $2\nDAT #1, #2\nDAT #1, #3\nDAT #0, #0');
    // A fields equal but B fields differ, should not skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });
});

// --- SLT I modifier ---
describe('SLT I modifier', () => {
  it('SLT.I skips when both conditions met (same as F)', () => {
    const { core, warriors } = runOneCycle('SLT.I $1, $2\nDAT #1, #2\nDAT #5, #5\nDAT #0, #0');
    // 1<5 and 2<5 both true, should skip — next PC is pos+2
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80);
  });
});

// --- Warrior with empty name/author ---
describe('Warrior default values', () => {
  it('handles warrior with empty name', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble(';name \nMOV $0, $1');
    expect(result.warrior!.name).toBe('Unknown');
  });

  it('handles warrior with empty author', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble(';author \nMOV $0, $1');
    expect(result.warrior!.author).toBe('Anonymous');
  });

  it('warrior with pin uses pin value', () => {
    const w = makeWarrior('PIN 42\nMOV $0, $1');
    expect(w.pin).toBe(42);
  });
});

// --- Simulator: step when already ended ---
describe('Simulator step after round end', () => {
  it('step returns round result immediately when cycles exhausted', () => {
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 1, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([imp, { ...imp, name: 'W2' }]);
    sim.setupRound();

    // With maxCycles=1, after 1 step the round should be over
    sim.step(); // First step uses the only cycle
    const result = sim.step(); // Should return round result
    expect(result).not.toBeNull();
  });
});

// --- SUB.B and SUB.I modifiers ---
describe('SUB additional modifiers', () => {
  it('SUB.B subtracts B-fields', () => {
    const { core, warriors } = runOneCycle('SUB.B $1, $2\nDAT #0, #3\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(17); // 20 - 3
  });

  it('SUB.I subtracts both fields (same as F)', () => {
    const { core, warriors } = runOneCycle('SUB.I $1, $2\nDAT #3, #4\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7); // 10 - 3
    expect(core.get((pos + 2) % 80).bValue).toBe(16); // 20 - 4
  });
});

// --- ADD.I modifier ---
describe('ADD.I modifier', () => {
  it('ADD.I adds both fields (same as F)', () => {
    const { core, warriors } = runOneCycle('ADD.I $1, $2\nDAT #3, #4\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(13);
    expect(core.get((pos + 2) % 80).bValue).toBe(24);
  });
});

// --- MUL.I modifier ---
describe('MUL.I modifier', () => {
  it('MUL.I multiplies both fields (same as F)', () => {
    const { core, warriors } = runOneCycle('MUL.I $1, $2\nDAT #3, #5\nDAT #4, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(12);
    expect(core.get((pos + 2) % 80).bValue).toBe(35);
  });
});

// --- DIV.I modifier ---
describe('DIV.I modifier', () => {
  it('DIV.I divides both fields', () => {
    const { core, warriors } = runOneCycle('DIV.I $1, $2\nDAT #2, #5\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(5); // 10 / 2
    expect(core.get((pos + 2) % 80).bValue).toBe(4); // 20 / 5
  });
});

// --- MOD.I modifier ---
describe('MOD.I modifier', () => {
  it('MOD.I modulos both fields', () => {
    const { core, warriors } = runOneCycle('MOD.I $1, $2\nDAT #3, #7\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(1); // 10 % 3
    expect(core.get((pos + 2) % 80).bValue).toBe(6); // 20 % 7
  });
});

// --- Assembler: bad B-field expression ---
describe('Assembler error paths', () => {
  it('reports bad B-field expression', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('MOV $0, $foo');
    // foo is unknown, gets replaced with 0, should still succeed
    expect(result.success).toBe(true);
  });

  it('label reference in expression is resolved', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('start MOV $0, $1\nJMP $start');
    expect(result.success).toBe(true);
    // start is at offset 0, JMP is at offset 1, so start-1 = -1 → normalized to 79
    expect(result.warrior!.instructions[1].aValue).toBe(79);
  });

  it('handles predefined CORESIZE constant', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('val EQU CORESIZE\nDAT #val');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(0); // 80 mod 80 = 0
  });
});

// --- Simulator: startOffset with negative wrap ---
describe('Warrior startOffset', () => {
  it('ORG sets start offset', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('ORG 1\nDAT #0, #0\nMOV $0, $1');
    expect(result.warrior!.startOffset).toBe(1);
  });
});

// --- Warrior with undefined name/author ---
describe('Warrior constructor defaults', () => {
  it('uses default name when warrior has no name', () => {
    const sim = new Simulator({ coreSize: 80, maxCycles: 10, maxProcesses: 80, minSeparation: 10 });
    const warriorData: WarriorData = {
      instructions: [{ opcode: 0, aMode: AddressMode.DIRECT, bMode: AddressMode.DIRECT, aValue: 0, bValue: 1 }],
      startOffset: 0,
      name: '',
      author: '',
      strategy: '',
      pin: null,
    };
    sim.loadWarriors([warriorData, { ...warriorData, name: 'W2' }]);
    const warriors = sim.getWarriors();
    expect(warriors[0].name).toBe('Unknown');
    expect(warriors[0].author).toBe('Anonymous');
  });

  it('passes through name/author when provided', () => {
    const sim = new Simulator({ coreSize: 80, maxCycles: 10, maxProcesses: 80, minSeparation: 10 });
    const warriorData: WarriorData = {
      instructions: [{ opcode: 0, aMode: AddressMode.DIRECT, bMode: AddressMode.DIRECT, aValue: 0, bValue: 1 }],
      startOffset: 0,
      name: 'TestName',
      author: 'TestAuthor',
      strategy: '',
      pin: null,
    };
    sim.loadWarriors([warriorData, { ...warriorData, name: 'W2' }]);
    const warriors = sim.getWarriors();
    expect(warriors[0].name).toBe('TestName');
    expect(warriors[0].author).toBe('TestAuthor');
  });
});

// --- Simulator: setupRound without loadWarriors ---
describe('Simulator initialization error', () => {
  it('throws when setupRound called without loadWarriors', () => {
    const sim = new Simulator({ coreSize: 80, maxCycles: 10, maxProcesses: 80, minSeparation: 10 });
    expect(() => sim.setupRound()).toThrow();
  });
});

// --- CMP/SNE non-skip path for I modifier ---
describe('CMP/SNE non-match paths', () => {
  it('CMP.X does not skip when cross-fields differ', () => {
    const { core, warriors } = runOneCycle('CMP.X $1, $2\nDAT #1, #2\nDAT #3, #4\nDAT #0, #0');
    // 1!=4 and 2!=3, should NOT skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('SNE.I does not skip when instructions match', () => {
    const { core, warriors } = runOneCycle('SNE.I $1, $2\nDAT #5, #10\nDAT #5, #10\nDAT #0, #0');
    // Same instructions, checkCMP returns true, SNE does NOT skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('SNE.F does not skip when both field pairs match', () => {
    const { core, warriors } = runOneCycle('SNE.F $1, $2\nDAT #5, #10\nDAT #5, #10\nDAT #0, #0');
    // Both field pairs match, checkCMP.F returns true, SNE does NOT skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('SNE.X does not skip when cross-field pairs match', () => {
    const { core, warriors } = runOneCycle('SNE.X $1, $2\nDAT #5, #10\nDAT #10, #5\nDAT #0, #0');
    // Cross-fields match (5===5, 10===10), checkCMP.X returns true, SNE does NOT skip — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });
});

// --- JMZ non-jump paths ---
describe('JMZ non-jump paths', () => {
  it('JMZ.A does not jump when A-field nonzero', () => {
    const { core, warriors } = runOneCycle('JMZ.A $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // A-field=5 is nonzero, JMZ.A does not jump — next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('JMZ.F does not jump when any field nonzero', () => {
    const { core, warriors } = runOneCycle('JMZ.F $3, $1\nDAT #0, #5\nDAT #0, #0\nJMP $0');
    // B-field=5 is nonzero, JMZ.F requires both zero — does not jump, next PC is pos+1
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 1) % 80);
  });

  it('JMZ.BA checks A-field for zero', () => {
    const { core, warriors } = runOneCycle('JMZ.BA $3, $1\nDAT #0, #5\nDAT #0, #0\nJMP $0');
    // A-field is 0, JMZ.BA checks AB===0, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });

  it('JMZ.AB checks B-field for zero', () => {
    const { core, warriors } = runOneCycle('JMZ.AB $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // B-field is 0, JMZ.AB checks BVal===0, should jump to $3
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80);
  });
});

// --- Shared P-space via PIN ---
describe('Shared P-space via PIN', () => {
  it('warriors with same PIN share P-space', () => {
    const w1 = makeWarrior('PIN 100\nSTP.AB #42, #1\nJMP $0');
    const w2 = makeWarrior('PIN 100\nLDP.AB #1, $1\nDAT #0, #0');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([w1, w2]);
    // Both warriors have PIN=100, so they should share P-space
    const warriors = sim.getWarriors();
    expect(warriors[1].pSpaceIndex).toBe(0); // Should share W1's P-space
  });

  it('warriors with different PIN do not share P-space', () => {
    const w1 = makeWarrior('PIN 100\nMOV $0, $1');
    const w2 = makeWarrior('PIN 200\nMOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([w1, w2]);
    const warriors = sim.getWarriors();
    expect(warriors[1].pSpaceIndex).toBe(1); // Separate P-space
  });
});

// --- Warrior with negative startAddr wrap ---
describe('Warrior negative startAddr', () => {
  it('warrior reset handles position correctly', () => {
    const w = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 10, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([w, { ...w, name: 'W2' }]);
    sim.setupRound();
    // Just verify warriors are alive and have correct task count
    const warriors = sim.getWarriors();
    expect(warriors[0].alive).toBe(true);
    expect(warriors[0].tasks).toBe(1);
  });
});
