import { describe, expect, it } from 'vitest';
import { findSips } from '../src/client/sips';

const SR = 8000;

/** Noise bursts at the given [start, end] times (s), silence elsewhere. */
function recording(length: number, bursts: [number, number, number?][]): Float32Array {
  const data = new Float32Array(Math.round(length * SR));
  let seed = 7;
  for (const [a, b, amp = 0.5] of bursts) {
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647 - 0.5) * 2 * amp;
    }
  }
  return data;
}

describe('findSips', () => {
  const settings = { threshold: -20, gap: 0.4, maxLen: 2.5 };

  it('finds each sip, padded a little, and bridges short pauses inside a sip', () => {
    const data = recording(12, [
      [1, 2],
      // One sip with a short breath in the middle.
      [4, 4.6],
      [4.8, 5.5],
      [8, 9],
    ]);
    const { sips } = findSips([data], SR, settings);
    expect(sips).toHaveLength(3);
    expect(sips[0]!.start).toBeCloseTo(0.88, 1);
    expect(sips[0]!.dur).toBeCloseTo(1.42, 1);
    expect(sips[1]!.start).toBeCloseTo(3.88, 1);
    expect(sips[1]!.dur).toBeGreaterThan(1.5);
  });

  it('ignores clicks and caps long sips', () => {
    const data = recording(10, [
      [1, 1.05],
      [3, 8],
    ]);
    expect(findSips([data], SR, settings).sips).toEqual([{ start: expect.closeTo(2.88, 1), dur: 2.5 }]);
  });

  it('turns quiet recordings up and loud ones down', () => {
    const quiet = findSips([recording(6, [[1, 3, 0.03]])], SR, settings);
    const loud = findSips([recording(6, [[1, 3, 0.9]])], SR, settings);
    expect(quiet.gain).toBeGreaterThan(1);
    expect(loud.gain).toBeLessThan(1);
  });

  it('plays the start of a silent recording rather than nothing', () => {
    const { sips, gain } = findSips([new Float32Array(SR * 5)], SR, settings);
    expect(sips).toEqual([{ start: 0, dur: 2.5 }]);
    expect(gain).toBe(1);
  });
});
