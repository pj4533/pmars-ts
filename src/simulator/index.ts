import { type Instruction, type WarriorData, type SimulatorOptions, DEFAULT_OPTIONS, Opcode, Modifier, AddressMode } from '../types.js';
import { encodeOpcode, decodeOpcode, INITIAL_INSTRUCTION } from '../constants.js';
import { Core } from './core.js';
import { SimWarrior } from './warrior.js';
import { PSpace, computePSpaceSize } from './pspace.js';
import { positionWarriors } from './positioning.js';
import { addMod, subMod, mulMod } from '../utils/modular-arithmetic.js';
import { rng } from '../utils/rng.js';

export interface CoreAccessEvent {
  warriorId: number;
  address: number;
  accessType: 'READ' | 'WRITE' | 'EXECUTE';
}

export interface TaskCountEvent {
  warriorId: number;
  taskCount: number;
}

export interface RoundEndEvent {
  winnerId: number | null;
}

export interface SimulatorEventListener {
  onCoreAccess?: (events: CoreAccessEvent[]) => void;
  onTaskCount?: (counts: TaskCountEvent[]) => void;
  onRoundEnd?: (event: RoundEndEvent) => void;
}

export interface RoundResult {
  winnerId: number | null;
  outcome: 'WIN' | 'TIE';
}

export class Simulator {
  private options: SimulatorOptions;
  private core: Core;
  private warriors: SimWarrior[] = [];
  private warriorData: WarriorData[] = [];
  private pSpaces: PSpace[] = [];
  private listener: SimulatorEventListener | null = null;

  // Simulation state
  private currentWarriorIdx = 0;
  private warriorsLeft = 0;
  private cycle = 0;
  private roundNum = 0;
  private totalCycles = 0;
  private seed = 0;
  private initialized = false;

  // Linked list for active warriors
  private nextWarrior: number[] = [];
  private prevWarrior: number[] = [];

  // Per-step event accumulator
  private coreAccessEvents: CoreAccessEvent[] = [];

  constructor(options?: Partial<SimulatorOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.core = new Core(this.options.coreSize);
  }

  setEventListener(listener: SimulatorEventListener | null): void {
    this.listener = listener;
  }

  loadWarriors(warriors: WarriorData[]): void {
    this.warriorData = warriors;
    const coreSize = this.options.coreSize;

    // Validate and auto-adjust configuration (matches C's clparse.c validation)
    if (this.options.minSeparation < this.options.maxLength) {
      this.options.minSeparation = this.options.maxLength;
    }
    // If separation is too large for the core, reduce it to fit
    if (warriors.length > 1 && coreSize < warriors.length * this.options.minSeparation) {
      this.options.minSeparation = Math.floor(coreSize / warriors.length);
    }
    this.warriors = warriors.map((w, i) =>
      new SimWarrior(i, w, this.options.maxProcesses, warriors.length, coreSize)
    );
    const pSpaceSize = this.options.pSpaceSize > 0
      ? this.options.pSpaceSize
      : computePSpaceSize(coreSize);
    this.pSpaces = warriors.map(() => new PSpace(pSpaceSize, coreSize));

    // Handle shared P-space via PIN
    for (let i = 0; i < warriors.length; i++) {
      if (warriors[i].pin !== null) {
        for (let j = 0; j < i; j++) {
          if (warriors[j].pin !== null && warriors[j].pin === warriors[i].pin) {
            this.warriors[i].pSpaceIndex = j;
            break;
          }
        }
      }
    }

    this.initialized = true;
  }

  run(rounds?: number): RoundResult[] {
    const numRounds = rounds ?? this.options.rounds;
    const results: RoundResult[] = [];
    for (let r = 0; r < numRounds; r++) {
      results.push(this.runRound());
    }
    return results;
  }

  runRound(): RoundResult {
    this.setupRound();
    while (this.cycle > 0 && this.warriorsLeft >= 2) {
      this.executeOneCycle();
    }
    return this.endRound();
  }

