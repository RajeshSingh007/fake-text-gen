// Seeded pseudo-random number generator + sampling helpers.
// Determinism guarantee: same seed -> identical stream, forever, on any machine.

/** mulberry32 — tiny, fast, deterministic PRNG. Returns a function → [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Uniform pick from an array. */
export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Integer in [min, max] inclusive. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Weighted index via linear scan over cumulative weights.
 * Popular options appear far more often (Zipf/power-law realism).
 */
export function weightedIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    if ((r -= weights[i]) < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Bell-ish value in [min, max] via central-limit averaging.
 * Most results cluster near the middle (realistic prices, ages, quantities).
 */
export function bell(rng: Rng, min: number, max: number): number {
  const t = (rng() + rng() + rng()) / 3;
  return min + t * (max - min);
}
