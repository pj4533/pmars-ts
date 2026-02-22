/**
 * pmars Lehmer RNG (Park-Miller minimal standard)
 * "minimal standard random number generator; integer version 2"
 * Communications of the ACM, 31:10 (1988)
 * Returns 1 <= seed <= 2^31-2, cycle: 2^31-2
 */
export function rng(seed: number): number {
  let temp = seed;
  temp = 16807 * (temp % 127773) - 2836 * Math.floor(temp / 127773);
  if (temp < 0) temp += 2147483647;
  return temp;
}
