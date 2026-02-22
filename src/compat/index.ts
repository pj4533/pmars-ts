import {
  type IParseResult, type IWarrior, type IOptions, type IPublishProvider,
  type IRoundResult, type IToken, type ICoreLocation, type IMatchResult,
  type IHillResult, type IRules, type IInstruction,
  ModeType, OpcodeType, ModifierType, TokenCategory, MessageType,
  CoreAccessType,
} from './types.js';
import { Assembler } from '../assembler/index.js';
import { Simulator, type CoreAccessEvent, type TaskCountEvent, type RoundEndEvent } from '../simulator/index.js';
import { type Instruction, type WarriorData, AddressMode, OPCODE_NAMES, MODIFIER_NAMES, ADDRESS_MODE_SYMBOLS } from '../types.js';
import { decodeOpcode, INITIAL_INSTRUCTION } from '../constants.js';

const MODE_MAP: Record<number, ModeType> = {
  [AddressMode.IMMEDIATE]: ModeType.Immediate,
  [AddressMode.DIRECT]: ModeType.Direct,
  [AddressMode.B_INDIRECT]: ModeType.BIndirect,
  [AddressMode.B_PREDECR]: ModeType.BPreDecrement,
  [AddressMode.B_POSTINC]: ModeType.BPostIncrement,
  [AddressMode.A_INDIRECT]: ModeType.AIndirect,
  [AddressMode.A_PREDECR]: ModeType.APreDecrement,
  [AddressMode.A_POSTINC]: ModeType.APostIncrement,
};

const OPCODE_MAP: Record<string, OpcodeType> = {
  MOV: OpcodeType.MOV, ADD: OpcodeType.ADD, SUB: OpcodeType.SUB,
  MUL: OpcodeType.MUL, DIV: OpcodeType.DIV, MOD: OpcodeType.MOD,
  JMZ: OpcodeType.JMZ, JMN: OpcodeType.JMN, DJN: OpcodeType.DJN,
  CMP: OpcodeType.CMP, SLT: OpcodeType.SLT, SPL: OpcodeType.SPL,
  DAT: OpcodeType.DAT, JMP: OpcodeType.JMP, SEQ: OpcodeType.SEQ,
  SNE: OpcodeType.SNE, NOP: OpcodeType.NOP, LDP: OpcodeType.LDP,
  STP: OpcodeType.STP,
};

const MODIFIER_MAP: Record<string, ModifierType> = {
  A: ModifierType.A, B: ModifierType.B, AB: ModifierType.AB,
  BA: ModifierType.BA, F: ModifierType.F, X: ModifierType.X,
  I: ModifierType.I,
};

function instructionToCompat(inst: Instruction, address: number): IInstruction {
  const { opcode, modifier } = decodeOpcode(inst.opcode);
  const opName = OPCODE_NAMES[opcode];
  const modName = MODIFIER_NAMES[modifier];

  return {
    address,
    opcode: OPCODE_MAP[opName] || OpcodeType.DAT,
    modifier: MODIFIER_MAP[modName] || ModifierType.F,
    aOperand: {
      mode: MODE_MAP[inst.aMode] || ModeType.Direct,
      address: inst.aValue,
    },
    bOperand: {
      mode: MODE_MAP[inst.bMode] || ModeType.Direct,
      address: inst.bValue,
    },
  };
}

/** Remove undefined values so they don't override DEFAULT_OPTIONS during spread */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result as Partial<T>;
}

class CorewarCompat {
  private simulator: Simulator | null = null;
  private assembler = new Assembler();
  private messageProvider: IPublishProvider | null = null;
  private loadedWarriors: IWarrior[] = [];
  private warriorData: WarriorData[] = [];
  private currentOptions: IOptions = {};
  private roundStarted = false;

  parse(redcode: string): IParseResult {
    const result = this.assembler.assemble(redcode);

    const tokens: IToken[] = [];
    if (result.warrior) {
      for (let i = 0; i < result.warrior.instructions.length; i++) {
        tokens.push({
          position: { line: i + 1, char: 0 },
          lexeme: '',
          category: TokenCategory.Opcode,
        });
      }
    }

    const messages = result.messages.map(m => ({
      type: m.type === 'ERROR' ? MessageType.Error : m.type === 'WARNING' ? MessageType.Warning : MessageType.Info,
      position: { line: m.line, char: 0 },
      text: m.text,
    }));

    return {
      metaData: {
        name: result.warrior?.name || 'Unknown',
        author: result.warrior?.author || 'Anonymous',
        strategy: result.warrior?.strategy || '',
      },
      tokens,
      messages,
      success: result.success,
    };
  }

