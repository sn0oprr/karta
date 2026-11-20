/**
 * Drinking sounds for the café orders. Each recording holds several sips (or chicha puffs):
 * they are found by loudness once decoded, so every tap plays one natural sip and repeated
 * taps vary. Levels are evened out between the four recordings.
 */
import type { DrinkId } from '../shared/protocol';
import bogaUrl from './assets/sounds/boga.mp3';
import chichaUrl from './assets/sounds/chicha.mp3';
import expressUrl from './assets/sounds/express.mp3';
import teaUrl from './assets/sounds/tea.mp3';
import { sfx } from './sfx';
import { type Sip, type SipSettings, findSips } from './sips';

interface Source extends SipSettings {
  url: string;
  /** Sip length used for the animation when the sound cannot play (s). */
  fallback: number;
}

interface Clip {
  buffer: AudioBuffer;
  sips: Sip[];
  gain: number;
}

const SOURCES: Record<DrinkId, Source> = {
  express: { url: expressUrl, threshold: -13, gap: 0.35, maxLen: 2.6, fallback: 1.5 },
  tea: { url: teaUrl, threshold: -14, gap: 0.45, maxLen: 2.4, fallback: 1.4 },
  chicha: { url: chichaUrl, threshold: -22, gap: 0.6, maxLen: 2.6, fallback: 1.9 },
  boga: { url: bogaUrl, threshold: -30, gap: 1.0, maxLen: 2.6, fallback: 1.7 },
};

class DrinkAudio {
  private bytes = new Map<DrinkId, Promise<ArrayBuffer | null>>();
  private clips = new Map<DrinkId, Promise<Clip | null>>();
  private last = new Map<DrinkId, number>();

  /** Starts downloading a drink's sound (cheap to call often). */
  prefetch(id: DrinkId) {
    if (this.bytes.has(id)) return;
    this.bytes.set(
      id,
      fetch(SOURCES[id].url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
    );
  }

  private clip(id: DrinkId): Promise<Clip | null> {
    const ctx = sfx.context;
    if (!ctx) return Promise.resolve(null);
    let p = this.clips.get(id);
    if (!p) {
      this.prefetch(id);
      p = this.bytes.get(id)!.then(async (bytes) => {
        if (!bytes) return null;
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        return { buffer, ...findSips(channels, buffer.sampleRate, SOURCES[id]) };
      });
      // A failed download or decode may work next time.
      p = p.catch(() => null).then((c) => {
        if (!c) this.clips.delete(id);
        return c;
      });
      this.clips.set(id, p);
    }
    return p;
  }

  /** Plays one sip of `id`; resolves with its length (s) once it starts, or a typical length if it cannot play. */
  async play(id: DrinkId, o: { pan?: number; volume?: number } = {}): Promise<number> {
    const src = SOURCES[id];
    if (document.hidden) return src.fallback;
    const clip = await Promise.race([this.clip(id), new Promise<null>((r) => setTimeout(() => r(null), 900))]);
    if (!clip) return src.fallback;
    // A different sip from last time.
    let i = Math.floor(Math.random() * clip.sips.length);
    if (clip.sips.length > 1 && i === this.last.get(id)) i = (i + 1) % clip.sips.length;
    this.last.set(id, i);
    const sip = clip.sips[i]!;
    sfx.playBuffer(clip.buffer, { offset: sip.start, duration: sip.dur, gain: clip.gain * (o.volume ?? 1), pan: o.pan });
    return sip.dur;
  }
}

export const drinkAudio = new DrinkAudio();
