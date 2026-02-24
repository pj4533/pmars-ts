import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { DEFAULT_OPTIONS } from '../../src/types';
import { corewar } from '../../src/compat/index';

describe('Configurable maxLength (instruction limit)', () => {
  it('DEFAULT_OPTIONS has maxLength defaulting to 100', () => {
    expect(DEFAULT_OPTIONS.maxLength).toBe(100);
  });

  it('assembles >100 instructions when maxLength is raised', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 2000 });
    const source = `;redcode
;name LargeWarrior
FOR 1500
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior).not.toBeNull();
    expect(result.warrior!.instructions.length).toBe(1500);
  });

  it('rejects instructions exceeding default maxLength', () => {
    const asm = new Assembler({ coreSize: 8000 });
    const source = `;redcode
;name TooLargeWarrior
FOR 150
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit is 100'))).toBe(true);
  });

  it('rejects instructions exceeding custom maxLength', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 500 });
    const source = `;redcode
;name MediumWarrior
FOR 600
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    expect(result.success).toBe(false);
    expect(result.messages.some(m => m.type === 'ERROR' && m.text.includes('limit is 500'))).toBe(true);
  });

  it('allows exactly maxLength count', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 1500 });
    const source = `;redcode
;name ExactWarrior
FOR 1500
MOV 0, 1
ROF`;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1500);
  });

  it('preserves default behavior with small warriors', () => {
    const asm = new Assembler({ coreSize: 8000 });
    const source = `;redcode
;name SmallWarrior
MOV 0, 1
DAT #0, #0`;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
  });

  it('compat layer maps instructionLimit to maxLength', () => {
    const asm = new Assembler({ coreSize: 8000, maxLength: 1500 });
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

    corewar.initialiseSimulator(
      { coresize: 8000, maximumCycles: 80000, instructionLimit: 3900, maxTasks: 8000, minSeparation: 100 },
      [w1, w2],
    );

    const result = corewar.step();
    expect(result).toBeNull();
  });

  it('compat layer assembles >100 instruction warrior through full pipeline', () => {
    const source = `;redcode
;name LargeCompatWarrior
FOR 1200
MOV 0, 1
ROF`;
    const filler = `;redcode
;name Filler
MOV 0, 1`;

    // parse() uses default maxLength=100, so a 1200-instruction warrior would fail.
    // initialiseSimulator re-assembles from source text with the raised instructionLimit,
    // so we construct a stub IParseResult and let it do the real assembly.
    const stubParseResult = {
      metaData: { name: 'LargeCompatWarrior', author: '', strategy: '' },
      tokens: [],
      messages: [],
      success: true,
    };

    const fillerResult = corewar.parse(filler);
    expect(fillerResult.success).toBe(true);

    const w1 = { source: stubParseResult, data: source };
    const w2 = { source: fillerResult, data: filler };

    corewar.initialiseSimulator(
      { coresize: 8000, maximumCycles: 80000, instructionLimit: 2000, maxTasks: 8000, minSeparation: 100 },
      [w1, w2],
    );

    const result = corewar.step();
    expect(result).toBeNull();
  });
});
