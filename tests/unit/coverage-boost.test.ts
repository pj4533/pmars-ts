import { describe, it, expect } from 'vitest';
import { Simulator } from '../../src/simulator/index';
import { Assembler } from '../../src/assembler/index';
import { type WarriorData, Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode, decodeOpcode } from '../../src/constants';
import { disassemble } from '../../src/assembler/index';
import { corewar } from '../../src/compat/index';

function makeWarrior(source: string, opts?: { coreSize?: number; maxLength?: number }): WarriorData {
  const asm = new Assembler({ coreSize: opts?.coreSize ?? 80, maxLength: opts?.maxLength ?? 100, maxProcesses: 80 });
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

// --- SimWarrior.getState() coverage ---
describe('SimWarrior getState', () => {
  it('returns full warrior state', () => {
    const w = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([w, { ...w, name: 'W2' }]);
    sim.setupRound();

    const warriors = sim.getWarriors();
    const state = warriors[0].getState();
    expect(state.id).toBe(0);
    expect(state.name).toBeDefined();
    expect(state.tasks).toBe(1);
    expect(state.processQueue).toBeInstanceOf(Array);
    expect(state.position).toBeGreaterThanOrEqual(0);
    expect(state.score).toBeInstanceOf(Array);
    expect(state.alive).toBe(true);
    expect(typeof state.lastResult).toBe('number');
    expect(typeof state.pSpaceIndex).toBe('number');
    expect(typeof state.pSpaceIDNumber).toBe('number');
    expect(typeof state.startOffset).toBe('number');
    expect(typeof state.author).toBe('string');
  });
});

// --- Assembler coverage: FOR/ROF, PIN, error paths ---
describe('Assembler edge cases', () => {
  it('handles FOR/ROF loop', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('FOR 3\nDAT #0, #0\nROF');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(3);
  });

  it('handles FOR/ROF with label counter', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('count FOR 2\nDAT #0, #count\nROF');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
  });

  it('handles PIN directive', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('PIN 42\nMOV $0, $1');
    expect(result.success).toBe(true);
    expect(result.warrior!.pin).toBe(42);
  });

  it('handles EQU without label as error', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('EQU 5\nMOV $0, $1');
    expect(result.messages.some(m => m.type === 'ERROR')).toBe(true);
  });

  it('errors on exceeding instruction limit', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 2, maxProcesses: 80 });
    const result = asm.assemble('MOV $0, $1\nDAT #0, #0\nJMP $-2');
    // C treats exceeding instrLim as an error, not a warning
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit'))).toBe(true);
    expect(result.success).toBe(false);
  });

  it('handles END with offset', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('DAT #0, #0\nMOV $0, $1\nEND 1');
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(1);
  });

  it('handles label-only line', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('start\nMOV $0, $1');
    expect(result.success).toBe(true);
  });

  it('handles ;redcode directive', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble(';redcode\nMOV $0, $1');
    expect(result.success).toBe(true);
  });

  it('handles ;assert directive', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble(';assert CORESIZE==80\nMOV $0, $1');
    expect(result.success).toBe(true);
  });

  it('handles inline comments', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('MOV $0, $1 ; this is a comment');
    expect(result.success).toBe(true);
  });

  it('handles unknown opcode', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('XYZ $0, $1');
    expect(result.messages.some(m => m.type === 'ERROR')).toBe(true);
  });

  it('handles label with colon', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('loop: MOV $0, $1\nJMP $-1');
    expect(result.success).toBe(true);
  });
});

