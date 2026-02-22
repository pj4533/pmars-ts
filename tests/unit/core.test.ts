import { describe, it, expect } from 'vitest';
import { Core } from '../../src/simulator/core';
import { INITIAL_INSTRUCTION } from '../../src/constants';

describe('Core', () => {
  it('initializes with DAT.F $0, $0', () => {
    const core = new Core(100);
    const inst = core.get(0);
    expect(inst.opcode).toBe(INITIAL_INSTRUCTION.opcode);
    expect(inst.aMode).toBe(INITIAL_INSTRUCTION.aMode);
    expect(inst.bMode).toBe(INITIAL_INSTRUCTION.bMode);
    expect(inst.aValue).toBe(0);
    expect(inst.bValue).toBe(0);
  });

  it('get wraps addresses', () => {
    const core = new Core(100);
    const inst1 = core.get(0);
    const inst2 = core.get(100);
    expect(inst1.opcode).toBe(inst2.opcode);
  });

  it('set modifies memory', () => {
    const core = new Core(100);
    core.set(42, { opcode: 0x68, aMode: 0, bMode: 0, aValue: 10, bValue: 20 });
    const inst = core.get(42);
    expect(inst.opcode).toBe(0x68);
    expect(inst.aValue).toBe(10);
    expect(inst.bValue).toBe(20);
  });

  it('loadInstructions copies instructions to core', () => {
    const core = new Core(100);
    const instructions = [
      { opcode: 0x01, aMode: 0 as const, bMode: 0 as const, aValue: 1, bValue: 2 },
      { opcode: 0x02, aMode: 0 as const, bMode: 0 as const, aValue: 3, bValue: 4 },
    ];
    core.loadInstructions(instructions, 50);
    expect(core.get(50).opcode).toBe(0x01);
    expect(core.get(51).opcode).toBe(0x02);
  });

  it('loadInstructions wraps around', () => {
    const core = new Core(100);
    const instructions = [
      { opcode: 0x01, aMode: 0 as const, bMode: 0 as const, aValue: 1, bValue: 2 },
      { opcode: 0x02, aMode: 0 as const, bMode: 0 as const, aValue: 3, bValue: 4 },
    ];
    core.loadInstructions(instructions, 99);
    expect(core.get(99).opcode).toBe(0x01);
    expect(core.get(0).opcode).toBe(0x02);
  });

  it('clear resets all cells', () => {
    const core = new Core(100);
    core.set(50, { opcode: 0x68, aMode: 0, bMode: 0, aValue: 10, bValue: 20 });
    core.clear();
    expect(core.get(50).opcode).toBe(INITIAL_INSTRUCTION.opcode);
  });

  it('wrap normalizes addresses', () => {
    const core = new Core(100);
    expect(core.wrap(0)).toBe(0);
    expect(core.wrap(99)).toBe(99);
    expect(core.wrap(100)).toBe(0);
    expect(core.wrap(-1)).toBe(99);
    expect(core.wrap(200)).toBe(0);
  });

  it('copyFrom copies instruction data', () => {
    const core = new Core(100);
    core.set(10, { opcode: 0x42, aMode: 1, bMode: 2, aValue: 100, bValue: 200 });
    core.copyFrom(10, 20);
    const dst = core.get(20);
    expect(dst.opcode).toBe(0x42);
    expect(dst.aMode).toBe(1);
    expect(dst.bMode).toBe(2);
    expect(dst.aValue).toBe(100);
    expect(dst.bValue).toBe(200);
  });
});
