import { Assembler, disassemble } from '../src/index.js';

const asm = new Assembler();

const result = asm.assemble(`
;redcode
;name Dwarf
;author A.K. Dewdney
;strategy Bombs every 4th cell

ADD.AB #4, $3
MOV.I $2, @2
JMP $-2, $0
DAT.F #0, #0
`);

if (!result.success || !result.warrior) {
  console.error('Assembly failed:', result.messages);
  process.exit(1);
}

console.log(`Name: ${result.warrior.name}`);
console.log(`Author: ${result.warrior.author}`);
console.log(`Instructions: ${result.warrior.instructions.length}`);
console.log(`Start offset: ${result.warrior.startOffset}`);
console.log();

for (const inst of result.warrior.instructions) {
  console.log(disassemble(inst, 8000));
}