  /** Initialize state for a new round of simulation. */
  setupRound(): void {
    if (!this.initialized || this.warriors.length === 0) {
      throw new Error('Simulator not initialized. Call loadWarriors() first.');
    }

    this.core.clear();
    this.roundNum++;

    // Position warriors
    if (this.seed === 0) {
      this.seed = this.options.seed ?? this.checksumWarriors();
      this.seed = rng(this.seed);
    }

    const { positions, seed: newSeed } = positionWarriors(
      this.warriors.length,
      this.options.coreSize,
      this.options.minSeparation,
      this.seed,
    );
    this.seed = newSeed;

    // Set up warriors
    this.warriorsLeft = this.warriors.length;
    this.totalCycles = this.warriors.length * this.options.maxCycles;
    this.cycle = this.totalCycles;

    this.nextWarrior = new Array(this.warriors.length);
    this.prevWarrior = new Array(this.warriors.length);

    for (let i = 0; i < this.warriors.length; i++) {
      this.warriors[i].position = positions[i];
      this.warriors[i].reset(positions[i], this.options.coreSize);
      this.core.loadInstructions(this.warriorData[i].instructions, positions[i]);
      this.nextWarrior[i] = (i + 1) % this.warriors.length;
      this.prevWarrior[i] = (i - 1 + this.warriors.length) % this.warriors.length;
    }

    // Starter rotates each round
    this.currentWarriorIdx = (this.roundNum - 1) % this.warriors.length;
  }

  /** Execute a single step (one warrior's turn). Returns null or round result if round ended. */
  step(): RoundResult | null {
    if (this.cycle <= 0 || this.warriorsLeft < 2) {
      return this.endRound();
    }

    this.executeOneCycle();

    if (this.cycle <= 0 || this.warriorsLeft < 2) {
      return this.endRound();
    }
    return null;
  }