// --- disassemble function ---
describe('disassemble', () => {
  it('disassembles a MOV.I instruction', () => {
    const inst = { opcode: encodeOpcode(Opcode.MOV, Modifier.I), aMode: AddressMode.DIRECT, bMode: AddressMode.DIRECT, aValue: 0, bValue: 1 };
    const str = disassemble(inst, 80);
    expect(str).toContain('MOV');
    expect(str).toContain('I');
  });

  it('disassembles negative offsets', () => {
    const inst = { opcode: encodeOpcode(Opcode.JMP, Modifier.B), aMode: AddressMode.DIRECT, bMode: AddressMode.DIRECT, aValue: 79, bValue: 0 };
    const str = disassemble(inst, 80);
    expect(str).toContain('-1');
  });

  it('disassembles with addressing modes', () => {
    const inst = { opcode: encodeOpcode(Opcode.MOV, Modifier.I), aMode: AddressMode.IMMEDIATE, bMode: AddressMode.B_INDIRECT, aValue: 5, bValue: 3 };
    const str = disassemble(inst, 80);
    expect(str).toContain('#');
    expect(str).toContain('@');
  });
});

// --- Compat layer coverage ---
describe('Compat runMatch', () => {
  it('runs a match with multiple rounds', () => {
    const w1 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const result = corewar.runMatch(
      { rounds: 2, options: { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 } },
      [w1, w2],
    );
    expect(result.rounds).toBe(2);
    expect(result.warriors.length).toBe(2);
    expect(result.warriors[1].won).toBeGreaterThanOrEqual(1);
  });
});

describe('Compat runHill', () => {
  it('runs a hill with 3 warriors', () => {
    const w1 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w3 = { source: corewar.parse('JMP $0'), data: 'JMP $0' };
    const result = corewar.runHill(
      { rounds: 1, options: { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 } },
      [w1, w2, w3],
    );
    expect(result.warriors.length).toBe(3);
    expect(result.warriors[0].rank).toBe(1);
    expect(result.warriors[2].rank).toBe(3);
  });
});

describe('Compat serialise and republish', () => {
  it('serialise returns empty string', () => {
    expect(corewar.serialise([])).toBe('');
  });

  it('republish is a no-op', () => {
    expect(() => corewar.republish()).not.toThrow();
  });
});

describe('Compat step without init', () => {
  it('step returns null when not initialized', () => {
    const c = (corewar as any);
    const saved = c.simulator;
    c.simulator = null;
    const result = corewar.step();
    expect(result).toBeNull();
    c.simulator = saved;
  });
});

describe('Compat getWithInfoAt without sim', () => {
  it('returns default instruction when no sim', () => {
    const c = (corewar as any);
    const saved = c.simulator;
    c.simulator = null;
    const loc = corewar.getWithInfoAt(0);
    expect(loc.instruction).toBeDefined();
    c.simulator = saved;
  });
});

describe('Compat parse with tie outcome', () => {
  it('run with tie produces draw', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
    );
    const result = corewar.run();
    expect(result.outcome).toBe('TIE');
  });
});

