import { CircularQueue } from '../utils/circular-queue.js';
import { type WarriorData, type WarriorState } from '../types.js';

export class SimWarrior {
  id: number;
  name: string;
  author: string;
  processQueue: CircularQueue;
  position: number;
  startOffset: number;
  tasks: number;
  score: number[];
  lastResult: number;
  pSpaceIndex: number;
  pSpaceIDNumber: number;
  alive: boolean;

  constructor(id: number, data: WarriorData, maxProcesses: number, maxWarriors: number, coreSize: number) {
    this.id = id;
    this.name = data.name || 'Unknown';
    this.author = data.author || 'Anonymous';
    this.processQueue = new CircularQueue(maxProcesses + 1);
    this.position = 0;
    this.startOffset = data.startOffset;
    this.tasks = 0;
    this.score = new Array(maxWarriors * 2 - 1).fill(0);
    this.lastResult = coreSize - 1;
    this.pSpaceIndex = id;
    this.pSpaceIDNumber = data.pin ?? id;
    this.alive = true;
  }

  reset(position: number, coreSize: number): void {
    this.processQueue.clear();
    this.position = position;
    const startAddr = (position + this.startOffset) % coreSize;
    this.processQueue.push(startAddr < 0 ? startAddr + coreSize : startAddr);
    this.tasks = 1;
    this.alive = true;
  }

  pushProcess(addr: number): void {
    this.processQueue.push(addr);
  }

  popProcess(): number {
    return this.processQueue.pop();
  }

  getState(): WarriorState {
    return {
      id: this.id,
      name: this.name,
      author: this.author,
      tasks: this.tasks,
      processQueue: this.processQueue.toArray(),
      position: this.position,
      startOffset: this.startOffset,
      score: [...this.score],
      lastResult: this.lastResult,
      pSpaceIndex: this.pSpaceIndex,
      pSpaceIDNumber: this.pSpaceIDNumber,
      alive: this.alive,
    };
  }
}
