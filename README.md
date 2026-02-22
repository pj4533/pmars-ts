# pmars-ts

TypeScript port of [pMARS](https://corewar.co.uk/pmars.htm) (portable Memory Array Redcode Simulator) for [Core War](https://corewar.co.uk/). Faithfully replicates the behavior of the original C implementation.

## Installation

```bash
npm install pmars-ts
```

## Quick Start

### Direct API

```typescript
import { Assembler, Simulator } from 'pmars-ts';

const asm = new Assembler();
const imp = asm.assemble(';redcode\n;name Imp\nMOV.I $0, $1');
const dwarf = asm.assemble(';redcode\n;name Dwarf\nADD.AB #4, $3\nMOV.I $2, @2\nJMP $-2, $0\nDAT.F #0, #0');

const sim = new Simulator({ coreSize: 8000, maxCycles: 80000 });
sim.loadWarriors([imp.warrior!, dwarf.warrior!]);
const results = sim.run();

console.log(results[0].outcome, results[0].winnerId);
```

### Compat API

```typescript
import { corewar } from 'pmars-ts';

const result = corewar.parse(';redcode\n;name Imp\nMOV.I $0, $1');
console.log(result.success, result.metaData.name);

corewar.initialiseSimulator(
  { coresize: 8000, maximumCycles: 80000, instructionLimit: 100, maxTasks: 8000, minSeparation: 100 },
  [{ source: result }]
);

const roundResult = corewar.run();
console.log(roundResult);
```

## API Reference

### Assembler

```typescript
const asm = new Assembler(options?);
const result = asm.assemble(source);
// result.success, result.warrior, result.messages
```

### Simulator

```typescript
const sim = new Simulator(options?);
sim.loadWarriors([warrior1, warrior2]);
const results = sim.run(rounds?);     // Run all rounds
sim.setupRound();                      // Manual round setup
const stepResult = sim.step();         // Step one instruction
```

### Simulator Options

| Option | Default | Description |
|---|---|---|
| `coreSize` | 8000 | Size of the core memory array |
| `maxCycles` | 80000 | Maximum cycles per round |
| `maxLength` | 100 | Maximum warrior length |
| `maxProcesses` | 8000 | Maximum processes per warrior |
| `minSeparation` | 100 | Minimum distance between warriors |
| `rounds` | 1 | Number of rounds to simulate |

### Compat API

```typescript
import { corewar } from 'pmars-ts';

corewar.parse(source)
corewar.initialiseSimulator(options, warriors, messageProvider?)
corewar.run()
corewar.step(steps?)
corewar.runMatch(rules, warriors, messageProvider?)
corewar.runHill(rules, warriors, messageProvider?)
```

## Features

- All 19 ICWS'94 opcodes (MOV, ADD, SUB, MUL, DIV, MOD, JMP, JMZ, JMN, DJN, CMP/SEQ, SNE, SLT, SPL, DAT, NOP, LDP, STP)
- All 7 instruction modifiers (A, B, AB, BA, F, X, I)
- All 8 addressing modes (#, $, @, <, >, *, {, })
- P-space support with PIN sharing
- In-register evaluation (ICWS'88 compliant)
- Deterministic RNG matching pmars
- Zero runtime dependencies
- ESM and CommonJS dual output

## Attribution

This project is a TypeScript port of **pMARS** (portable Memory Array Redcode Simulator), the official Redcode simulator of [rec.games.corewar](https://groups.google.com/g/rec.games.corewar).

**Original pMARS authors:**
- Albert Ma
- Nandor Sieben
- Stefan Strack
- Mintardjo Wangsaw

**Additional contributors to the original C codebase:** Alex Macaulay (Mac front-end), Martin Maierhofer (X-Windows and Linux SVGA displays), Nathan Summers (VMS port), Ken Espiritu (optimized x86 sim.c), Ilmari Karonen (-P option and improvements), Joonas Pihlaja (read/write limits and improvements).

pMARS has been actively maintained with patches reviewed by John Metcalf. More information at [corewar.co.uk/pmars.htm](https://corewar.co.uk/pmars.htm).

## License

GPL-2.0 - see [LICENSE](LICENSE) for details. Matches the original pMARS license.