  /** Execute one instruction for the current warrior */
  private executeOneCycle(): void {
    const w = this.warriors[this.currentWarriorIdx];
    const coreSize = this.options.coreSize;
    const coreSize1 = coreSize - 1;

    // Pop program counter
    const progCnt = w.popProcess();

    // Copy current instruction to register
    const ir = this.core.get(progCnt);
    const irOpcode = ir.opcode;
    const irAMode = ir.aMode;
    const irBMode = ir.bMode;
    let irAValue = ir.aValue;
    let irBValue = ir.bValue;

    this.coreAccessEvents = [];
    this.emitCoreAccess(w.id, progCnt, 'EXECUTE');

    // --- Evaluate A operand ---
    // Matches C sim.c address resolution with multi-stage RWLIMIT folding
    let addrA: number;
    let AA_Value: number;

    if (irAMode !== AddressMode.IMMEDIATE) {
      addrA = this.foldr(addMod(irAValue, progCnt, coreSize), progCnt);

      if (irAMode !== AddressMode.DIRECT) {
        let fieldPtr: number;
        let isAField = false;
        // waddrA: write-folded base addr for predec/postinc (C: waddrA = foldw(...))
        let waddrA = addrA;

        if (irAMode === AddressMode.A_INDIRECT || irAMode === AddressMode.A_PREDECR || irAMode === AddressMode.A_POSTINC) {
          isAField = true;
          if (irAMode !== AddressMode.A_INDIRECT) {
            waddrA = this.foldw(addMod(irAValue, progCnt, coreSize), progCnt);
            fieldPtr = this.core.get(waddrA).aValue;
          } else {
            this.emitCoreAccess(w.id, addrA, 'READ');
            fieldPtr = this.core.get(addrA).aValue;
          }
        } else {
          if (irAMode !== AddressMode.B_INDIRECT) {
            waddrA = this.foldw(addMod(irAValue, progCnt, coreSize), progCnt);
            fieldPtr = this.core.get(waddrA).bValue;
          } else {
            this.emitCoreAccess(w.id, addrA, 'READ');
            fieldPtr = this.core.get(addrA).bValue;
          }
        }

        // Pre-decrement
        if (irAMode === AddressMode.B_PREDECR || irAMode === AddressMode.A_PREDECR) {
          fieldPtr--;
          if (fieldPtr < 0) fieldPtr = coreSize1;
          if (isAField) {
            this.core.get(waddrA).aValue = fieldPtr;
          } else {
            this.core.get(waddrA).bValue = fieldPtr;
          }
        }

        // C: addrA = foldr(addrA + temp) -- for predecr/postinc, addrA was
        // set to waddrA (write-folded) before this point (sim.c:454,464)
        const addrABase = (irAMode !== AddressMode.A_INDIRECT && irAMode !== AddressMode.B_INDIRECT) ? waddrA : addrA;
        addrA = this.foldr(addMod(fieldPtr, addrABase, coreSize), progCnt);
        AA_Value = this.core.get(addrA).aValue;
        irAValue = this.core.get(addrA).bValue;

        // Post-increment
        if (irAMode === AddressMode.B_POSTINC || irAMode === AddressMode.A_POSTINC) {
          fieldPtr++;
          if (fieldPtr === coreSize) fieldPtr = 0;
          if (isAField) {
            this.core.get(waddrA).aValue = fieldPtr;
          } else {
            this.core.get(waddrA).bValue = fieldPtr;
          }
        }
      } else {
        // DIRECT mode
        const baseA = this.core.get(addrA);
        AA_Value = baseA.aValue;
        irAValue = baseA.bValue;
      }
    } else {
      // IMMEDIATE mode
      AA_Value = irAValue;
      addrA = progCnt;
      irAValue = irBValue;
    }

    // --- Evaluate B operand ---
    // C maintains separate read (raddrB via foldr) and write (addrB via foldw) pointers
    let addrB: number;
    let raddrB: number;
    let AB_Value: number;

    if (irBMode !== AddressMode.IMMEDIATE) {
      raddrB = this.foldr(addMod(irBValue, progCnt, coreSize), progCnt);
      addrB = this.foldw(addMod(irBValue, progCnt, coreSize), progCnt);
      const baseWriteAddrB = addrB; // save for post-increment

      if (irBMode !== AddressMode.DIRECT) {
        let fieldPtr: number;
        let isAField = false;

        if (irBMode === AddressMode.A_INDIRECT || irBMode === AddressMode.A_PREDECR || irBMode === AddressMode.A_POSTINC) {
          isAField = true;
          if (irBMode !== AddressMode.A_INDIRECT) {
            fieldPtr = this.core.get(addrB).aValue;
          } else {
            this.emitCoreAccess(w.id, raddrB, 'READ');
            fieldPtr = this.core.get(raddrB).aValue;
          }
        } else {
          if (irBMode !== AddressMode.B_INDIRECT) {
            fieldPtr = this.core.get(addrB).bValue;
          } else {
            this.emitCoreAccess(w.id, raddrB, 'READ');
            fieldPtr = this.core.get(raddrB).bValue;
          }
        }

        // Pre-decrement - write to write-folded base address
        if (irBMode === AddressMode.B_PREDECR || irBMode === AddressMode.A_PREDECR) {
          fieldPtr--;
          if (fieldPtr < 0) fieldPtr = coreSize1;
          if (isAField) {
            this.core.get(addrB).aValue = fieldPtr;
          } else {
            this.core.get(addrB).bValue = fieldPtr;
          }
        }

        // Final addresses: write via foldw, read via foldr
        // C: for predecr/postinc, raddrB was set to addrB (write-folded) at sim.c:568,578
        const raddrBBase = (irBMode !== AddressMode.A_INDIRECT && irBMode !== AddressMode.B_INDIRECT) ? addrB : raddrB;
        addrB = this.foldw(addMod(fieldPtr, addrB, coreSize), progCnt);
        raddrB = this.foldr(addMod(fieldPtr, raddrBBase, coreSize), progCnt);
        AB_Value = this.core.get(raddrB).aValue;
        irBValue = this.core.get(raddrB).bValue;

        // Post-increment - write to the BASE offset cell (not final resolved addr)
        if (irBMode === AddressMode.B_POSTINC || irBMode === AddressMode.A_POSTINC) {
          fieldPtr++;
          if (fieldPtr === coreSize) fieldPtr = 0;
          if (isAField) {
            this.core.get(baseWriteAddrB).aValue = fieldPtr;
          } else {
            this.core.get(baseWriteAddrB).bValue = fieldPtr;
          }
        }
      } else {
        const baseB = this.core.get(raddrB);
        AB_Value = baseB.aValue;
        irBValue = baseB.bValue;
      }
    } else {
      addrB = progCnt;
      raddrB = progCnt;
      irBValue = this.core.get(addrB).bValue;
      AB_Value = this.core.get(addrB).aValue;
    }

    // --- Execute instruction ---
    const { opcode, modifier } = decodeOpcode(irOpcode);
    let pushNext = true;
    let nextAddr = addMod(progCnt, 1, coreSize);
    let died = false;

    switch (opcode) {
      case Opcode.MOV:
        this.execMOV(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, w.id);
        break;

      case Opcode.ADD:
        this.execADD(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, coreSize, w.id);
        break;

      case Opcode.SUB:
        this.execSUB(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, coreSize, w.id);
        break;

      case Opcode.MUL:
        this.execMUL(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, coreSize, w.id);
        break;

      case Opcode.DIV:
        died = this.execDIV(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, coreSize, w.id);
        break;

      case Opcode.MOD:
        died = this.execMOD(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, coreSize, w.id);
        break;

      case Opcode.JMP:
        w.pushProcess(addrA);
        pushNext = false;
        break;

      case Opcode.JMZ:
        if (this.checkJMZ(modifier, AB_Value, irBValue)) {
          w.pushProcess(addrA);
          pushNext = false;
        }
        break;

      case Opcode.JMN:
        if (this.checkJMN(modifier, AB_Value, irBValue)) {
          w.pushProcess(addrA);
          pushNext = false;
        }
        break;

      case Opcode.DJN:
        if (this.execDJN(modifier, addrA, addrB, AB_Value, irBValue, coreSize1, w.id)) {
          w.pushProcess(addrA);
          pushNext = false;
        }
        break;

      case Opcode.CMP:
      case Opcode.SEQ:
        if (this.checkCMP(modifier, addrA, raddrB, AA_Value, irAValue, AB_Value, irBValue)) {
          nextAddr = addMod(progCnt, 2, coreSize);
        }
        break;

      case Opcode.SNE:
        if (!this.checkCMP(modifier, addrA, raddrB, AA_Value, irAValue, AB_Value, irBValue)) {
          nextAddr = addMod(progCnt, 2, coreSize);
        }
        break;

      case Opcode.SLT:
        if (this.checkSLT(modifier, AA_Value, irAValue, AB_Value, irBValue)) {
          nextAddr = addMod(progCnt, 2, coreSize);
        }
        break;

      case Opcode.SPL:
        w.pushProcess(nextAddr);
        if (w.tasks < this.options.maxProcesses) {
          w.tasks++;
          w.pushProcess(addrA);
        }
        pushNext = false;
        break;

      case Opcode.DAT:
        died = true;
        break;

      case Opcode.NOP:
        break;

      case Opcode.LDP:
        this.execLDP(modifier, addrA, addrB, AA_Value, irAValue, w, coreSize);
        break;

      case Opcode.STP:
        this.execSTP(modifier, addrA, addrB, AA_Value, irAValue, AB_Value, irBValue, w, coreSize);
        break;
    }

    if (died) {
      w.tasks--;
      if (w.tasks <= 0) {
        w.alive = false;
        w.score[this.warriorsLeft + this.warriors.length - 2]++;
        // Adjust cycle count
        this.cycle = this.cycle - 1 - Math.floor((this.cycle - 1) / this.warriorsLeft);
        this.warriorsLeft--;

        // Remove from linked list
        this.nextWarrior[this.prevWarrior[this.currentWarriorIdx]] = this.nextWarrior[this.currentWarriorIdx];
        this.prevWarrior[this.nextWarrior[this.currentWarriorIdx]] = this.prevWarrior[this.currentWarriorIdx];

        this.currentWarriorIdx = this.nextWarrior[this.currentWarriorIdx];
      } else {
        pushNext = false;
      }
    }

    if (pushNext && !died) {
      w.pushProcess(nextAddr);
    } else if (!died && !pushNext) {
      // Already pushed in JMP/JMZ/JMN/DJN/SPL
    }

    // Emit events
    if (this.listener?.onCoreAccess && this.coreAccessEvents.length > 0) {
      this.listener.onCoreAccess(this.coreAccessEvents);
    }
    if (this.listener?.onTaskCount) {
      this.listener.onTaskCount(
        this.warriors.filter(w2 => w2.alive).map(w2 => ({ warriorId: w2.id, taskCount: w2.tasks }))
      );
    }

    // Advance to next warrior if current warrior didn't die
    if (w.alive) {
      this.currentWarriorIdx = this.nextWarrior[this.currentWarriorIdx];
    }
    this.cycle--;
  }

