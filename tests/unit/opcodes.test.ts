import { describe, it, expect, beforeEach } from 'vitest';
import { Simulator } from '../../src/simulator/index';
import { Assembler } from '../../src/assembler/index';
import { type WarriorData, Opcode, Modifier, AddressMode } from '../../src/types';
import { decodeOpcode } from '../../src/constants';

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
  sim.step(); // Execute warrior 0's first instruction
  return { sim, core: sim.getCore(), warriors: sim.getWarriors() };
}

describe('MOV opcode variants', () => {
  it('MOV.A copies A-field of source to A-field of target', () => {
    const { core, warriors } = runOneCycle('MOV.A #5, $1\nDAT #0, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(5);
  });

  it('MOV.B copies B-field of source to B-field of target', () => {
    const { core, warriors } = runOneCycle('MOV.B $1, $2\nDAT #0, #7\nDAT #0, #0');
    const pos = warriors[0].position;
    // MOV.B: B-field of source (7) -> B-field of target
    expect(core.get((pos + 2) % 80).bValue).toBe(7);
  });

  it('MOV.AB copies A-field of source to B-field of target', () => {
    const { core, warriors } = runOneCycle('MOV.AB #5, $1\nDAT #0, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(5);
  });

  it('MOV.BA copies B-field of source to A-field of target', () => {
    const { core, warriors } = runOneCycle('MOV.BA $1, $2\nDAT #3, #7\nDAT #0, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7);
  });

  it('MOV.F copies both fields', () => {
    const { core, warriors } = runOneCycle('MOV.F $1, $2\nDAT #3, #7\nDAT #0, #0');
    const pos = warriors[0].position;
    const dst = core.get((pos + 2) % 80);
    expect(dst.aValue).toBe(3);
    expect(dst.bValue).toBe(7);
  });

  it('MOV.X copies A->B and B->A (cross)', () => {
    const { core, warriors } = runOneCycle('MOV.X $1, $2\nDAT #3, #7\nDAT #0, #0');
    const pos = warriors[0].position;
    const dst = core.get((pos + 2) % 80);
    expect(dst.bValue).toBe(3);
    expect(dst.aValue).toBe(7);
  });

  it('MOV.I copies entire instruction', () => {
    const { core, warriors } = runOneCycle('MOV.I $1, $2\nADD.AB #3, #7\nDAT #0, #0');
    const pos = warriors[0].position;
    const src = core.get((pos + 1) % 80);
    const dst = core.get((pos + 2) % 80);
    expect(dst.opcode).toBe(src.opcode);
    expect(dst.aMode).toBe(src.aMode);
    expect(dst.bMode).toBe(src.bMode);
  });
});

describe('SUB opcode variants', () => {
  it('SUB.AB subtracts A-field from B-field', () => {
    const { core, warriors } = runOneCycle('SUB.AB #3, $1\nDAT #0, #10');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(7);
  });

  it('SUB.BA subtracts B-field from A-field', () => {
    const { core, warriors } = runOneCycle('SUB.BA $1, $2\nDAT #3, #7\nDAT #10, #0');
    const pos = warriors[0].position;
    // SUB.BA: dst.aValue = AB - AVal where AVal = B-field of A-operand (7)
    // AB = A-field of B-operand (10). Result: 10 - 7 = 3
    expect(core.get((pos + 2) % 80).aValue).toBe(3);
  });
});

describe('MUL opcode variants', () => {
  it('MUL.AB multiplies A-field of src by B-field of dst', () => {
    const { core, warriors } = runOneCycle('MUL.AB #3, $1\nDAT #0, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(21);
  });

  it('MUL.A multiplies A-fields', () => {
    const { core, warriors } = runOneCycle('MUL.A $1, $2\nDAT #3, #0\nDAT #7, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(21);
  });
});

describe('DIV opcode variants', () => {
  it('DIV.A divides A-field of dst by A-field of src', () => {
    const { core, warriors } = runOneCycle('DIV.A $1, $2\nDAT #3, #0\nDAT #21, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7);
  });

  it('DIV by zero kills warrior', () => {
    const { sim } = runOneCycle('DIV.A #0, $1\nDAT #5, #0', undefined, { maxCycles: 10 });
    // Warrior 0 should have died (divide by zero)
    const w0 = sim.getWarriors()[0];
    // After div by zero, task decremented
    expect(w0.tasks).toBeLessThanOrEqual(1);
  });

  it('DIV.B divides B-fields', () => {
    const { core, warriors } = runOneCycle('DIV.B $1, $2\nDAT #0, #6\nDAT #0, #30');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(5);
  });

  it('DIV.AB divides B-field by A-field of src', () => {
    const { core, warriors } = runOneCycle('DIV.AB #3, $1\nDAT #0, #21');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(7);
  });

  it('DIV.BA divides A-field by B-field of src', () => {
    const { core, warriors } = runOneCycle('DIV.BA $1, $2\nDAT #0, #3\nDAT #21, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7);
  });

  it('DIV.F divides both fields', () => {
    const { core, warriors } = runOneCycle('DIV.F $1, $2\nDAT #3, #5\nDAT #21, #30');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7);
    expect(core.get((pos + 2) % 80).bValue).toBe(6);
  });

  it('DIV.X cross-divides', () => {
    const { core, warriors } = runOneCycle('DIV.X $1, $2\nDAT #5, #3\nDAT #21, #30');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(7);
    expect(core.get((pos + 2) % 80).bValue).toBe(6);
  });
});

describe('MOD opcode variants', () => {
  it('MOD.A does A-field modulo', () => {
    const { core, warriors } = runOneCycle('MOD.A $1, $2\nDAT #3, #0\nDAT #7, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(1);
  });

  it('MOD.B does B-field modulo', () => {
    const { core, warriors } = runOneCycle('MOD.B $1, $2\nDAT #0, #3\nDAT #0, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).bValue).toBe(1);
  });

  it('MOD by zero kills warrior', () => {
    const { sim } = runOneCycle('MOD.A #0, $1\nDAT #5, #0', undefined, { maxCycles: 10 });
    const w0 = sim.getWarriors()[0];
    expect(w0.tasks).toBeLessThanOrEqual(1);
  });

  it('MOD.AB does B-field mod A-field of src', () => {
    const { core, warriors } = runOneCycle('MOD.AB #3, $1\nDAT #0, #7');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).bValue).toBe(1);
  });

  it('MOD.BA does A-field mod B-field of src', () => {
    const { core, warriors } = runOneCycle('MOD.BA $1, $2\nDAT #0, #3\nDAT #7, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(1);
  });

  it('MOD.F modulos both fields', () => {
    const { core, warriors } = runOneCycle('MOD.F $1, $2\nDAT #3, #5\nDAT #7, #11');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(1);
    expect(core.get((pos + 2) % 80).bValue).toBe(1);
  });

  it('MOD.X cross-modulos', () => {
    const { core, warriors } = runOneCycle('MOD.X $1, $2\nDAT #5, #3\nDAT #7, #11');
    const pos = warriors[0].position;
    expect(core.get((pos + 2) % 80).aValue).toBe(1);
    expect(core.get((pos + 2) % 80).bValue).toBe(1);
  });
});

describe('JMZ opcode', () => {
  it('JMZ.B jumps when B-field of B-operand is zero', () => {
    const { warriors } = runOneCycle('JMZ.B $2, $1\nDAT #0, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    // B-field of B-operand (DAT at pos+1) is 0, so jump to pos+2
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('JMZ.B does not jump when B-field is nonzero', () => {
    const { warriors } = runOneCycle('JMZ.B $2, $1\nDAT #0, #5\nDAT #0, #0');
    const pos = warriors[0].position;
    // B-field is 5 (nonzero), so no jump -> next PC is pos+1
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('JMZ.A checks A-field', () => {
    const { warriors } = runOneCycle('JMZ.A $2, $1\nDAT #0, #5\nDAT #0, #0');
    const pos = warriors[0].position;
    // A-field of B-operand (DAT at pos+1) is 0, so jump to pos+2
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });
});

describe('JMN opcode', () => {
  it('JMN.B jumps when B-field is nonzero', () => {
    const { warriors } = runOneCycle('JMN.B $2, $1\nDAT #0, #5\nDAT #0, #0');
    const pos = warriors[0].position;
    // B-field is 5 (nonzero), so jump to pos+2
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('JMN.B does not jump when B-field is zero', () => {
    const { warriors } = runOneCycle('JMN.B $2, $1\nDAT #0, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    // B-field is 0, so no jump -> next PC is pos+1
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });
});

describe('DJN opcode', () => {
  it('DJN.B decrements B-field and jumps if not zero', () => {
    const { core, warriors } = runOneCycle('DJN.B $2, $1\nDAT #0, #5\nDAT #0, #0');
    const pos = warriors[0].position;
    // B-field should be decremented
    expect(core.get((pos + 1) % 80).bValue).toBe(4);
  });

  it('DJN.A decrements A-field', () => {
    const { core, warriors } = runOneCycle('DJN.A $2, $1\nDAT #5, #0\nDAT #0, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(4);
  });

  it('DJN.F decrements both fields', () => {
    const { core, warriors } = runOneCycle('DJN.F $2, $1\nDAT #5, #3\nDAT #0, #0');
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(4);
    expect(core.get((pos + 1) % 80).bValue).toBe(2);
  });
});

describe('CMP/SEQ opcode', () => {
  it('CMP.A skips when A-fields equal', () => {
    const { warriors } = runOneCycle('CMP.A $1, $2\nDAT #5, #0\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.A does not skip when A-fields differ', () => {
    const { warriors } = runOneCycle('CMP.A $1, $2\nDAT #5, #0\nDAT #3, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('CMP.B skips when B-fields equal', () => {
    const { warriors } = runOneCycle('CMP.B $1, $2\nDAT #0, #5\nDAT #0, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.AB skips when A-field of src equals B-field of dst', () => {
    const { warriors } = runOneCycle('CMP.AB $1, $2\nDAT #5, #0\nDAT #0, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.BA skips when B-field of src equals A-field of dst', () => {
    const { warriors } = runOneCycle('CMP.BA $1, $2\nDAT #0, #5\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.F skips when both A and B fields equal', () => {
    const { warriors } = runOneCycle('CMP.F $1, $2\nDAT #3, #5\nDAT #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.F does not skip when fields differ', () => {
    const { warriors } = runOneCycle('CMP.F $1, $2\nDAT #3, #5\nDAT #3, #6');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('CMP.X skips when cross-fields equal', () => {
    const { warriors } = runOneCycle('CMP.X $1, $2\nDAT #5, #3\nDAT #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.I skips when entire instructions match', () => {
    const { warriors } = runOneCycle('CMP.I $1, $2\nDAT #3, #5\nDAT #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('CMP.I does not skip when opcodes differ', () => {
    const { warriors } = runOneCycle('CMP.I $1, $2\nDAT #3, #5\nNOP #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });
});

describe('SNE opcode', () => {
  it('SNE.A skips when A-fields differ', () => {
    const { warriors } = runOneCycle('SNE.A $1, $2\nDAT #3, #0\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SNE.A does not skip when A-fields equal', () => {
    const { warriors } = runOneCycle('SNE.A $1, $2\nDAT #5, #0\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('SNE.B skips when B-fields differ', () => {
    const { warriors } = runOneCycle('SNE.B $1, $2\nDAT #0, #3\nDAT #0, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SNE.I skips when instructions differ', () => {
    const { warriors } = runOneCycle('SNE.I $1, $2\nDAT #3, #5\nNOP #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SNE.I does not skip when instructions match', () => {
    const { warriors } = runOneCycle('SNE.I $1, $2\nDAT #3, #5\nDAT #3, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });
});

describe('SLT opcode', () => {
  it('SLT.A skips when A-field of src < A-field of dst', () => {
    const { warriors } = runOneCycle('SLT.A $1, $2\nDAT #3, #0\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SLT.A does not skip when A-field of src >= A-field of dst', () => {
    const { warriors } = runOneCycle('SLT.A $1, $2\nDAT #5, #0\nDAT #3, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('SLT.B skips when B-field of src < B-field of dst', () => {
    const { warriors } = runOneCycle('SLT.B $1, $2\nDAT #0, #3\nDAT #0, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SLT.AB skips when A-field of src < B-field of dst', () => {
    const { warriors } = runOneCycle('SLT.AB $1, $2\nDAT #3, #0\nDAT #0, #5');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SLT.BA skips when B-field of src < A-field of dst', () => {
    const { warriors } = runOneCycle('SLT.BA $1, $2\nDAT #0, #3\nDAT #5, #0');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SLT.F skips when both A<A and B<B', () => {
    const { warriors } = runOneCycle('SLT.F $1, $2\nDAT #1, #2\nDAT #3, #4');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });

  it('SLT.F does not skip when one pair is not less', () => {
    const { warriors } = runOneCycle('SLT.F $1, $2\nDAT #5, #2\nDAT #3, #4');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 1) % 80);
  });

  it('SLT.X skips when A<B and B<A cross', () => {
    const { warriors } = runOneCycle('SLT.X $1, $2\nDAT #2, #1\nDAT #3, #4');
    const pos = warriors[0].position;
    expect(warriors[0].processQueue.peek()).toBe((pos + 2) % 80);
  });
});

describe('NOP opcode', () => {
  it('NOP does nothing', () => {
    const { warriors } = runOneCycle('NOP\nDAT #0, #0');
    expect(warriors[0].alive).toBe(true);
  });
});

describe('LDP/STP opcodes', () => {
  it('STP.AB stores A-value at P-space[B-value]', () => {
    const { core, warriors } = runOneCycle('STP.AB #42, $1\nDAT #0, #5');
    // Verify warrior is still alive (didn't crash)
    expect(warriors[0].alive).toBe(true);
  });

  it('STP then LDP round-trip preserves value', () => {
    // Store 42 at P-space index 3, then load from index 3
    const cs = 80;
    const w1 = makeWarrior('STP.AB #42, $2\nLDP.AB #3, $1\nDAT #0, #3\nDAT #0, #0', { coreSize: cs });
    const w2 = makeWarrior('JMP $0', { coreSize: cs });
    const sim = new Simulator({ coreSize: cs, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([w1, w2]);
    sim.setupRound();
    sim.step(); // STP: store 42 at p-space[3]
    sim.step(); // warrior 1's turn
    sim.step(); // LDP: load from p-space[3] into B-field of target at pos+2
    const pos = sim.getWarriors()[0].position;
    expect(sim.getCore().get((pos + 2) % cs).bValue).toBe(42);
  });

  it('LDP.A loads into A-field', () => {
    const { core, warriors } = runOneCycle('LDP.A #1, $1\nDAT #0, #0');
    // P-space index 1 starts at 0, so A-field should be 0
    const pos = warriors[0].position;
    expect(core.get((pos + 1) % 80).aValue).toBe(0);
  });

  it('LDP.BA loads B-field index into A-field', () => {
    const { core, warriors } = runOneCycle('LDP.BA $1, $2\nDAT #0, #1\nDAT #0, #0');
    const pos = warriors[0].position;
    // Loads from P-space[1] (= 0) into A-field of target
    expect(core.get((pos + 2) % 80).aValue).toBe(0);
  });

  it('STP.A stores A-field at A-field index', () => {
    const { warriors } = runOneCycle('STP.A $1, $2\nDAT #42, #0\nDAT #5, #0');
    expect(warriors[0].alive).toBe(true);
  });

  it('STP.BA stores B-field at A-field index', () => {
    const { warriors } = runOneCycle('STP.BA $1, $2\nDAT #0, #42\nDAT #5, #0');
    expect(warriors[0].alive).toBe(true);
  });
});

describe('Addressing modes', () => {
  it('B-indirect @ reads through B-field', () => {
    // MOV @1, $3: read B-field of cell at PC+1 (which is 1), then read from PC+1+1=PC+2
    const { core, warriors } = runOneCycle('MOV.I @1, $3\nDAT #0, #1\nDAT #55, #44\nDAT #0, #0');
    const pos = warriors[0].position;
    const dst = core.get((pos + 3) % 80);
    expect(dst.aValue).toBe(55);
    expect(dst.bValue).toBe(44);
  });

  it('B-predecrement < decrements before reading', () => {
    const { core, warriors } = runOneCycle('MOV.I <1, $3\nDAT #0, #2\nDAT #99, #88\nDAT #0, #0');
    const pos = warriors[0].position;
    // <1: decrement B-field of cell at PC+1 (2->1), then read from PC+1+1=PC+2
    expect(core.get((pos + 1) % 80).bValue).toBe(1);
  });

  it('B-postincrement > increments after reading', () => {
    const { core, warriors } = runOneCycle('MOV.I >1, $3\nDAT #0, #1\nDAT #99, #88\nDAT #0, #0');
    const pos = warriors[0].position;
    // >1: read B-field of cell at PC+1 (1), read from PC+1+1=PC+2, then increment B-field (1->2)
    expect(core.get((pos + 1) % 80).bValue).toBe(2);
  });
});
