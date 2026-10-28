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
