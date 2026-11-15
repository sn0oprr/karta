import {
  AVATAR_COLORS,
  CHARACTERS,
  DRINKS,
  NAME_MAX,
  type Profile,
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
}

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function load(): StoredProfile {
  // Players who never picked a character or a drink get a random one (kept once saved).
  const look = {
    character: randomOf(CHARACTERS).id,
    skin: Math.floor(Math.random() * SKIN_TONES.length),
    drink: randomOf(DRINKS).id,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredProfile>;
      if (typeof p.secret === 'string' && p.secret.length >= 16) {
        return {
          secret: p.secret,
          name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, NAME_MAX) : NAMES[0]!,
          color: Number.isInteger(p.color) && p.color! >= 0 && p.color! < AVATAR_COLORS.length ? p.color! : 0,
          character: isCharacter(p.character) ? p.character : look.character,
          skin: isSkin(p.skin) ? p.skin : look.skin,
          drink: isDrink(p.drink) ? p.drink : look.drink,
          named: !!p.named,
        };
      }
    }
  } catch {
    /* storage unavailable */
  }
  return {
    secret: randomSecret(),
    name: NAMES[Math.floor(Math.random() * NAMES.length)]!,
    color: Math.floor(Math.random() * AVATAR_COLORS.length),
    ...look,
    named: false,
  };
}

export const profile: StoredProfile = load();

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