  private endRound(): RoundResult {
    let winnerId: number | null = null;
    let outcome: 'WIN' | 'TIE' = 'TIE';

    for (const w of this.warriors) {
      if (w.alive) {
        w.score[this.warriorsLeft - 1]++;
        w.lastResult = this.warriorsLeft;
        this.pSpaces[w.pSpaceIndex].lastResult = this.warriorsLeft;
      } else {
        w.lastResult = 0;
        this.pSpaces[w.pSpaceIndex].lastResult = 0;
      }
    }

    if (this.warriorsLeft === 1) {
      const winner = this.warriors.find(w => w.alive);
      if (winner) {
        winnerId = winner.id;
        outcome = 'WIN';
      }
    }

    const result: RoundResult = { winnerId, outcome };

    if (this.listener?.onRoundEnd) {
      this.listener.onRoundEnd({ winnerId });
    }

    return result;
  }

  private checksumWarriors(): number {
    let checksum = 0;
    let shuffle = 0;
    for (const wd of this.warriorData) {
      for (const inst of wd.instructions) {
        checksum += (inst.opcode ^ shuffle++);
        checksum += (inst.aMode ^ shuffle++);
        checksum += (inst.bMode ^ shuffle++);
        checksum += (inst.aValue ^ shuffle++);
        checksum += (inst.bValue ^ shuffle++);
      }
    }
    return checksum;
  }

