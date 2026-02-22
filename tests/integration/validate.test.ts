import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Assembler } from '../../src/assembler/index';
import { Simulator } from '../../src/simulator/index';
import { Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode } from '../../src/constants';

describe('ICWS validation (validate.red)', () => {
  const validateSource = readFileSync(join(__dirname, 'warriors/validate.red'), 'utf-8');

  it('assembles validate.red successfully', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 200 });
    const result = asm.assemble(validateSource);
    expect(result.success).toBe(true);
    expect(result.warrior).not.toBeNull();
    expect(result.warrior!.instructions.length).toBeGreaterThan(10);
    expect(result.warrior!.instructions.length).toBeLessThan(200);
  });

  it('validate.red ties against Imp (ICWS88 compliance)', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 200 });
    const validateResult = asm.assemble(validateSource);
    expect(validateResult.success).toBe(true);
    const validateWarrior = validateResult.warrior!;

    const impWarrior = {
      instructions: [{
        opcode: encodeOpcode(Opcode.MOV, Modifier.I),
        aMode: AddressMode.DIRECT,
        bMode: AddressMode.DIRECT,
        aValue: 0,
        bValue: 1,
      }],
      startOffset: 0,
      name: 'Imp',
      author: 'test',
      strategy: '',
      pin: null,
    };

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000, maxLength: 200 });
    sim.loadWarriors([validateWarrior, impWarrior]);
    const results = sim.run(1);

    expect(results.length).toBe(1);
    expect(results[0].outcome).toBe('TIE');
  });
});
