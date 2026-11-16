import {
  AVATAR_COLORS,
  CREW,
  DRINKS,
  NAME_MAX,
  type Profile,
  REGULARS,
  SKIN_TONES,
  isCharacter,
  isDrink,
  isSkin,
} from '../shared/protocol';

const KEY = 'karta.profile.v1';

const NAMES = ['Hamma', 'Salha', 'Bechir', 'Zeineb', 'Lotfi', 'Najet', 'Fethi', 'Rym', 'Slim', 'Amel', 'Kais', 'Ines', 'Sami', 'Hela'];

export interface StoredProfile extends Profile {
  secret: string;
  /** Has the player confirmed their name at least once? */
  named: boolean;
  /** Did the player type their name (rather than keep the one they were given)? */
  typed: boolean;
}

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** The name a player gets until they type one (the same one every time). */
function givenName(secret: string): string {
  let h = 0;
  for (let i = 0; i < secret.length; i++) h = (Math.imul(h, 31) + secret.charCodeAt(i)) >>> 0;
  return NAMES[h % NAMES.length]!;
}

function load(): StoredProfile {
  // Players who never picked a character or a drink get a random one (kept once saved); never
  // one of the crew, who are real people.
  const look = {
    character: randomOf(REGULARS).id,
    skin: Math.floor(Math.random() * SKIN_TONES.length),
    drink: randomOf(DRINKS).id,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredProfile>;
      if (typeof p.secret === 'string' && p.secret.length >= 16) {
        const name = typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, NAME_MAX) : givenName(p.secret);
        return {
          secret: p.secret,
          name,
          color: Number.isInteger(p.color) && p.color! >= 0 && p.color! < AVATAR_COLORS.length ? p.color! : 0,
          character: isCharacter(p.character) ? p.character : look.character,
          skin: isSkin(p.skin) ? p.skin : look.skin,
          drink: isDrink(p.drink) ? p.drink : look.drink,
          named: !!p.named,
          // (Saved before this flag existed: a name from the list was given, anything else typed.)
          typed: typeof p.typed === 'boolean' ? p.typed : !NAMES.includes(name),
        };
      }
    }
  } catch {
    /* storage unavailable */
  }
  const secret = randomSecret();
  return {
    secret,
    name: givenName(secret),
    color: Math.floor(Math.random() * AVATAR_COLORS.length),
    ...look,
    named: false,
    typed: false,
  };
}

export const profile: StoredProfile = load();

/**
 * Picking one of the crew also gives you their name, unless you typed your own; leaving them
 * gives you back the name you had.
 */
export function withDefaultName(patch: Partial<StoredProfile>): Partial<StoredProfile> {
  const next = patch.character;
  if (!next || next === profile.character || profile.typed) return patch;
  const crew = CREW.find((c) => c.id === next);
  if (crew) return { ...patch, name: crew.name };
  if (CREW.some((c) => c.id === profile.character && c.name === profile.name)) return { ...patch, name: givenName(profile.secret) };
  return patch;
}

export function saveProfile(patch: Partial<StoredProfile>) {
  Object.assign(profile, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

saveProfile({});

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`karta.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`karta.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
