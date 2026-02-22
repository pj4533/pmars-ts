import { describe, it, expect } from 'vitest';
import { corewar } from '../../src/compat/index';

describe('corewar compat API', () => {
  it('parse returns IParseResult', () => {
    const result = corewar.parse('MOV $0, $1');
    expect(result.success).toBe(true);
    expect(result.metaData.name).toBeDefined();
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.tokens[0].category).toBe('OPCODE');
  });

  it('parse with metadata', () => {
    const result = corewar.parse(';name TestWarrior\n;author TestAuthor\nMOV $0, $1');
    expect(result.success).toBe(true);
    expect(result.metaData.name).toBe('TestWarrior');
    expect(result.metaData.author).toBe('TestAuthor');
  });

  it('parse failure returns success=false', () => {
    const result = corewar.parse('; only comments');
    expect(result.success).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('initialiseSimulator + run works', () => {
    const w1 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
    );

    const result = corewar.run();
    expect(result.outcome).toBeDefined();
    expect(result.winnerId).toBe(1);
  });

  it('step works', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
    );

    const result = corewar.step();
    // First step should not end the round
    expect(result).toBeNull();
  });

  it('messageProvider receives events', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };

    const events: { type: string; payload: unknown }[] = [];
    const messageProvider = {
      publishSync(type: string, payload: unknown) {
        events.push({ type, payload });
      },
    };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
      messageProvider,
    );

    corewar.run();

    // Should have CORE_ACCESS, TASK_COUNT, and ROUND_END events
    expect(events.some(e => e.type === 'CORE_ACCESS')).toBe(true);
    expect(events.some(e => e.type === 'TASK_COUNT')).toBe(true);
    expect(events.some(e => e.type === 'ROUND_END')).toBe(true);
  });

  it('ROUND_END event has winnerId', () => {
    const w1 = { source: corewar.parse('DAT #0, #0'), data: 'DAT #0, #0' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    let roundEnd: unknown = null;
    const messageProvider = {
      publishSync(type: string, payload: unknown) {
        if (type === 'ROUND_END') roundEnd = payload;
      },
    };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 100, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
      messageProvider,
    );

    corewar.run();
    expect(roundEnd).toEqual({ winnerId: 1 });
  });

  it('CORE_ACCESS events have correct structure', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    let accessEvents: unknown[] = [];
    const messageProvider = {
      publishSync(type: string, payload: unknown) {
        if (type === 'CORE_ACCESS') accessEvents = payload as unknown[];
      },
    };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
      messageProvider,
    );

    corewar.step();
    expect(accessEvents.length).toBeGreaterThan(0);
    const event = accessEvents[0] as Record<string, unknown>;
    expect(event).toHaveProperty('warriorId');
    expect(event).toHaveProperty('address');
    expect(event).toHaveProperty('accessType');
  });

  it('TASK_COUNT events have correct structure', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    let taskEvents: unknown[] = [];
    const messageProvider = {
      publishSync(type: string, payload: unknown) {
        if (type === 'TASK_COUNT') taskEvents = payload as unknown[];
      },
    };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
      messageProvider,
    );

    corewar.step();
    expect(taskEvents.length).toBeGreaterThan(0);
    const event = taskEvents[0] as Record<string, unknown>;
    expect(event).toHaveProperty('warriorId');
    expect(event).toHaveProperty('taskCount');
  });

  it('getWithInfoAt returns instruction data', () => {
    const w1 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };
    const w2 = { source: corewar.parse('MOV $0, $1'), data: 'MOV $0, $1' };

    corewar.initialiseSimulator(
      { coresize: 80, maximumCycles: 5, instructionLimit: 100, maxTasks: 80, minSeparation: 10 },
      [w1, w2],
    );

    const loc = corewar.getWithInfoAt(0);
    expect(loc.instruction).toBeDefined();
    expect(loc.instruction.opcode).toBeDefined();
    expect(loc.access).toBeDefined();
  });
});
