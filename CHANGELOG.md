# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-02-21

### Added
- Complete ICWS'94 compatible MARS simulator ported from C pmars
- Full Redcode assembler with support for all 19 opcodes, 7 modifiers, and 8 addressing modes
- P-space support (LDP/STP opcodes)
- Drop-in replacement API compatible with the `corewar` npm package
- Direct API via `Simulator` and `Assembler` classes
- Event system for core access, task count, and round end notifications
- ESM and CommonJS dual module output
- 90%+ test coverage across all metrics
