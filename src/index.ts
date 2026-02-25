// Direct pmars API
export { Simulator } from './simulator/index.js';
export type { CoreAccessEvent, TaskCountEvent, RoundEndEvent, SimulatorEventListener, RoundResult } from './simulator/index.js';
export { Core } from './simulator/core.js';
export { SimWarrior } from './simulator/warrior.js';
export { PSpace, computePSpaceSize } from './simulator/pspace.js';
export { Assembler, disassemble } from './assembler/index.js';
export type { AssembleResult, AssemblerMessage } from './assembler/index.js';
export { ExpressionEvaluator } from './assembler/expression.js';

// Types and enums
export { Opcode, Modifier, AddressMode, DEFAULT_OPTIONS, OPCODE_NAMES, MODIFIER_NAMES, ADDRESS_MODE_SYMBOLS } from './types.js';
export type { Instruction, WarriorData, SimulatorOptions, WarriorState } from './types.js';
export { encodeOpcode, decodeOpcode, createInstruction, INITIAL_INSTRUCTION } from './constants.js';

// Utilities
export { addMod, subMod, normalize, mulMod } from './utils/modular-arithmetic.js';
export { CircularQueue } from './utils/circular-queue.js';
export { rng } from './utils/rng.js';
