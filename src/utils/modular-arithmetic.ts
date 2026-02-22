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
