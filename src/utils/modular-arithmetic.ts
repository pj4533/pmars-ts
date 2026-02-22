export function addMod(a: number, b: number, m: number): number {
  const sum = a + b;
  return sum >= m ? sum - m : sum;
}

export function subMod(a: number, b: number, m: number): number {
  const diff = a - b;
  return diff < 0 ? diff + m : diff;
}

export function normalize(value: number, m: number): number {
  let v = value % m;
  if (v < 0) v += m;
  return v === 0 ? 0 : v; // avoid -0
}

/**
 * Safe modular multiplication that avoids overflow for large core sizes.
 * Regular JS multiplication can lose precision for values > ~94M (sqrt(2^53)).
 */
export function mulMod(a: number, b: number, m: number): number {
  if (a < 94906265 && b < 94906265) {
    return (a * b) % m;
  }
  return Number((BigInt(a) * BigInt(b)) % BigInt(m));
}