  private foldr(addr: number, progCnt: number): number {
    if (this.options.readLimit === 0) return addr;
    const rl = this.options.readLimit;
    const cs = this.options.coreSize;
    let result = (addr + cs - progCnt) % rl;
    if (result > Math.floor(rl / 2)) {
      result = result + cs - rl;
    }
    return addMod(result, progCnt, cs);
  }

  private foldw(addr: number, progCnt: number): number {
    if (this.options.writeLimit === 0) return addr;
    const wl = this.options.writeLimit;
    const cs = this.options.coreSize;
    let result = (addr + cs - progCnt) % wl;
    if (result > Math.floor(wl / 2)) {
      result = result + cs - wl;
    }
    return addMod(result, progCnt, cs);
  }

  private emitCoreAccess(warriorId: number, address: number, accessType: 'READ' | 'WRITE' | 'EXECUTE'): void {
    if (this.listener?.onCoreAccess) {
      this.coreAccessEvents.push({ warriorId, address, accessType });
    }
  }

  // --- Opcode implementations ---

  private execMOV(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, _AB: number, _BVal: number, wid: number): void {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        dst.aValue = AA;
        break;
      case Modifier.B:
        dst.bValue = AVal;
        break;
      case Modifier.AB:
        dst.bValue = AA;
        break;
      case Modifier.BA:
        dst.aValue = AVal;
        break;
      case Modifier.F:
        dst.aValue = AA;
        dst.bValue = AVal;
        break;
      case Modifier.X:
        dst.bValue = AA;
        dst.aValue = AVal;
        break;
      case Modifier.I: {
        const src = this.core.get(addrA);
        dst.opcode = src.opcode;
        dst.aMode = src.aMode;
        dst.bMode = src.bMode;
        dst.aValue = AA;
        dst.bValue = AVal;
        break;
      }
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
  }

