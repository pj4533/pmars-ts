# pmars-ts

TypeScript port of [pMARS](https://corewar.co.uk/pmars.htm) (portable Memory Array Redcode Simulator) — the official ICWS'94 Corewar simulator originally written in C by Albert Ma, Nandor Sieben, Stefan Strack, and Mintardjo Wangsaw.

## Build & Test

```bash
npm run build          # TypeScript compile → ESM + CJS dual output
npm test               # Run all tests with coverage (vitest + v8)
npm run test:watch     # Watch mode for development
npm run typecheck      # Type-check only (no emit)
```

## Project Structure

```
src/
├── index.ts                  # Public API exports
├── types.ts                  # Core enums (Opcode, Modifier, AddressMode) and interfaces
├── constants.ts              # Instruction encoding/decoding helpers
├── assembler/
│   ├── index.ts              # Redcode assembler (two-pass: labels → instructions)
│   └── expression.ts         # Recursive descent expression evaluator
├── simulator/
│   ├── index.ts              # Main simulation engine (all 19 opcodes)
│   ├── core.ts               # Core memory array (8000 cells, wrapping)
│   ├── warrior.ts            # Warrior state and process queue
│   ├── pspace.ts             # P-space shared memory
│   └── positioning.ts        # Warrior positioning with deterministic RNG
└── utils/
    ├── rng.ts                # Park-Miller MINSTD RNG (matches original pmars)
    ├── circular-queue.ts     # Process queue (FIFO)
    └── modular-arithmetic.ts # addMod, subMod, normalize
tests/
├── unit/                     # Unit tests per module
└── integration/              # Full assembly → battle integration tests
examples/                     # Usage examples (basic-battle, parse-warrior)
```

## Architecture

- **Assembler**: Two-pass Redcode parser. Pass 1 collects labels/EQUs, pass 2 assembles instructions. Supports FOR/ROF loops, ORG, PIN, and all ICWS'94 directives.
- **Simulator**: Executes warriors in round-robin with process queues. Implements all 19 opcodes with 7 modifiers and 8 addressing modes. Event-driven (CoreAccess, TaskCount, RoundEnd).

## Key Details

- Zero runtime dependencies
- ESM + CommonJS dual output via `dist/esm/` and `dist/cjs/`
- License: GPL-2.0 (matches original pMARS)
- Test framework: Vitest 3.0 with v8 coverage
- TypeScript strict mode enabled
- Coverage target: >90% statements and branches
