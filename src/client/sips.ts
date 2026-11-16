/**
 * Finds the individual sips (or chicha puffs) in a drinking recording, by loudness.
 */

export interface SipSettings {
  /** Loudness (dB below the clip's loudest moment) that counts as part of a sip. */
  threshold: number;
  /** Quieter gaps shorter than this (s) stay inside one sip. */
  gap: number;
  /** Longest sip played (s). */
  maxLen: number;
}

export interface Sip {
  /** Offset in the recording (s). */
  start: number;
  /** Length (s). */
  dur: number;
}

/** Loudness the sips are brought to (RMS while sipping, dBFS). */
const TARGET_DB = -17;
const WINDOW = 0.02;

/** Splits a recording into sips: runs of sound above the threshold, with short gaps bridged. */
export function findSips(channels: Float32Array[], sampleRate: number, src: SipSettings): { sips: Sip[]; gain: number } {
  const length = channels[0]?.length ?? 0;
  const duration = length / sampleRate;
  const win = Math.max(1, Math.round(sampleRate * WINDOW));
  const n = Math.floor(length / win);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (const d of channels) for (let i = w * win; i < (w + 1) * win; i++) sum += d[i]! * d[i]!;
    rms[w] = Math.sqrt(sum / (win * channels.length));
    if (rms[w]! > peak) peak = rms[w]!;
  }
  if (peak <= 0) return { sips: [{ start: 0, dur: Math.min(duration, src.maxLen) }], gain: 1 };
  const threshold = peak * 10 ** (src.threshold / 20);
  const runs: [number, number][] = [];
  let start = -1;
  for (let w = 0; w <= n; w++) {
    const loud = w < n && rms[w]! >= threshold;
    if (loud && start < 0) start = w;
    else if (!loud && start >= 0) {
      const last = runs[runs.length - 1];
      if (last && (start - last[1]) * WINDOW <= src.gap) last[1] = w;
      else runs.push([start, w]);
      start = -1;
    }
  }
  const sips: Sip[] = runs
    // Clicks and knocks are too short to be a sip.
    .filter(([a, b]) => (b - a) * WINDOW >= 0.15)
    .map(([a, b]) => ({ start: Math.max(0, a * WINDOW - 0.12), end: Math.min(duration, b * WINDOW + 0.3) }))
    .map((s) => ({ start: s.start, dur: Math.min(src.maxLen, s.end - s.start) }));
  if (sips.length === 0) sips.push({ start: 0, dur: Math.min(duration, src.maxLen) });
  // Loudness while sipping, to even out the four recordings.
  let sum = 0;
  let count = 0;
  for (const s of sips) {
    const from = Math.floor(s.start / WINDOW);
    const to = Math.min(n, Math.ceil((s.start + s.dur) / WINDOW));
    for (let w = from; w < to; w++) {
      sum += rms[w]! * rms[w]!;
      count++;
    }
  }
  const level = count ? 20 * Math.log10(Math.sqrt(sum / count) + 1e-9) : TARGET_DB;
  const gain = Math.min(4, Math.max(0.25, 10 ** ((TARGET_DB - level) / 20)));
  return { sips, gain };
}