  private execADD(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, AB: number, BVal: number, cs: number, wid: number): void {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        dst.aValue = addMod(AB, AA, cs);
        break;
      case Modifier.B:
        dst.bValue = addMod(BVal, AVal, cs);
        break;
      case Modifier.AB:
        dst.bValue = addMod(BVal, AA, cs);
        break;
      case Modifier.BA:
        dst.aValue = addMod(AB, AVal, cs);
        break;
      case Modifier.F:
      case Modifier.I:
        dst.aValue = addMod(AB, AA, cs);
        dst.bValue = addMod(BVal, AVal, cs);
        break;
      case Modifier.X:
        dst.bValue = addMod(BVal, AA, cs);
        dst.aValue = addMod(AB, AVal, cs);
        break;
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
  }

  private execSUB(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, AB: number, BVal: number, cs: number, wid: number): void {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        dst.aValue = subMod(AB, AA, cs);
        break;
      case Modifier.B:
        dst.bValue = subMod(BVal, AVal, cs);
        break;
      case Modifier.AB:
        dst.bValue = subMod(BVal, AA, cs);
        break;
      case Modifier.BA:
        dst.aValue = subMod(AB, AVal, cs);
        break;
      case Modifier.F:
      case Modifier.I:
        dst.aValue = subMod(AB, AA, cs);
        dst.bValue = subMod(BVal, AVal, cs);
        break;
      case Modifier.X:
        dst.bValue = subMod(BVal, AA, cs);
        dst.aValue = subMod(AB, AVal, cs);
        break;
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
  }

  private execMUL(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, AB: number, BVal: number, cs: number, wid: number): void {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        dst.aValue = mulMod(AB, AA, cs);
        break;
      case Modifier.B:
        dst.bValue = mulMod(BVal, AVal, cs);
        break;
      case Modifier.AB:
        dst.bValue = mulMod(BVal, AA, cs);
        break;
      case Modifier.BA:
        dst.aValue = mulMod(AB, AVal, cs);
        break;
      case Modifier.F:
      case Modifier.I:
        dst.aValue = mulMod(AB, AA, cs);
        dst.bValue = mulMod(BVal, AVal, cs);
        break;
      case Modifier.X:
        dst.bValue = mulMod(BVal, AA, cs);
        dst.aValue = mulMod(AB, AVal, cs);
        break;
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
  }

