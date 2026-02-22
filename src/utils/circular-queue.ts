export class CircularQueue {
  private buffer: number[];
  private head: number;
  private tail: number;
  private capacity: number;
  private _size: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(0);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }

  push(value: number): void {
    this.buffer[this.tail] = value;
    this.tail = (this.tail + 1) % this.capacity;
    this._size++;
  }

  pop(): number {
    const value = this.buffer[this.head];
    this.head = (this.head + 1) % this.capacity;
    this._size--;
    return value;
  }

  peek(): number {
    return this.buffer[this.head];
  }

  get size(): number {
    return this._size;
  }

  get empty(): boolean {
    return this._size === 0;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }

  toArray(): number[] {
    const result: number[] = [];
    let idx = this.head;
    for (let i = 0; i < this._size; i++) {
      result.push(this.buffer[idx]);
      idx = (idx + 1) % this.capacity;
    }
    return result;
  }
}
