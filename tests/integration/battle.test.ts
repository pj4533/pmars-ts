import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Assembler } from '../../src/assembler/index';
import { Simulator } from '../../src/simulator/index';
import { Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode } from '../../src/constants';

const warriorFiles = [
  'validate.red',
  'excalibur.red',
  'forgottenloreii.red',
  'sunset.red',
  'sonofvain.red',
  'artofcorewar.red',
];

function loadWarriorSource(filename: string): string {
  return readFileSync(join(__dirname, 'warriors', filename), 'utf-8');
}

describe('Warrior assembly', () => {
  for (const file of warriorFiles) {
    it(`assembles ${file} successfully`, () => {
      const source = loadWarriorSource(file);
      const asm = new Assembler({ coreSize: 8000, maxLength: 200 });
      const result = asm.assemble(source);
      expect(result.success).toBe(true);
      expect(result.warrior).not.toBeNull();
      expect(result.warrior!.instructions.length).toBeGreaterThan(0);
    });
  }
});

describe('Warrior battles', () => {
  it('Imp defeats DAT warrior', () => {
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

    const datWarrior = {
      instructions: [{
        opcode: encodeOpcode(Opcode.DAT, Modifier.F),
        aMode: AddressMode.IMMEDIATE,
        bMode: AddressMode.IMMEDIATE,
        aValue: 0,
        bValue: 0,
      }],
      startOffset: 0,
      name: 'DAT Warrior',
      author: 'test',
      strategy: '',
      pin: null,
    };

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
    sim.loadWarriors([impWarrior, datWarrior]);
    const results = sim.run(1);

    expect(results.length).toBe(1);
    expect(results[0].outcome).toBe('WIN');
    expect(results[0].winnerId).toBe(0);
  });

  it('complex warriors battle without errors', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 200 });

    const excaliburResult = asm.assemble(loadWarriorSource('excalibur.red'));
    expect(excaliburResult.success).toBe(true);

    const forgottenResult = asm.assemble(loadWarriorSource('forgottenloreii.red'));
    expect(forgottenResult.success).toBe(true);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000, maxLength: 200 });
    sim.loadWarriors([excaliburResult.warrior!, forgottenResult.warrior!]);
    const results = sim.run(1);

    expect(results.length).toBe(1);
    expect(results[0].outcome).toMatch(/^(WIN|TIE)$/);
  });

  it('multi-round execution returns correct number of results', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 200 });

    const excaliburResult = asm.assemble(loadWarriorSource('excalibur.red'));
    expect(excaliburResult.success).toBe(true);

    const forgottenResult = asm.assemble(loadWarriorSource('forgottenloreii.red'));
    expect(forgottenResult.success).toBe(true);

    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000, maxLength: 200 });
    sim.loadWarriors([excaliburResult.warrior!, forgottenResult.warrior!]);
    const results = sim.run(5);

    expect(results.length).toBe(5);
    for (const result of results) {
      expect(result.outcome).toMatch(/^(WIN|TIE)$/);
    }
  });
});