  private execDIV(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, AB: number, BVal: number, cs: number, wid: number): boolean {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        if (AA === 0) return true;
        dst.aValue = Math.floor(AB / AA);
        break;
      case Modifier.B:
        if (AVal === 0) return true;
        dst.bValue = Math.floor(BVal / AVal);
        break;
      case Modifier.AB:
        if (AA === 0) return true;
        dst.bValue = Math.floor(BVal / AA);
        break;
      case Modifier.BA:
        if (AVal === 0) return true;
        dst.aValue = Math.floor(AB / AVal);
        break;
      case Modifier.F:
      case Modifier.I:
        if (AA !== 0) {
          dst.aValue = Math.floor(AB / AA);
          this.emitCoreAccess(wid, addrB, 'WRITE');
          if (AVal === 0) return true;
          dst.bValue = Math.floor(BVal / AVal);
        } else {
          if (AVal === 0) return true;
          dst.bValue = Math.floor(BVal / AVal);
          this.emitCoreAccess(wid, addrB, 'WRITE');
          return true;
        }
        break;
      case Modifier.X:
        if (AVal !== 0) {
          dst.aValue = Math.floor(AB / AVal);
          this.emitCoreAccess(wid, addrB, 'WRITE');
          if (AA === 0) return true;
          dst.bValue = Math.floor(BVal / AA);
        } else {
          if (AA === 0) return true;
          dst.bValue = Math.floor(BVal / AA);
          this.emitCoreAccess(wid, addrB, 'WRITE');
          return true;
        }
        break;
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
    return false;
  }

