import { Assembler, Simulator } from '../src/index.js';

const asm = new Assembler();

const imp = asm.assemble(`
;redcode
;name Imp
;author A.K. Dewdney
MOV.I $0, $1
`);

const dwarf = asm.assemble(`
;redcode
;name Dwarf
;author A.K. Dewdney
ADD.AB #4, $3
MOV.I $2, @2
JMP $-2, $0
DAT.F #0, #0
`);

if (!imp.warrior || !dwarf.warrior) {
  console.error('Assembly failed');
  process.exit(1);
}

const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
sim.loadWarriors([imp.warrior, dwarf.warrior]);
const results = sim.run();

for (const result of results) {
  if (result.outcome === 'WIN') {
    const winner = result.winnerId === 0 ? imp.warrior.name : dwarf.warrior.name;
    console.log(`Winner: ${winner}`);
  } else {
    console.log('Tie');
  }
}
