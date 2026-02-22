import { describe, it, expect } from 'vitest';
import { Assembler } from '../../src/assembler/index';
import { Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode, decodeOpcode } from '../../src/constants';

describe('Assembler', () => {
  let asm: Assembler;

  beforeEach(() => {
    asm = new Assembler({ coreSize: 8000, maxLength: 100 });
  });

  it('assembles a simple DAT instruction', () => {
    const result = asm.assemble('DAT #0, #0');
    expect(result.success).toBe(true);
    expect(result.warrior).not.toBeNull();
    expect(result.warrior!.instructions.length).toBe(1);
    const inst = result.warrior!.instructions[0];
    const { opcode, modifier } = decodeOpcode(inst.opcode);
    expect(opcode).toBe(Opcode.DAT);
    expect(modifier).toBe(Modifier.F);
  });

  it('assembles MOV instruction with default modifier', () => {
    const result = asm.assemble('MOV #1, $0');
    expect(result.success).toBe(true);
    const inst = result.warrior!.instructions[0];
    const { opcode, modifier } = decodeOpcode(inst.opcode);
    expect(opcode).toBe(Opcode.MOV);
    expect(modifier).toBe(Modifier.AB);
  });

  it('assembles MOV.I instruction', () => {
    const result = asm.assemble('MOV.I $1, $2');
    expect(result.success).toBe(true);
    const inst = result.warrior!.instructions[0];
    const { opcode, modifier } = decodeOpcode(inst.opcode);
    expect(opcode).toBe(Opcode.MOV);
    expect(modifier).toBe(Modifier.I);
  });

  it('assembles all addressing modes', () => {
    const result = asm.assemble('MOV.I #1, $2');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aMode).toBe(AddressMode.IMMEDIATE);
    expect(result.warrior!.instructions[0].bMode).toBe(AddressMode.DIRECT);
  });

  it('assembles multi-line programs', () => {
    const source = `
      MOV.I $0, $1
      ADD.AB #4, $-1
      JMP $-2
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(3);
  });

  it('handles labels', () => {
    const source = `
loop  MOV.I $0, $1
      JMP loop
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
    // JMP's A-field should point to loop (relative: -1)
    const jmpInst = result.warrior!.instructions[1];
    expect(jmpInst.aValue).toBe(8000 - 1); // normalized -1
  });

  it('handles metadata directives', () => {
    const source = `
;name TestWarrior
;author TestAuthor
;strategy A simple test
DAT #0, #0
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.name).toBe('TestWarrior');
    expect(result.warrior!.author).toBe('TestAuthor');
  });

  it('handles EQU directives', () => {
    const source = `
step EQU 4
      ADD.AB #step, $-1
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].aValue).toBe(4);
  });

  it('handles ORG directive', () => {
    const source = `
      ORG 2
      DAT #0, #0
      MOV $0, $1
      JMP $-1
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(2);
  });

  it('handles END directive with offset', () => {
    const source = `
      DAT #0, #0
      MOV $0, $1
      JMP $-1
      END 1
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.startOffset).toBe(1);
  });

  it('handles single operand DAT', () => {
    const result = asm.assemble('DAT #5');
    expect(result.success).toBe(true);
    const inst = result.warrior!.instructions[0];
    expect(inst.aMode).toBe(AddressMode.IMMEDIATE);
    expect(inst.aValue).toBe(0);
    expect(inst.bMode).toBe(AddressMode.IMMEDIATE);
    expect(inst.bValue).toBe(5);
  });

  it('handles single operand JMP', () => {
    const result = asm.assemble('JMP $0');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1);
  });

  it('handles comments', () => {
    const source = `
      MOV $0, $1 ; this is a comment
      ; full line comment
      DAT #0, #0
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(2);
  });

  it('handles predefined constants', () => {
    const asm2 = new Assembler({ coreSize: 8000, maxLength: 100 });
    const result = asm2.assemble('DAT #0, #CORESIZE');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions[0].bValue).toBe(0); // 8000 % 8000 = 0
  });

  it('assembles Imp', () => {
    const result = asm.assemble('MOV $0, $1');
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(1);
    const inst = result.warrior!.instructions[0];
    const { opcode } = decodeOpcode(inst.opcode);
    expect(opcode).toBe(Opcode.MOV);
    expect(inst.aValue).toBe(0);
    expect(inst.bValue).toBe(1);
  });

  it('reports error for no instructions', () => {
    const result = asm.assemble('; only comments');
    expect(result.success).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('assembles dwarf', () => {
    const source = `
;name Dwarf
;author A. K. Dewdney
      ADD.AB #4, $3
      MOV.I  $2, @2
      JMP    $-2
      DAT    #0, #0
    `;
    const result = asm.assemble(source);
    expect(result.success).toBe(true);
    expect(result.warrior!.instructions.length).toBe(4);
    expect(result.warrior!.name).toBe('Dwarf');
    expect(result.warrior!.author).toBe('A. K. Dewdney');
  });
});
