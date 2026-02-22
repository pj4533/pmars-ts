import { rng } from '../utils/rng.js';

const RETRIES1 = 20;
const RETRIES2 = 4;

export interface PositionResult {
  positions: number[];
  seed: number;
}

export function positionWarriors(
  warriorCount: number,
  coreSize: number,
  separation: number,
  seed: number,
): PositionResult {
  const positions = new Array(warriorCount).fill(0);
  if (warriorCount <= 1) return { positions, seed };

  if (warriorCount === 2) {
    const range = coreSize + 1 - (separation << 1);
    positions[1] = separation + seed % range;
    seed = rng(seed);
    return { positions, seed };
  }

  // Multi-warrior positioning: try posit(), fall back to npos()
  const result = posit(warriorCount, coreSize, separation, seed, positions);
  if (result.success) {
    return { positions: result.positions, seed: result.seed };
  }
  return npos(warriorCount, coreSize, separation, result.seed, positions);
}

function posit(
  warriorCount: number,
  coreSize: number,
  separation: number,
  seed: number,
  positions: number[],
): { success: boolean; positions: number[]; seed: number } {
  let pos = 1;
  let retries1 = RETRIES1;
  let retries2 = RETRIES2;

  do {
    seed = rng(seed);
    positions[pos] = (seed % (coreSize - 2 * separation + 1)) + separation;

    let overlap = false;
    let overlapIdx = pos;
    for (let i = 1; i < pos; i++) {
      let diff = positions[pos] - positions[i];
      if (diff < 0) diff = -diff;
      if (diff < separation) {
        overlap = true;
        overlapIdx = i;
        break;
      }
    }

    if (!overlap) {
      pos++;
    } else {
      if (retries2 === 0) return { success: true, positions, seed }; // exceeded
      if (retries1 === 0) {
        pos = overlapIdx;
        retries2--;
        retries1 = RETRIES1;
      } else {
        retries1--;
      }
    }
  } while (pos < warriorCount);

  return { success: false, positions, seed };
}

function npos(
  warriorCount: number,
  coreSize: number,
  separation: number,
  seed: number,
  positions: number[],
): PositionResult {
  const room = coreSize - separation * warriorCount + 1;

  for (let i = 1; i < warriorCount; i++) {
    seed = rng(seed);
    const temp = seed % room;
    let j: number;
    for (j = i - 1; j > 0; j--) {
      if (temp > positions[j]) break;
      positions[j + 1] = positions[j];
    }
    positions[j + 1] = temp;
  }

  let tempSep = separation;
  for (let i = 1; i < warriorCount; i++) {
    positions[i] += tempSep;
    tempSep += separation;
  }

  for (let i = 1; i < warriorCount; i++) {
    seed = rng(seed);
    const j = (seed % (warriorCount - i)) + i;
    const tmp = positions[j];
    positions[j] = positions[i];
    positions[i] = tmp;
  }

  return { positions, seed };
}