  initialiseSimulator(options: IOptions, warriors: IWarrior[], messageProvider?: IPublishProvider): void {
    this.currentOptions = options;
    this.loadedWarriors = warriors;
    this.messageProvider = messageProvider || null;
    this.warriorData = [];

    // Build simulator options, filtering undefined to preserve DEFAULT_OPTIONS
    const simOpts = stripUndefined({
      coreSize: options.coresize,
      maxCycles: options.maximumCycles,
      maxLength: options.instructionLimit,
      maxProcesses: options.maxTasks,
      minSeparation: options.minSeparation,
      readLimit: options.readLimit,
      writeLimit: options.writeLimit,
      pSpaceSize: options.pSpaceSize,
      seed: options.seed,
      rounds: options.rounds,
      fixedSeries: options.fixedSeries,
      fixedPosition: options.fixedPosition,
    });

    // Update assembler with new options
    this.assembler = new Assembler(simOpts);

    for (const w of warriors) {
      if (w.source.success) {
        // Re-assemble to get the WarriorData with correct options
        const sourceText = w.data as string | undefined;
        if (sourceText) {
          const result = this.assembler.assemble(sourceText);
          if (result.warrior) {
            this.warriorData.push(result.warrior);
            continue;
          }
        }
        // Build warrior data from tokens
        this.warriorData.push(this.parseResultToWarriorData(w.source));
      }
    }

    this.simulator = new Simulator(simOpts);

    this.simulator.loadWarriors(this.warriorData);

    if (this.messageProvider) {
      this.simulator.setEventListener({
        onCoreAccess: (events: CoreAccessEvent[]) => {
          this.messageProvider!.publishSync('CORE_ACCESS', events.map(e => ({
            warriorId: e.warriorId,
            address: e.address,
            accessType: e.accessType,
          })));
        },
        onTaskCount: (counts: TaskCountEvent[]) => {
          this.messageProvider!.publishSync('TASK_COUNT', counts.map(c => ({
            warriorId: c.warriorId,
            taskCount: c.taskCount,
          })));
        },
        onRoundEnd: (event: RoundEndEvent) => {
          this.messageProvider!.publishSync('ROUND_END', {
            winnerId: event.winnerId ?? null,
          });
        },
      });
    }

    this.simulator.setupRound();
    this.roundStarted = true;
  }

  step(steps?: number): IRoundResult | null {
    if (!this.simulator || !this.roundStarted) return null;

    const count = steps || 1;
    for (let i = 0; i < count; i++) {
      const result = this.simulator.step();
      if (result) {
        this.roundStarted = false;
        return {
          winnerId: result.winnerId ?? undefined,
          outcome: result.outcome,
        };
      }
    }
    return null;
  }

  run(): IRoundResult {
    if (!this.simulator) {
      throw new Error('Simulator not initialized');
    }

    // Step until round completes
    let result: IRoundResult | null = null;
    while (result === null) {
      result = this.step();
    }
    return result;
  }

  serialise(_tokens: IToken[]): string {
    return '';
  }

  getWithInfoAt(address: number): ICoreLocation {
    const core = this.simulator?.getCore();
    const inst = core ? core.get(address) : { ...INITIAL_INSTRUCTION };
    return {
      instruction: instructionToCompat(inst, address),
      access: {
        address,
        accessType: CoreAccessType.read,
      },
    };
  }

  republish(): void {
    // No-op for now
  }

  runMatch(rules: IRules, warriors: IWarrior[], messageProvider?: IPublishProvider): IMatchResult {
    const results: { won: number; drawn: number; lost: number }[] = warriors.map(() => ({ won: 0, drawn: 0, lost: 0 }));

    for (let r = 0; r < rules.rounds; r++) {
      this.initialiseSimulator(rules.options, warriors, messageProvider);
      const result = this.run();
      if (result.winnerId !== undefined) {
        results[result.winnerId].won++;
        for (let j = 0; j < warriors.length; j++) {
          if (j !== result.winnerId) results[j].lost++;
        }
      } else {
        for (let j = 0; j < warriors.length; j++) results[j].drawn++;
      }
    }

    return {
      rounds: rules.rounds,
      warriors: warriors.map((w, i) => ({
        warrior: w,
        won: results[i].won,
        drawn: results[i].drawn,
        lost: results[i].lost,
        given: 0,
        taken: 0,
      })),
    };
  }

  runHill(rules: IRules, warriors: IWarrior[], messageProvider?: IPublishProvider): IHillResult {
    const hillResults: IHillResult = { warriors: [] };
    for (let i = 0; i < warriors.length; i++) {
      const matches: IMatchResult[] = [];
      let totalWon = 0, totalDrawn = 0, totalLost = 0;
      for (let j = 0; j < warriors.length; j++) {
        if (i === j) continue;
        const matchResult = this.runMatch(rules, [warriors[i], warriors[j]], messageProvider);
        matches.push(matchResult);
        totalWon += matchResult.warriors[0].won;
        totalDrawn += matchResult.warriors[0].drawn;
        totalLost += matchResult.warriors[0].lost;
      }
      hillResults.warriors.push({
        warrior: warriors[i],
        rank: 0,
        score: rules.scoreFormula?.(totalWon, totalLost, totalDrawn, warriors.length) ?? (totalWon * 3 + totalDrawn),
        won: totalWon,
        drawn: totalDrawn,
        lost: totalLost,
        matches,
      });
    }
    // Sort by score descending and assign ranks
    hillResults.warriors.sort((a, b) => b.score - a.score);
    hillResults.warriors.forEach((w, i) => w.rank = i + 1);
    return hillResults;
  }

  runBenchmark(warrior: IWarrior, rules: IRules, warriors: IWarrior[], messageProvider: IPublishProvider): IHillResult {
    return this.runHill(rules, [warrior, ...warriors], messageProvider);
  }

  private parseResultToWarriorData(parseResult: IParseResult): WarriorData {
    // Re-assemble from the source using the assembler
    // Since we don't have the original source text, we build minimal instructions
    return {
      instructions: [{ ...INITIAL_INSTRUCTION }],
      startOffset: 0,
      name: parseResult.metaData.name,
      author: parseResult.metaData.author,
      strategy: parseResult.metaData.strategy,
      pin: null,
    };
  }
}

export const corewar = new CorewarCompat();
export type { IParseResult, IWarrior, IOptions, IPublishProvider, IRoundResult, IToken, ICoreLocation, IInstruction, IMatchResult, IHillResult, IRules, IMatchWarriorResult, IHillWarriorResult, IOperand, IPosition, IMessage, IMetaData, IMatchWarrior, ICoreAccessEventArgs } from './types.js';
export { ModeType, OpcodeType, ModifierType, TokenCategory, MessageType, CoreAccessType } from './types.js';
