// Migration example: changing from 'corewar' to 'pmars-ts'
//
// Before: import { corewar } from 'corewar';
// After:
import { corewar } from '../src/index.js';

// Parse warriors (API identical to corewar package)
const warrior1 = corewar.parse(`
;redcode
;name Imp
MOV.I $0, $1
`);

const warrior2 = corewar.parse(`
;redcode
;name Dwarf
ADD.AB #4, $3
MOV.I $2, @2
JMP $-2, $0
DAT.F #0, #0
`);

// Check parse results
if (!warrior1.success || !warrior2.success) {
  console.error('Parse failed');
  process.exit(1);
}

// Count instructions (same as modelwar pattern)
const instructionCount = warrior1.tokens.filter(
  (t) => t.category === 'OPCODE'
).length;
console.log(`Warrior 1 instructions: ${instructionCount}`);

// Initialize simulator with modelwar-style options
const options = {
  coresize: 55440,
  maximumCycles: 500000,
  instructionLimit: 200,
  maxTasks: 10000,
  minSeparation: 200,
};

const warriors = [
  { source: warrior1 },
  { source: warrior2 },
];

corewar.initialiseSimulator(options, warriors);

// Run battle
const result = corewar.run() as { winnerId: number | null; outcome: string };

if (result.outcome === 'WIN' && result.winnerId !== null) {
  const winnerName = result.winnerId === 0 ? warrior1.metaData.name : warrior2.metaData.name;
  console.log(`Winner: ${winnerName}`);
} else {
  console.log('Tie');
}
