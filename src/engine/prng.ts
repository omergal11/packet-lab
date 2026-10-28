// mulberry32: a fast, small seeded PRNG. Same seed always produces the same sequence,
// which makes every simulation run reproducible from its seed alone.
export function mulberry32(seed: number): () => number {
  // Treat the seed as an unsigned 32-bit integer to avoid signed-integer quirks.
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// murmur3's 32-bit finalizer: scrambles every input bit into every output bit.
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Combines several integers into one well-mixed 32-bit seed.
// Order matters: (1, 2) and (2, 1) give different results, because the running
// hash is scrambled again after each value is mixed in.
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9; // arbitrary non-zero start (the golden-ratio constant)
  for (const v of values) h = fmix32(h ^ Math.imul(v >>> 0, 0x9e3779b1));
  return h;
}
