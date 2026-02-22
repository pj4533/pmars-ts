export function computePSpaceSize(coreSize: number): number {
  for (let i = 16; i >= 1; i--) {
    if (coreSize % i === 0) return Math.floor(coreSize / i);
  }
  return coreSize; // fallback
}

export class PSpace {
  private space: number[];
  readonly size: number;
  lastResult: number;

  constructor(size: number, coreSize: number) {
    this.size = size;
    this.space = new Array(size).fill(0);
    this.lastResult = coreSize - 1;
  }

  get(index: number): number {
    const idx = index % this.size;
    if (idx === 0) return this.lastResult;
    return this.space[idx];
  }

  set(index: number, value: number): void {
    const idx = index % this.size;
    if (idx === 0) {
      this.lastResult = value;
    } else {
      this.space[idx] = value;
    }
  }

  clear(): void {
    this.space.fill(0);
  }

  clearKeepResult(): void {
    this.space.fill(0);
  }
}
