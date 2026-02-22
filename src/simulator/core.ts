import { type Instruction } from '../types.js';
import { INITIAL_INSTRUCTION } from '../constants.js';

export class Core {
  private memory: Instruction[];
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.memory = new Array(size);
    this.clear();
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) {
      this.memory[i] = { ...INITIAL_INSTRUCTION };
    }
  }

  get(addr: number): Instruction {
    return this.memory[((addr % this.size) + this.size) % this.size];
  }

  set(addr: number, inst: Instruction): void {
    this.memory[((addr % this.size) + this.size) % this.size] = inst;
  }

  copyFrom(src: number, dst: number): void {
    const s = this.get(src);
    const d = this.get(dst);
    d.opcode = s.opcode;
    d.aMode = s.aMode;
    d.bMode = s.bMode;
    d.aValue = s.aValue;
    d.bValue = s.bValue;
  }

  loadInstructions(instructions: Instruction[], startAddr: number): void {
    for (let i = 0; i < instructions.length; i++) {
      const addr = (startAddr + i) % this.size;
      this.memory[addr] = { ...instructions[i] };
    }
  }

  wrap(addr: number): number {
    return ((addr % this.size) + this.size) % this.size;
  }
}
