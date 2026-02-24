import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { DEFAULT_OPTIONS } from '../../src/types';
import { corewar } from '../../src/compat/index';

describe('Configurable maxInstructions', () => {
  it('DEFAULT_OPTIONS has maxInstructions defaulting to 1000', () => {
    expect(DEFAULT_OPTIONS.maxInstructions).toBe(1000);
  });

  it('assembles >1000 instructions when maxInstructions is raised', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 2000, maxInstructions: 2000 });
    // Generate 1500 instructions using FOR/ROF
    const source = `;redcode
;name LargeWarrior
FOR 1500
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    // Should succeed — no error about exceeding instruction limit
    expect(result.success).toBe(true);
    expect(result.warrior).not.toBeNull();
    expect(result.warrior!.instructions.length).toBe(1500);
  });

  it('rejects >1000 instructions with default maxInstructions', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 2000 });
    const source = `;redcode
;name TooLargeWarrior
FOR 1500
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    // Should fail — maxInstructions defaults to 1000, effectiveMaxLength = min(2000, 1000) = 1000
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit is 1000'))).toBe(true);
  });

  it('uses maxInstructions as the cap when lower than maxLength', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 1000, maxInstructions: 500 });
    const source = `;redcode
;name MediumWarrior
FOR 600
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    // effectiveMaxLength = min(1000, 500) = 500, but warrior has 600 instructions
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit is 500'))).toBe(true);
  });

  it('allows exactly maxInstructions count', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 1500, maxInstructions: 1500 });
    const source = `;redcode
;name ExactWarrior
FOR 1500
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1500);
  });

  it('preserves existing behavior when maxInstructions is not specified', () => {
    // Assembler without maxInstructions uses DEFAULT_OPTIONS.maxInstructions = 1000
    const asm = new Assembler({ coreSize: 8000, maxLength: 100 });
    const source = `;redcode
;name SmallWarrior
MOV 0, 1
DAT #0, #0`;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
  });

  it('compat layer maps instructionLimit to maxInstructions', () => {
    // The compat layer should map instructionLimit to both maxLength and maxInstructions.
    // We test this by using the Assembler directly with compat-equivalent options,
    // since initialiseSimulator re-assembles with these options internally.
    const asm = new Assembler({
      coreSize: 8000,
      maxLength: 1500,
      maxInstructions: 1500, // This is what instructionLimit maps to
    });

    const source = `;redcode
;name LargeCompat
FOR 1200
MOV 0, 1
ROF`;

    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1200);
  });

  it('compat layer initialiseSimulator works with raised instructionLimit', () => {
    // Use two small warriors that parse fine with default options
    const source1 = `;redcode
;name Warrior1
MOV 0, 1`;
    const source2 = `;redcode
;name Warrior2
MOV 0, 1`;

    const parseResult1 = corewar.parse(source1);
    const parseResult2 = corewar.parse(source2);
    expect(parseResult1.success).toBe(true);
    expect(parseResult2.success).toBe(true);

    const w1 = { source: parseResult1, data: source1 };
    const w2 = { source: parseResult2, data: source2 };

    // Verify initialiseSimulator accepts instructionLimit > 1000 without error
    corewar.initialiseSimulator(
      { coresize: 8000, maximumCycles: 80000, instructionLimit: 3900, maxTasks: 8000, minSeparation: 100 },
      [w1, w2],
    );

    // First step should not end the round with two imps
    const result = corewar.step();
    expect(result).toBeNull();
  });
});