  private execMOD(mod: Modifier, addrA: number, addrB: number, AA: number, AVal: number, AB: number, BVal: number, _cs: number, wid: number): boolean {
    this.emitCoreAccess(wid, addrA, 'READ');
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
        if (AA === 0) return true;
        dst.aValue = AB % AA;
        break;
      case Modifier.B:
        if (AVal === 0) return true;
        dst.bValue = BVal % AVal;
        break;
      case Modifier.AB:
        if (AA === 0) return true;
        dst.bValue = BVal % AA;
        break;
      case Modifier.BA:
        if (AVal === 0) return true;
        dst.aValue = AB % AVal;
        break;
      case Modifier.F:
      case Modifier.I:
        if (AA !== 0) {
          dst.aValue = AB % AA;
          this.emitCoreAccess(wid, addrB, 'WRITE');
          if (AVal === 0) return true;
          dst.bValue = BVal % AVal;
        } else {
          if (AVal === 0) return true;
          dst.bValue = BVal % AVal;
          this.emitCoreAccess(wid, addrB, 'WRITE');
          return true;
        }
        break;
      case Modifier.X:
        if (AVal !== 0) {
          dst.aValue = AB % AVal;
          this.emitCoreAccess(wid, addrB, 'WRITE');
          if (AA === 0) return true;
          dst.bValue = BVal % AA;
        } else {
          if (AA === 0) return true;
          dst.bValue = BVal % AA;
          this.emitCoreAccess(wid, addrB, 'WRITE');
          return true;
        }
        break;
    }
    this.emitCoreAccess(wid, addrB, 'WRITE');
    return false;
  }

  private checkJMZ(mod: Modifier, AB: number, BVal: number): boolean {
    switch (mod) {
      case Modifier.A:
      case Modifier.BA:
        return AB === 0;
      case Modifier.B:
      case Modifier.AB:
        return BVal === 0;
      case Modifier.F:
      case Modifier.X:
      case Modifier.I:
        return AB === 0 && BVal === 0;
    }
  }

  private checkJMN(mod: Modifier, AB: number, BVal: number): boolean {
    switch (mod) {
      case Modifier.A:
      case Modifier.BA:
        return AB !== 0;
      case Modifier.B:
      case Modifier.AB:
        return BVal !== 0;
      case Modifier.F:
      case Modifier.X:
      case Modifier.I:
        return AB !== 0 || BVal !== 0;
    }
  }

  private execDJN(mod: Modifier, _addrA: number, addrB: number, AB: number, BVal: number, cs1: number, wid: number): boolean {
    const dst = this.core.get(addrB);
    switch (mod) {
      case Modifier.A:
      case Modifier.BA: {
        dst.aValue--;
        if (dst.aValue < 0) dst.aValue = cs1;
        this.emitCoreAccess(wid, addrB, 'WRITE');
        return AB !== 1;
      }
      case Modifier.B:
      case Modifier.AB: {
        dst.bValue--;
        if (dst.bValue < 0) dst.bValue = cs1;
        this.emitCoreAccess(wid, addrB, 'WRITE');
        return BVal !== 1;
      }
      case Modifier.F:
      case Modifier.I:
      case Modifier.X: {
        dst.bValue--;
        if (dst.bValue < 0) dst.bValue = cs1;
        dst.aValue--;
        if (dst.aValue < 0) dst.aValue = cs1;
        this.emitCoreAccess(wid, addrB, 'WRITE');
        return !(AB === 1 && BVal === 1);
      }
    }
  }

  private checkCMP(mod: Modifier, addrA: number, raddrB: number, AA: number, AVal: number, AB: number, BVal: number): boolean {
    switch (mod) {
      case Modifier.A:
        return AB === AA;
      case Modifier.B:
        return BVal === AVal;
      case Modifier.AB:
        return BVal === AA;
      case Modifier.BA:
        return AB === AVal;
      case Modifier.F:
        return AB === AA && BVal === AVal;
      case Modifier.X:
        return BVal === AA && AB === AVal;
      case Modifier.I: {
        const a = this.core.get(addrA);
        const b = this.core.get(raddrB);
        return a.opcode === b.opcode && a.aMode === b.aMode && a.bMode === b.bMode &&
               AA === AB && AVal === BVal;
      }
    }
  }

  private checkSLT(mod: Modifier, AA: number, AVal: number, AB: number, BVal: number): boolean {
    switch (mod) {
      case Modifier.A:
        return AA < AB;
      case Modifier.B:
        return AVal < BVal;
      case Modifier.AB:
        return AA < BVal;
      case Modifier.BA:
        return AVal < AB;
      case Modifier.F:
      case Modifier.I:
        return AA < AB && AVal < BVal;
      case Modifier.X:
        return AA < BVal && AVal < AB;
    }
  }

  private execLDP(mod: Modifier, _addrA: number, addrB: number, AA: number, AVal: number, w: SimWarrior, _cs: number): void {
    const ps = this.pSpaces[w.pSpaceIndex];
    const dst = this.core.get(addrB);
    // Helper: get pspace value, using warrior's lastResult for index 0
    const pget = (index: number): number => {
      if (index % ps.size === 0) return w.lastResult;
      return ps.get(index);
    };
    switch (mod) {
      case Modifier.A:
        dst.aValue = pget(AA);
        break;
      case Modifier.B:
      case Modifier.F:
      case Modifier.X:
      case Modifier.I:
        dst.bValue = pget(AVal);
        break;
      case Modifier.AB:
        dst.bValue = pget(AA);
        break;
      case Modifier.BA:
        dst.aValue = pget(AVal);
        break;
    }
    this.emitCoreAccess(w.id, addrB, 'WRITE');
  }

  private execSTP(mod: Modifier, _addrA: number, _addrB: number, AA: number, AVal: number, AB: number, BVal: number, w: SimWarrior, _cs: number): void {
    const ps = this.pSpaces[w.pSpaceIndex];
    // C's set_pspace macro writes to W->lastResult for index 0, not ps->lastResult
    const pset = (index: number, value: number): void => {
      if (index % ps.size === 0) {
        w.lastResult = value;
      } else {
        ps.set(index, value);
      }
    };
    switch (mod) {
      case Modifier.A:
        pset(AB, AA);
        break;
      case Modifier.B:
      case Modifier.F:
      case Modifier.X:
      case Modifier.I:
        pset(BVal, AVal);
        break;
      case Modifier.AB:
        pset(BVal, AA);
        break;
      case Modifier.BA:
        pset(AB, AVal);
        break;
    }
  }

  getCore(): Core {
    return this.core;
  }

  getWarriors(): SimWarrior[] {
    return this.warriors;
  }
}