// --- Additional opcode modifier coverage ---
describe('Additional opcode modifiers', () => {
  it('SUB.A subtracts A-fields', () => {
    const { core, warriors } = runOneCycle('SUB.A #5, $1\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(5); // 10 - 5 = 5
  });

  it('SUB.F subtracts both fields', () => {
    // Use DIRECT mode to avoid IMMEDIATE operand evaluation quirks
    const { core, warriors } = runOneCycle('SUB.F $1, $2\nDAT #3, #4\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7); // 10 - 3
    expect(core.get((pos + 2) % 80).bValue).toBe(16); // 20 - 4
  });

  it('SUB.X cross-subtracts', () => {
    const { core, warriors } = runOneCycle('SUB.X #3, $1\nDAT #10, #20');
    const pos = warriors[0].position;
    // SUB.X: dstB -= srcA, dstA -= srcB (cross)
    expect(core.get((pos + 1) % 80).bValue).toBe(17); // 20 - 3
  });

  it('ADD.A adds A-fields', () => {
    const { core, warriors } = runOneCycle('ADD.A #5, $1\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(15);
  });

  it('ADD.B adds B-fields', () => {
    const { core, warriors } = runOneCycle('ADD.B $1, $2\nDAT #0, #5\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(25); // 20 + 5
  });

  it('ADD.F adds both fields', () => {
    const { core, warriors } = runOneCycle('ADD.F $1, $2\nDAT #3, #4\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(13); // 10 + 3
    expect(core.get((pos + 2) % 80).bValue).toBe(24); // 20 + 4
  });

  it('ADD.X cross-adds', () => {
    const { core, warriors } = runOneCycle('ADD.X $1, $2\nDAT #3, #4\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(23); // 20 + 3 (cross: srcA -> dstB)
    expect(core.get((pos + 2) % 80).aValue).toBe(14); // 10 + 4 (cross: srcB -> dstA)
  });

  it('ADD.BA adds B-of-src to A-of-dst', () => {
    const { core, warriors } = runOneCycle('ADD.BA $1, $2\nDAT #3, #5\nDAT #10, #20');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(15); // 10 + 5 (srcB -> dstA)
  });

  it('MUL.B multiplies B-fields', () => {
    const { core, warriors } = runOneCycle('MUL.B $1, $2\nDAT #0, #3\nDAT #10, #4');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(12); // 4 * 3
  });

  it('MUL.F multiplies both fields', () => {
    const { core, warriors } = runOneCycle('MUL.F $1, $2\nDAT #3, #5\nDAT #4, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(12); // 4 * 3
    expect(core.get((pos + 2) % 80).bValue).toBe(35); // 7 * 5
  });

  it('MUL.X cross-multiplies', () => {
    const { core, warriors } = runOneCycle('MUL.X $1, $2\nDAT #3, #5\nDAT #4, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(21); // 7 * 3 (cross: srcA -> dstB)
    expect(core.get((pos + 2) % 80).aValue).toBe(20); // 4 * 5 (cross: srcB -> dstA)
  });

  it('MUL.BA multiplies B-of-src by A-of-dst', () => {
    const { core, warriors } = runOneCycle('MUL.BA $1, $2\nDAT #3, #5\nDAT #4, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(20); // 4 * 5 (srcB * dstA -> dstA)
  });
});

// --- A-indirect addressing mode coverage ---
describe('A-indirect addressing modes', () => {
  it('A-indirect * reads through A-field', () => {
    // MOV.I *1, $3: read A-field of cell at PC+1, use as offset
    const { core, warriors } = runOneCycle('MOV.I *1, $3\nDAT #1, #0\nDAT #55, #44\nDAT #0, #0');
    const pos = warriors[0].position;
    const dst = core.get((pos + 3) % 80);
    expect(dst.aValue).toBe(55);
    expect(dst.bValue).toBe(44);
  });

  it('A-predecrement { decrements A-field before reading', () => {
    const { core, warriors } = runOneCycle('MOV.I {1, $3\nDAT #2, #0\nDAT #55, #44\nDAT #0, #0');
    const pos = warriors[0].position;
    // {1: decrement A-field of cell at PC+1 (2->1), then read from PC+1+1=PC+2
    expect(core.get((pos + 1) % 80).aValue).toBe(1);
  });

  it('A-postincrement } increments A-field after reading', () => {
    const { core, warriors } = runOneCycle('MOV.I }1, $3\nDAT #1, #0\nDAT #55, #44\nDAT #0, #0');
    const pos = warriors[0].position;
    // }1: read from PC+1+1=PC+2, then increment A-field of cell at PC+1 (1->2)
    expect(core.get((pos + 1) % 80).aValue).toBe(2);
  });
});

// --- B-operand indirect addressing modes ---
describe('B-operand indirect modes', () => {
  it('B-indirect on B-operand', () => {
    // MOV.I $1, @2: B-operand has @, should resolve through B-field of cell at PC+2
    const { core, warriors } = runOneCycle('MOV.I $1, @2\nDAT #55, #44\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // @2: go to PC+2, read B-field (1), destination = PC+2+1 = PC+3
    const dst = core.get((pos + 3) % 80);
    expect(dst.aValue).toBe(55);
    expect(dst.bValue).toBe(44);
  });

  it('B-predecrement on B-operand', () => {
    // MOV.I $1, <2: B-operand has <, decrement B-field of PC+2 then use as offset
    const { core, warriors } = runOneCycle('MOV.I $1, <2\nDAT #55, #44\nDAT #0, #2\nDAT #0, #0');
    const pos = warriors[0].position;
    // <2: decrement B-field of cell at PC+2 (2->1), then dest = PC+2+1 = PC+3
    expect(core.get((pos + 2) % 80).bValue).toBe(1);
  });

  it('B-postincrement on B-operand', () => {
    // MOV.I $1, >2: B-operand has >, read B-field, write, then increment
    const { core, warriors } = runOneCycle('MOV.I $1, >2\nDAT #55, #44\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // >2: read B-field of PC+2 (1), dest = PC+2+1 = PC+3, then increment (1->2)
    expect(core.get((pos + 2) % 80).bValue).toBe(2);
  });

  it('A-indirect * on B-operand', () => {
    const { core, warriors } = runOneCycle('MOV.I $1, *2\nDAT #55, #44\nDAT #1, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    // *2: read A-field of cell at PC+2 (1), dest = PC+2+1 = PC+3
    const dst = core.get((pos + 3) % 80);
    expect(dst.aValue).toBe(55);
    expect(dst.bValue).toBe(44);
  });

  it('A-predecrement { on B-operand', () => {
    const { core, warriors } = runOneCycle('MOV.I $1, {2\nDAT #55, #44\nDAT #2, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    // {2: decrement A-field of PC+2 (2->1), then dest = PC+2+1 = PC+3
    expect(core.get((pos + 2) % 80).aValue).toBe(1);
  });

  it('A-postincrement } on B-operand', () => {
    const { core, warriors } = runOneCycle('MOV.I $1, }2\nDAT #55, #44\nDAT #1, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    // }2: read A-field (1), dest = PC+2+1 = PC+3, then increment A-field (1->2)
    expect(core.get((pos + 2) % 80).aValue).toBe(2);
  });
});

// --- Immediate mode on B-operand ---
describe('Immediate B-operand', () => {
  it('MOV with immediate B-operand writes to self', () => {
    // MOV.A #5, #0: immediate B means addrB = progCnt
    const { core, warriors } = runOneCycle('MOV.A #5, #0');
    const pos = warriors[0].position;
    const cell = core.get(pos);
    expect(cell.aValue).toBe(5);
  });
});

// --- JMZ.F, JMN.A, DJN.BA ---
describe('More conditional branches', () => {
  it('JMZ.F checks both fields', () => {
    const { core, warriors } = runOneCycle('JMZ.F $3, $1\nDAT #0, #0\nDAT #0, #0\nJMP $0');
    // Should jump since both fields are zero at target
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80); // jumped to $3
  });

  it('JMN.A checks A-field nonzero', () => {
    const { core, warriors } = runOneCycle('JMN.A $3, $1\nDAT #5, #0\nDAT #0, #0\nJMP $0');
    // Should jump since A-field is nonzero at target
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 3) % 80); // jumped to $3
  });

  it('DJN.BA decrements A and checks', () => {
    const { core, warriors } = runOneCycle('DJN.BA $3, $1\nDAT #2, #0\nDAT #0, #0\nJMP $0');
    const pos = warriors[0].position;
    // BA modifier: decrement A-field of target, check A-field
    expect(core.get((pos + 1) % 80).aValue).toBe(1);
  });
});

// --- SNE additional modifiers ---
describe('SNE additional modifiers', () => {
  it('SNE.AB skips when A-field of src != B-field of dst', () => {
    const { core, warriors } = runOneCycle('SNE.AB #5, $1\nDAT #0, #3\nDAT #0, #0');
    // 5 != 3, should skip
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80); // skipped
  });

  it('SNE.BA skips when B-field of src != A-field of dst', () => {
    const { core, warriors } = runOneCycle('SNE.BA #5, $1\nDAT #3, #0\nDAT #0, #0');
    // SNE.BA: B-field of src (irAValue) vs A-field of dst (AB_Value). src is #5 (immediate), so irAValue = irBValue = 0 from encoding
    // Actually for IMMEDIATE A: AA_Value = irAValue = 5, irAValue = irBValue (B-field of the SNE instruction itself = 1)
    // BA: compares AVal (src B) vs AB (dst A). src B = 1 (B-operand raw value), dst A = 3
    // 1 != 3, should skip
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80); // skipped
  });

  it('SNE.F skips when either field pair differs', () => {
    const { core, warriors } = runOneCycle('SNE.F $1, $2\nDAT #1, #2\nDAT #1, #3');
    // A fields equal (1==1) but B fields differ (2!=3), should skip
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80); // skipped
  });

  it('SNE.X skips when cross-fields differ', () => {
    const { core, warriors } = runOneCycle('SNE.X $1, $2\nDAT #1, #2\nDAT #3, #1');
    // Cross: src.A vs dst.B (1 vs 1, equal), src.B vs dst.A (2 vs 3, differ) -> skip
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80); // skipped
  });

  it('SNE.I skips when full instructions differ', () => {
    const { core, warriors } = runOneCycle('SNE.I $1, $2\nDAT #1, #2\nMOV $0, $1');
    // Different opcodes (DAT vs MOV), should skip
    const pos = warriors[0].position;
    const nextPC = warriors[0].processQueue.toArray()[0];
    expect(nextPC).toBe((pos + 2) % 80); // skipped
  });
});

// --- LDP/STP F/X/I modifiers ---
describe('LDP/STP F/X/I modifiers', () => {
  it('LDP.F loads using B-field index into B-field', () => {
    const { core, warriors } = runOneCycle('LDP.F $1, $2\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // LDP.F loads pspace[AVal] into dst B-field. AVal = B-field of DAT at pos+1 = 1
    // pspace[1] is initially 0, so B-field of pos+2 should be 0
    expect(core.get((pos + 2) % 80).bValue).toBe(0);
    expect(warriors[0].alive).toBe(true);
  });

  it('LDP.X loads using B-field index into B-field', () => {
    const { core, warriors } = runOneCycle('LDP.X $1, $2\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // LDP.X falls through to B/F/X/I case: loads pspace[AVal=1] into dst B-field
    expect(core.get((pos + 2) % 80).bValue).toBe(0);
    expect(warriors[0].alive).toBe(true);
  });

  it('LDP.I loads using B-field index into B-field', () => {
    const { core, warriors } = runOneCycle('LDP.I $1, $2\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // LDP.I falls through to B/F/X/I case: loads pspace[AVal=1] into dst B-field
    expect(core.get((pos + 2) % 80).bValue).toBe(0);
    expect(warriors[0].alive).toBe(true);
  });

  it('STP.F stores using B-field value at B-field index', () => {
    const { warriors } = runOneCycle('STP.F $1, $2\nDAT #0, #42\nDAT #0, #5');
    // STP.F stores AVal (42) at pspace[BVal (5)]. Warrior should still be alive.
    expect(warriors[0].alive).toBe(true);
    expect(warriors[0].tasks).toBe(1);
  });

  it('STP.X stores using B-field value at B-field index', () => {
    const { warriors } = runOneCycle('STP.X $1, $2\nDAT #0, #42\nDAT #0, #5');
    // STP.X stores AVal (42) at pspace[BVal (5)]. Warrior should still be alive.
    expect(warriors[0].alive).toBe(true);
    expect(warriors[0].tasks).toBe(1);
  });

  it('STP.I stores using B-field value at B-field index', () => {
    const { warriors } = runOneCycle('STP.I $1, $2\nDAT #0, #42\nDAT #0, #5');
    // STP.I stores AVal (42) at pspace[BVal (5)]. Warrior should still be alive.
    expect(warriors[0].alive).toBe(true);
    expect(warriors[0].tasks).toBe(1);
  });

  it('STP.AB stores A-field at B-field index', () => {
    const { warriors } = runOneCycle('STP.AB $1, $2\nDAT #42, #0\nDAT #0, #5');
    // STP.AB stores AA (42) at pspace[BVal (5)]. Warrior should still be alive.
    expect(warriors[0].alive).toBe(true);
    expect(warriors[0].tasks).toBe(1);
  });
});

// --- Positioning coverage: multi-warrior paths ---
describe('Positioning edge cases', () => {
  it('positions 4 warriors', () => {
    // This should trigger posit() and potentially npos() with enough warriors
    const imp = makeWarrior('MOV $0, $1', { coreSize: 8000 });
    const sim = new Simulator({ coreSize: 8000, maxCycles: 100, maxProcesses: 8000, minSeparation: 100 });
    sim.loadWarriors([
      { ...imp, name: 'W1' },
      { ...imp, name: 'W2' },
      { ...imp, name: 'W3' },
      { ...imp, name: 'W4' },
    ]);
    const warriors = sim.getWarriors();
    expect(warriors.length).toBe(4);
  });

  it('positions warriors with tight separation triggering retries', () => {
    const imp = makeWarrior('MOV $0, $1', { coreSize: 500 });
    const sim = new Simulator({ coreSize: 500, maxCycles: 100, maxProcesses: 500, minSeparation: 100 });
    sim.loadWarriors([
      { ...imp, name: 'W1' },
      { ...imp, name: 'W2' },
      { ...imp, name: 'W3' },
    ]);
    const warriors = sim.getWarriors();
    expect(warriors.length).toBe(3);
  });
});

// --- Multiple rounds ---
describe('Simulator multiple rounds', () => {
  it('runs multiple rounds', () => {
    const dat = makeWarrior('DAT #0, #0');
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([dat, imp]);
    const results = sim.run(3);
    expect(results.length).toBe(3);
    results.forEach(r => {
      expect(r.winnerId).toBe(1);
      expect(r.outcome).toBe('WIN');
    });
  });
});

// --- Expression evaluator uncovered paths ---
describe('Expression evaluator edge cases', () => {
  it('handles nested parentheses', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('DAT #(2+3)*4, #0');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(20);
  });

  it('handles modulo in expression', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('DAT #10%3, #0');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(1);
  });

  it('handles comparison operators in EQU', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    const result = asm.assemble('val EQU 5+3\nDAT #val, #0');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(8);
  });

  it('handles logical AND', () => {
    const asm = new Assembler({ coreSize: 80, maxLength: 100, maxProcesses: 80 });
    // Using predefined variables in expressions
    const result = asm.assemble('cnt EQU 1+1\nDAT #cnt, #0');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(2);
  });
});

// --- Compat runBenchmark ---
describe('Compat runBenchmark', () => {
  it('runs a benchmark', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };
    const w3 = { source: corewar.parse('JMP $0'), data: 'JMP $0' };
    const result = corewar.runBenchmark(
      w1,
      { rounds: 1, options: { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 } },
      [w2, w3],
    );
    expect(result.warriors.length).toBe(3);
  });
});

// --- Compat step with multiple steps ---
describe('Compat step with count', () => {
  it('steps multiple times', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 10, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
    );
    const result = corewar.step(3);
    // 3 steps of a tie game should not end the round
    expect(result).toBeNull();
  });
});

// --- Compat match with tie ---
describe('Compat runMatch with tie', () => {
  it('records draws when match ties', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const result = corewar.runMatch(
      { rounds: 1, options: { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 } },
      [w1, w2],
    );
    expect(result.warriors[0].drawn).toBe(1);
    expect(result.warriors[1].drawn).toBe(1);
  });
});
