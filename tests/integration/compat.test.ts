import { describe, it, expect } from 'vitest';
import { corewar } from '../../src/compat/index';
import { TokenCategory, MessageType } from '../../src/compat/types';

const IMP_SOURCE = ';redcode\n;name Imp\n;author Test\nMOV.I $0, $1\n';
const DAT_SOURCE = ';redcode\n;name DAT Warrior\n;author Test\nDAT.F #0, #0\n';

describe('modelwar compat API', () => {
  describe('parse()', () => {
    it('parses a simple Imp warrior', () => {
      const result = corewar.parse(IMP_SOURCE);
      expect(result.success).toBe(true);
      expect(result.metaData.name).toBe('Imp');
      expect(result.tokens.filter(t => t.category === TokenCategory.Opcode).length).toBe(1);
      expect(result.messages.filter(m => m.type === MessageType.Error).length).toBe(0);
    });

    it('returns failure for invalid code', () => {
      const result = corewar.parse('INVALID');
      expect(result.success).toBe(false);
    });
  });

  describe('initialiseSimulator() + run()', () => {
    it('runs Imp vs DAT and returns a result', () => {
      const impResult = corewar.parse(IMP_SOURCE);
      const datResult = corewar.parse(DAT_SOURCE);

      const options = {
        coresize: 55440,
        maximumCycles: 500000,
        instructionLimit: 200,
        maxTasks: 10000,
        minSeparation: 200,
      };

      const warriors = [
        { source: impResult, data: IMP_SOURCE },
        { source: datResult, data: DAT_SOURCE },
      ];

      corewar.initialiseSimulator(options, warriors);
      const result = corewar.run();

      expect(result).toHaveProperty('winnerId');
      expect(result).toHaveProperty('outcome');
    });
  });

  describe('initialiseSimulator() + step() with messageProvider', () => {
    it('emits CORE_ACCESS, TASK_COUNT, and ROUND_END events', () => {
      const impResult = corewar.parse(IMP_SOURCE);
      const datResult = corewar.parse(DAT_SOURCE);

      const options = {
        coresize: 55440,
        maximumCycles: 500000,
        instructionLimit: 200,
        maxTasks: 10000,
        minSeparation: 200,
      };

      const warriors = [
        { source: impResult, data: IMP_SOURCE },
        { source: datResult, data: DAT_SOURCE },
      ];

      const events: { topic: string; payload: unknown }[] = [];
      const messageProvider = {
        publishSync(topic: string, payload: unknown) {
          events.push({ topic, payload });
        },
      };

      corewar.initialiseSimulator(options, warriors, messageProvider);

      let result = null;
      while (result === null) {
        result = corewar.step();
      }

      expect(events.some(e => e.topic === 'CORE_ACCESS')).toBe(true);
      expect(events.some(e => e.topic === 'TASK_COUNT')).toBe(true);
      expect(events.some(e => e.topic === 'ROUND_END')).toBe(true);

      const coreAccessEvent = events.find(e => e.topic === 'CORE_ACCESS');
      const coreAccessPayload = coreAccessEvent!.payload as { warriorId: number; address: number; accessType: string }[];
      expect(Array.isArray(coreAccessPayload)).toBe(true);
      expect(coreAccessPayload[0]).toHaveProperty('warriorId');
      expect(coreAccessPayload[0]).toHaveProperty('address');
      expect(coreAccessPayload[0]).toHaveProperty('accessType');

      const taskCountEvent = events.find(e => e.topic === 'TASK_COUNT');
      const taskCountPayload = taskCountEvent!.payload as { warriorId: number; taskCount: number }[];
      expect(Array.isArray(taskCountPayload)).toBe(true);
      expect(taskCountPayload[0]).toHaveProperty('warriorId');
      expect(taskCountPayload[0]).toHaveProperty('taskCount');

      const roundEndEvent = events.find(e => e.topic === 'ROUND_END');
      const roundEndPayload = roundEndEvent!.payload as { winnerId: number | null };
      expect(roundEndPayload).toHaveProperty('winnerId');
    });
  });

  describe('warriors without data field', () => {
    it('accepts warriors passed as { source: parseResult } without data', () => {
      const impResult = corewar.parse(IMP_SOURCE);
      const datResult = corewar.parse(DAT_SOURCE);

      const options = {
        coresize: 55440,
        maximumCycles: 500000,
        instructionLimit: 200,
        maxTasks: 10000,
        minSeparation: 200,
      };

      const warriors = [
        { source: impResult },
        { source: datResult },
      ];

      corewar.initialiseSimulator(options, warriors);
      const result = corewar.run();

      expect(result).toHaveProperty('winnerId');
      expect(result).toHaveProperty('outcome');
    });
  });
});
