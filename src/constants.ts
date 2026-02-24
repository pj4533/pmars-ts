import { Opcode, Modifier, AddressMode, type Instruction } from './types.js';

export function encodeOpcode(op: Opcode, mod: Modifier): number {
  return (op << 3) + mod;
}

export function decodeOpcode(encoded: number): { opcode: Opcode; modifier: Modifier } {
  return {
    opcode: (encoded >> 3) as Opcode,
    modifier: (encoded & 0x07) as Modifier,
  };
}

export function createInstruction(
  opcode: Opcode = Opcode.DAT,
  modifier: Modifier = Modifier.F,
  aMode: AddressMode = AddressMode.DIRECT,
  aValue: number = 0,
  bMode: AddressMode = AddressMode.DIRECT,
  bValue: number = 0,
): Instruction {
  return {
    opcode: encodeOpcode(opcode, modifier),
    aMode,
    bMode,
    aValue,
    bValue,
  };
}

export const INITIAL_INSTRUCTION: Readonly<Instruction> = Object.freeze(createInstruction(
  Opcode.DAT, Modifier.F,
  AddressMode.DIRECT, 0,
  AddressMode.DIRECT, 0,
));

export const PMARS_VERSION = 96;
export const MAX_WARRIORS = 36;
export const MAX_PSPACE_DIVISOR = 16;
