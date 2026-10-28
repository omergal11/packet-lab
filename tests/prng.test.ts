import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/prng.js';

describe('mulberry32', () => {
  it('produces values in [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed produces the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it('different seeds produce different sequences', () => {
    const seqA = Array.from({ length: 20 }, mulberry32(1));
    const seqB = Array.from({ length: 20 }, mulberry32(2));
    expect(seqA).not.toEqual(seqB);
  });

  it('sequences do not repeat within a reasonable run', () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(rng());
    // Chance of a collision in 100 draws from a 2^32-value space is negligible
    expect(seen.size).toBe(100);
  });
});
