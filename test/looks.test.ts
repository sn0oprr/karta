import { describe, expect, it } from 'vitest';
import { defaultLook } from '../src/server/manager';
import { CHARACTERS, CREW, REGULARS, isCharacter, isCrew } from '../src/shared/protocol';

describe('café characters', () => {
  it('lists the regulars and the crew, each once', () => {
    expect(CHARACTERS).toHaveLength(REGULARS.length + CREW.length);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    for (const c of CREW) expect(isCharacter(c.id) && isCrew(c.id)).toBe(true);
    for (const c of REGULARS) expect(isCrew(c.id)).toBe(false);
  });

  it('never hands out one of the crew as a default look', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(defaultLook(`player-${i}`).character);
    expect([...seen].filter(isCrew)).toEqual([]);
    expect(seen.size).toBe(REGULARS.length);
  });
});
