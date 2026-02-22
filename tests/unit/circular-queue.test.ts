import { describe, it, expect } from 'vitest';
import { CircularQueue } from '../../src/utils/circular-queue';

describe('CircularQueue', () => {
  it('push and pop basic', () => {
    const q = new CircularQueue(10);
    q.push(1);
    q.push(2);
    q.push(3);
    expect(q.size).toBe(3);
    expect(q.pop()).toBe(1);
    expect(q.pop()).toBe(2);
    expect(q.pop()).toBe(3);
    expect(q.size).toBe(0);
  });

  it('wraps around correctly', () => {
    const q = new CircularQueue(4);
    q.push(1);
    q.push(2);
    q.push(3);
    q.pop(); // remove 1
    q.pop(); // remove 2
    q.push(4);
    q.push(5);
    expect(q.pop()).toBe(3);
    expect(q.pop()).toBe(4);
    expect(q.pop()).toBe(5);
  });

  it('peek returns front without removing', () => {
    const q = new CircularQueue(10);
    q.push(42);
    q.push(99);
    expect(q.peek()).toBe(42);
    expect(q.size).toBe(2);
  });

  it('empty property', () => {
    const q = new CircularQueue(10);
    expect(q.empty).toBe(true);
    q.push(1);
    expect(q.empty).toBe(false);
    q.pop();
    expect(q.empty).toBe(true);
  });

  it('clear resets the queue', () => {
    const q = new CircularQueue(10);
    q.push(1);
    q.push(2);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.empty).toBe(true);
  });

  it('toArray returns elements in order', () => {
    const q = new CircularQueue(10);
    q.push(10);
    q.push(20);
    q.push(30);
    expect(q.toArray()).toEqual([10, 20, 30]);
  });

  it('toArray works after wrap-around', () => {
    const q = new CircularQueue(4);
    q.push(1);
    q.push(2);
    q.push(3);
    q.pop();
    q.pop();
    q.push(4);
    q.push(5);
    expect(q.toArray()).toEqual([3, 4, 5]);
  });
});
