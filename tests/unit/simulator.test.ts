import { describe, it, expect } from 'vitest';
import { Simulator } from '../../src/simulator/index';
import { Assembler } from '../../src/assembler/index';
import { type WarriorData, Opcode, Modifier, AddressMode } from '../../src/types';
import { encodeOpcode, decodeOpcode } from '../../src/constants';

function makeWarrior(source: string): WarriorData {
  const asm = new Assembler({ coreSize: 8000, maxLength: 100, maxProcesses: 8000 });
  const result = asm.assemble(source);
  if (!result.success || !result.warrior) throw new Error(`Assembly failed: ${result.messages.map(m => m.text).join(', ')}`);
  return result.warrior;
}

describe('Simulator', () => {
  it('runs Imp vs Imp to a tie', () => {
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000, maxProcesses: 8000, minSeparation: 100 });
    sim.loadWarriors([imp, { ...imp, name: 'Imp2' }]);
    const results = sim.run(1);
    expect(results.length).toBe(1);
    expect(results[0].outcome).toBe('TIE');
  });

  it('runs DAT warrior dies immediately', () => {
    const dat = makeWarrior('DAT #0, #0');
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 8000, maxCycles: 80000, maxProcesses: 8000, minSeparation: 100 });
    sim.loadWarriors([dat, imp]);
    const results = sim.run(1);
    expect(results.length).toBe(1);
    expect(results[0].winnerId).toBe(1);
    expect(results[0].outcome).toBe('WIN');
  });

  it('step returns null during execution', () => {
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 10, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([imp, { ...imp, name: 'Imp2' }]);
    sim.setupRound();
    const result = sim.step();
    expect(result).toBeNull();
  });

  it('fires core access events', () => {
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 5, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([imp, { ...imp, name: 'Imp2' }]);

    const events: { warriorId: number; address: number; accessType: string }[][] = [];
    sim.setEventListener({
      onCoreAccess: (evts) => events.push(evts),
    });

    sim.setupRound();
    sim.step();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].some(e => e.accessType === 'EXECUTE')).toBe(true);
  });

  it('fires task count events', () => {
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 5, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([imp, { ...imp, name: 'Imp2' }]);

    const counts: { warriorId: number; taskCount: number }[][] = [];
    sim.setEventListener({
      onTaskCount: (c) => counts.push(c),
    });

    sim.setupRound();
    sim.step();
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0].some(c => c.taskCount === 1)).toBe(true);
  });

  it('fires round end event', () => {
    const dat = makeWarrior('DAT #0, #0');
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([dat, imp]);

    let endEvent: { winnerId: number | null } | null = null;
    sim.setEventListener({
      onRoundEnd: (e) => { endEvent = e; },
    });

    sim.run(1);
    expect(endEvent).not.toBeNull();
    expect(endEvent!.winnerId).toBe(1);
  });

  it('SPL creates additional processes', () => {
    // SPL $0, $0 with JMP $-1 so the second process also survives
    const splWarrior = makeWarrior(`
      SPL $0
      JMP $-1
    `);
    const imp = makeWarrior('MOV $0, $1');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([splWarrior, imp]);
    sim.setupRound();

    // Step enough times for warrior 0 to execute SPL at least once
    // With 2 warriors, warrior 0 executes on steps 1, 3, 5, ...
    // After step 1: SPL pushes PC+1 then addrA -> tasks = 2
    for (let i = 0; i < 2; i++) sim.step();

    const warriors = sim.getWarriors();
    expect(warriors[0].tasks).toBeGreaterThanOrEqual(2);
  });

  it('JMP changes execution address', () => {
    const jmpWarrior = makeWarrior('JMP $0');
    const sim = new Simulator({ coreSize: 80, maxCycles: 100, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([jmpWarrior, jmpWarrior]);
    const results = sim.run(1);
    expect(results[0].outcome).toBe('TIE');
  });

  it('ADD modifies core values', () => {
    const addWarrior = makeWarrior(`
      ADD.AB #5, $1
      DAT #0, #0
    `);
    const sim = new Simulator({ coreSize: 80, maxCycles: 5, maxProcesses: 80, minSeparation: 10 });
    sim.loadWarriors([addWarrior, makeWarrior('JMP $0')]);
    sim.setupRound();
    sim.step();

    const core = sim.getCore();
    const pos = sim.getWarriors()[0].position;
    const dat = core.get((pos + 1) % 80);
    expect(dat.bValue).toBe(5);
  });
});
