import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { DEFAULT_OPTIONS } from '../../src/types';

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

  it('assembles >100 instructions with raised maxLength through Assembler', () => {
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
});
