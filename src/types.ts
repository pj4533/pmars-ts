export enum Opcode {
  MOV = 0,
  ADD = 1,
  SUB = 2,
  MUL = 3,
  DIV = 4,
  MOD = 5,
  JMZ = 6,
  JMN = 7,
  DJN = 8,
  CMP = 9,
  SLT = 10,
  SPL = 11,
  DAT = 12,
  JMP = 13,
  SEQ = 14,
  SNE = 15,
  NOP = 16,
  LDP = 17,
  STP = 18,
}

export enum Modifier {
  A = 0,
  B = 1,
  AB = 2,
  BA = 3,
  F = 4,
  X = 5,
  I = 6,
}

export enum AddressMode {
  IMMEDIATE = 0,  // #
  DIRECT = 1,     // $
  B_INDIRECT = 2, // @
  B_PREDECR = 3,  // <
  B_POSTINC = 4,  // >
  A_INDIRECT = 5, // *
  A_PREDECR = 6,  // {
  A_POSTINC = 7,  // }
}

export interface Instruction {
  opcode: number;
  aMode: AddressMode;
  bMode: AddressMode;
  aValue: number;
  bValue: number;
}

export interface WarriorData {
  instructions: Instruction[];
  startOffset: number;
  name: string;
  author: string;
  strategy: string;
  pin: number | null;
  warnings?: string[];
}

export interface SimulatorOptions {
  coreSize: number;
  maxCycles: number;
  maxLength: number;
  maxProcesses: number;
  minSeparation: number;
  readLimit: number;
  writeLimit: number;
  rounds: number;
  pSpaceSize: number;
  warriors: number;
  seed: number | null;
  fixedSeries: boolean;
  fixedPosition: number | null;
}

export interface WarriorState {
  id: number;
  name: string;
  author: string;
  tasks: number;
  processQueue: number[];
  position: number;
  startOffset: number;
  score: number[];
  lastResult: number;
  pSpaceIndex: number;
  pSpaceIDNumber: number;
  alive: boolean;
}

export const DEFAULT_OPTIONS: SimulatorOptions = {
  coreSize: 8000,
  maxCycles: 80000,
  maxLength: 100,
  maxProcesses: 8000,
  minSeparation: 100,
  readLimit: 0,
  writeLimit: 0,
  rounds: 1,
  pSpaceSize: 0,
  warriors: 2,
  seed: null,
  fixedSeries: false,
  fixedPosition: null,
};

export const OPCODE_NAMES: readonly string[] = [
  'MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'JMZ',
  'JMN', 'DJN', 'CMP', 'SLT', 'SPL', 'DAT', 'JMP',
  'SEQ', 'SNE', 'NOP', 'LDP', 'STP',
] as const;

export const MODIFIER_NAMES: readonly string[] = [
  'A', 'B', 'AB', 'BA', 'F', 'X', 'I',
] as const;

export const ADDRESS_MODE_SYMBOLS: readonly string[] = [
  '#', '$', '@', '<', '>', '*', '{', '}',
] as const;
