/**
 * Karta card artwork — pure Canvas-2D drawing for the 40-card Tunisian deck (Chkobba),
 * the 32-card Belote deck (7 to Ace) and the card back. No images and no network: everything is vector paths, gradients
 * and the app's @fontsource faces ("Lilita One" / "Fredoka") for numerals.
 *
 * Every measurement is relative to the card size (w × h), so the same code renders
 * crisp 320×480 textures for the 3D table and tiny thumbnails for the DOM UI.
 *
 * Art direction: modern cartoon, cream paper, ink outlines (#1d1b2e), Sidi Bou Said blue,
 * gold accents, khatem (8-pointed star) ornaments, chechia-wearing court figures.
 */
import { type Card, type Suit, parseCard } from '../../shared/cards';
import { type BCard, isBeloteCardId, parseBeloteCard } from '../../shared/belote';

// ------------------------------------------------------------------ faces ---
export type FaceRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/** What a card face shows. Both games' cards map onto it. */
export interface CardFace {
  suit: Suit;
  rank: FaceRank;
  /** Chkobba figures carry their value (Q 8, J 9, K 10) on a gold coin under the index. */
  coin?: number;
  /** Chkobba's golden 7♦, Sab'a el Haya. */
  golden?: boolean;
}

export function chkobbaFace(card: Card): CardFace {
  const figures: Partial<Record<number, FaceRank>> = { 1: 'A', 8: 'Q', 9: 'J', 10: 'K' };
  return {
    suit: card.suit,
    rank: figures[card.rank] ?? (String(card.rank) as FaceRank),
    coin: card.rank >= 8 ? card.rank : undefined,
    golden: card.rank === 7 && card.suit === 'D',
  };
}

export function beloteFace(card: BCard): CardFace {
  return { suit: card.suit, rank: card.rank };
}

/** The face of a card of either game, from its id (Chkobba's "7D", Belote's "D7"). */
export function faceOf(id: string): CardFace {
  return isBeloteCardId(id) ? beloteFace(parseBeloteCard(id)) : chkobbaFace(parseCard(id));
}

/** Pips on a number card (0 for the ace and the figures). */
function pipCount(face: CardFace): number {
  const n = Number(face.rank);
  return Number.isInteger(n) && n >= 2 ? n : 0;
}

/** Card width / height. */
export const CARD_ASPECT = 2 / 3;
/** Corner radius as a fraction of the card WIDTH. */
export const CARD_CORNER = 0.07;

type Ctx = CanvasRenderingContext2D;
type Paint = string | CanvasGradient;
type Stops = ReadonlyArray<readonly [number, string]>;

// ---------------------------------------------------------------- palette ---
const INK = '#1d1b2e';
const RED = '#D7263D';
const NAVY = '#1F2340';
const PAPER_HI = '#FFF8EC';
const PAPER_LO = '#F6E9D2';
const BORDER = '#D8B57E';
const SBS_BLUE = '#1E5AA8';
const BACK_BLUE = '#1F5FAE';
const CREAM = '#FFF3DC';
const GOLD = '#F6BE32';
const GOLD_HI = '#FFE699';
const GOLD_LO = '#D08A12';
const GOLD_INK = '#6E3F00';
const SKIN = '#F5C7A1';
const SKIN_HI = '#FCDCC0';
const SKIN_LO = '#E3A47E';
const BLUSH = 'rgba(244, 104, 112, 0.45)';
const CHECHIA = '#D8302B';
const CHECHIA_HI = '#F05B4C';
const CHECHIA_LO = '#A51B22';
const TASSEL = '#25222f';
const SHIRT = '#FFF9EE';
const HAIR_Q = '#3A2232';
const HAIR_Q_HI = '#6E4762';
const HAIR_J = '#3B261E';
const BEARD_LO = '#D8D2C8';
const MOUTH = '#7B2132';
const TONGUE = '#F27D8A';
const LIPS = '#D8435E';
const LEAF = '#4FAF5C';

const FONT_STACK = '"Lilita One", "Fredoka", system-ui, sans-serif';

// ------------------------------------------------------------ colour utils ---
function hexRgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let s = m[1]!;
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  if (!x || !y) return a;
  const r = Math.round(x[0] + (y[0] - x[0]) * t);
  const g = Math.round(x[1] + (y[1] - x[1]) * t);
  const bl = Math.round(x[2] + (y[2] - x[2]) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

const lighten = (c: string, t: number): string => mix(c, '#ffffff', t);
const darken = (c: string, t: number): string => mix(c, '#000000', t);

function rgba(c: string, a: number): string {
  const x = hexRgb(c);
  return x ? `rgba(${x[0]},${x[1]},${x[2]},${a})` : c;
}

// ---------------------------------------------------------- path helpers ---
function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function cardPath(ctx: Ctx, w: number, h: number): void {
  roundRectPath(ctx, 0, 0, w, h, CARD_CORNER * w);
}

/** Adds a closed ellipse sub-path (no connecting line to the previous sub-path). */
function ellipsePath(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  const ax = Math.max(0.01, rx);
  const ay = Math.max(0.01, ry);
  ctx.moveTo(x + ax * Math.cos(rot), y + ax * Math.sin(rot));
  ctx.ellipse(x, y, ax, ay, rot, 0, Math.PI * 2);
  ctx.closePath();
}

function circlePath(ctx: Ctx, x: number, y: number, r: number): void {
  const rr = Math.max(0.01, r);
  ctx.moveTo(x + rr, y);
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.closePath();
}

/** Outline of the 8-pointed khatem star (union of two squares); points at rot + k·45°. */
function khatemPath(ctx: Ctx, cx: number, cy: number, R: number, rot = 0): void {
  const ri = (R * Math.cos(Math.PI / 4)) / Math.cos(Math.PI / 8);
  for (let k = 0; k < 16; k++) {
    const a = rot + (k * Math.PI) / 8;
    const r = k % 2 === 0 ? R : ri;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The two interlaced squares of a khatem as separate sub-paths. */
function khatemSquaresPath(ctx: Ctx, cx: number, cy: number, R: number, rot = 0): void {
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < 4; k++) {
      const a = rot + (s * Math.PI) / 4 + (k * Math.PI) / 2;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/** Eight-pointed twinkle: long points on the axes, short ones on the diagonals. */
function twinklePath(ctx: Ctx, x: number, y: number, r: number): void {
  for (let k = 0; k < 16; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 8;
    const rr = k % 4 === 0 ? r : k % 2 === 0 ? r * 0.56 : r * 0.3;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawTwinkle(ctx: Ctx, x: number, y: number, r: number, lw: number): void {
  ctx.beginPath();
  twinklePath(ctx, x, y, r);
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = GOLD_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.18, GOLD_HI);
  g.addColorStop(0.5, GOLD);
  g.addColorStop(1, '#E39A12');
  ctx.fillStyle = g;
  ctx.fill();
}

// ------------------------------------------------------------------ fonts ---
function fontFaceLoaded(family: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return false;
  let found = false;
  try {
    document.fonts.forEach((face) => {
      if (!found && face.status === 'loaded' && face.family.replace(/["']/g, '').trim() === family) {
        found = true;
      }
    });
  } catch {
    return false;
  }
  return found;
}

/** Font for indices / numerals. Lilita One is a single (bold) weight; if it is not
 *  available we ask the fallbacks for a bold weight so numbers stay chunky. */
function numberFont(px: number): string {
  const size = Math.max(1, Math.round(px * 100) / 100);
  return `${fontFaceLoaded('Lilita One') ? 400 : 700} ${size}px ${FONT_STACK}`;
}

/**
 * Resolves once the card fonts are loaded (or after ~2.5 s, or immediately when the
 * Font Loading API is unavailable). Never rejects. Draw card textures after this.
 */
export function ensureCardFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  let loads: Promise<unknown>;
  try {
    const set = document.fonts;
    const sample = 'AJQK0123456789';
    loads = Promise.all([
      set.load('400 64px "Lilita One"', sample),
      set.load('400 64px "Fredoka"', sample),
      set.load('700 64px "Fredoka"', sample),
    ]);
  } catch {
    return Promise.resolve();
  }
  const settled = loads.then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  return Promise.race([settled, timeout]);
}

interface FittedText {
  font: string;
  asc: number;
  desc: number;
  left: number;
  right: number;
}

/** Picks a font size so the glyphs' ascent equals capH (shrunk to fit maxW if given). */
function fitText(ctx: Ctx, text: string, capH: number, maxW = 0): FittedText {
  ctx.font = numberFont(100);
  const m0 = ctx.measureText(text);
  const asc0 = m0.actualBoundingBoxAscent > 0 ? m0.actualBoundingBoxAscent : 72;
  let px = (100 * capH) / asc0;
  const w0 = ((m0.actualBoundingBoxLeft + m0.actualBoundingBoxRight) * px) / 100;
  if (maxW > 0 && w0 > maxW) px *= maxW / w0;
  const font = numberFont(px);
  ctx.font = font;
  const m = ctx.measureText(text);
  return {
    font,
    asc: m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : (asc0 * px) / 100,
    desc: Math.max(0, m.actualBoundingBoxDescent || 0),
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
  };
}

// ------------------------------------------------------------------ suits ---
export function suitColor(suit: Suit): string {
  return suit === 'H' || suit === 'D' ? RED : NAVY;
}

/** Builds the suit outline centred on (cx, cy); s is the symbol height. */
function suitPath(ctx: Ctx, suit: Suit, cx: number, cy: number, s: number): void {
  const X = (v: number): number => cx + v * s;
  const Y = (v: number): number => cy + v * s;
  const C = (a: number, b: number, c: number, d: number, e: number, f: number): void =>
    ctx.bezierCurveTo(X(a), Y(b), X(c), Y(d), X(e), Y(f));
  ctx.beginPath();
  switch (suit) {
    case 'H': {
      ctx.moveTo(X(0), Y(-0.29));
      C(-0.06, -0.44, -0.18, -0.5, -0.29, -0.5);
      C(-0.45, -0.5, -0.545, -0.37, -0.545, -0.2);
      C(-0.545, 0.04, -0.33, 0.22, 0, 0.5);
      C(0.33, 0.22, 0.545, 0.04, 0.545, -0.2);
      C(0.545, -0.37, 0.45, -0.5, 0.29, -0.5);
      C(0.18, -0.5, 0.06, -0.44, 0, -0.29);
      ctx.closePath();
      break;
    }
    case 'D': {
      ctx.moveTo(X(0), Y(-0.5));
      ctx.quadraticCurveTo(X(0.155), Y(-0.19), X(0.405), Y(0));
      ctx.quadraticCurveTo(X(0.155), Y(0.19), X(0), Y(0.5));
      ctx.quadraticCurveTo(X(-0.155), Y(0.19), X(-0.405), Y(0));
      ctx.quadraticCurveTo(X(-0.155), Y(-0.19), X(0), Y(-0.5));
      ctx.closePath();
      break;
    }
    case 'C': {
      // three lobes + a filler, all clockwise so the non-zero fill is their union
      circlePath(ctx, X(0), Y(-0.262), 0.225 * s);
      circlePath(ctx, X(-0.255), Y(0.06), 0.225 * s);
      circlePath(ctx, X(0.255), Y(0.06), 0.225 * s);
      circlePath(ctx, X(0), Y(0.0), 0.15 * s);
      ctx.moveTo(X(-0.07), Y(0.02));
      ctx.lineTo(X(0.07), Y(0.02));
      C(0.075, 0.28, 0.13, 0.43, 0.23, 0.5);
      ctx.lineTo(X(-0.23), Y(0.5));
      C(-0.13, 0.43, -0.075, 0.28, -0.07, 0.02);
      ctx.closePath();
      break;
    }
    case 'S': {
      ctx.moveTo(X(0), Y(-0.5));
      C(0.12, -0.33, 0.5, -0.15, 0.5, 0.08);
      C(0.5, 0.26, 0.38, 0.35, 0.25, 0.35);
      C(0.14, 0.35, 0.065, 0.3, 0.035, 0.22);
      C(0.05, 0.36, 0.11, 0.45, 0.23, 0.5);
      ctx.lineTo(X(-0.23), Y(0.5));
      C(-0.11, 0.45, -0.05, 0.36, -0.035, 0.22);
      C(-0.065, 0.3, -0.14, 0.35, -0.25, 0.35);
      C(-0.38, 0.35, -0.5, 0.26, -0.5, 0.08);
      C(-0.5, -0.15, -0.12, -0.33, 0, -0.5);
      ctx.closePath();
      break;
    }
  }
}

/** Gloss highlight per suit: [x, y, rx, ry, rotation] in symbol units. */
const GLOSS: Readonly<Record<Suit, readonly [number, number, number, number, number]>> = {
  H: [-0.29, -0.27, 0.11, 0.06, -0.8],
  D: [-0.155, -0.2, 0.12, 0.034, -0.92],
  C: [-0.085, -0.37, 0.085, 0.048, -0.55],
  S: [-0.22, -0.1, 0.12, 0.048, -0.86],
};

/**
 * Draws a suit symbol centred on (cx, cy). `size` is the symbol height in pixels.
 * Defaults: suit colour with a soft vertical gradient, ink outline, small gloss.
 */
export function drawSuit(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  cx: number,
  cy: number,
  size: number,
  opts?: { color?: string; outline?: boolean; gloss?: boolean },
): void {
  if (!(size > 0)) return;
  const base = opts?.color ?? suitColor(suit);
  const outline = opts?.outline ?? true;
  const gloss = opts?.gloss ?? true;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  suitPath(ctx, suit, cx, cy, size);
  if (outline) {
    // stroke first at double width, then fill: only the outer half of the ink shows,
    // which also gives the club's overlapping lobes a single clean silhouette.
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, size * 0.1);
    ctx.stroke();
  }
  if (hexRgb(base)) {
    const g = ctx.createLinearGradient(cx, cy - size * 0.5, cx, cy + size * 0.5);
    g.addColorStop(0, lighten(base, 0.22));
    g.addColorStop(0.55, base);
    g.addColorStop(1, darken(base, 0.12));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill();
  if (gloss) {
    const [gx, gy, rx, ry, rot] = GLOSS[suit];
    ctx.beginPath();
    ellipsePath(ctx, cx + gx * size, cy + gy * size, rx * size, ry * size, rot);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fill();
  }
  ctx.restore();
}

/** Soft "sticker" shadow under a pip (drawn in the current transform). */
function pipShadow(ctx: Ctx, suit: Suit, cx: number, cy: number, size: number): void {
  suitPath(ctx, suit, cx, cy, size);
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = 'rgba(92, 58, 24, 0.16)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(92, 58, 24, 0.16)';
  ctx.fill();
}

// ---------------------------------------------------------------- layout ---
// Fractions of the card width unless noted.
const BORDER_INSET = 0.03;
const BORDER_W = 0.0065;
const IDX_X = 0.13;
const IDX_TOP = 0.066;
const IDX_CAP = 0.18;
const IDX_MAXW = 0.17;
const IDX_GAP = 0.034;
const IDX_PIP = 0.12;
const COIN_GAP = 0.03;
const COIN_R = 0.066;
const PIP = 0.185;

// pip columns (fractions of w) and rows (fractions of h)
const PL = 0.345;
const PC = 0.5;
const PR = 0.655;
const RT = 0.205;
const RU = 0.3525;
const RM = 0.5;
const RB = 0.795;
// Belote's 8, 9 and 10: columns a little wider apart, four rows of pips, the centre ones in between.
const WL = 0.325;
const WR = 0.675;
const R4 = (RB - RT) / 3;
const R2 = RT + R4;
const R3 = RB - R4;
const RC1 = RT + R4 / 2;
const RC2 = RB - R4 / 2;
const PIP_LAYOUTS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  2: [[PC, RT], [PC, RB]],
  3: [[PC, RT], [PC, RM], [PC, RB]],
  4: [[PL, RT], [PR, RT], [PL, RB], [PR, RB]],
  5: [[PL, RT], [PR, RT], [PC, RM], [PL, RB], [PR, RB]],
  6: [[PL, RT], [PR, RT], [PL, RM], [PR, RM], [PL, RB], [PR, RB]],
  7: [[PL, RT], [PR, RT], [PC, RU], [PL, RM], [PR, RM], [PL, RB], [PR, RB]],
  8: [[WL, RT], [WR, RT], [PC, RU], [WL, RM], [WR, RM], [PC, 1 - RU], [WL, RB], [WR, RB]],
  9: [[WL, RT], [WR, RT], [WL, R2], [WR, R2], [PC, RM], [WL, R3], [WR, R3], [WL, RB], [WR, RB]],
  10: [[WL, RT], [WR, RT], [PC, RC1], [WL, R2], [WR, R2], [WL, R3], [WR, R3], [PC, RC2], [WL, RB], [WR, RB]],
};
/** Pip size per count (fractions of w): the crowded cards get slightly smaller pips. */
function pipSize(count: number): number {
  return count >= 9 ? 0.168 : count === 8 ? 0.176 : PIP;
}

// ------------------------------------------------------------ paper & index ---
function drawPaper(ctx: Ctx, w: number, h: number, golden: boolean): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, w * 0.08, w * 0.5, h * 0.5, h * 0.64);
  g.addColorStop(0, PAPER_HI);
  g.addColorStop(1, PAPER_LO);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const inset = BORDER_INSET * w;
  const r = Math.max(w * 0.015, CARD_CORNER * w - inset * 0.7);
  roundRectPath(ctx, inset, inset, w - 2 * inset, h - 2 * inset, r);
  ctx.lineWidth = Math.max(0.75, BORDER_W * w * (golden ? 1.35 : 1));
  ctx.strokeStyle = golden ? '#E2A529' : BORDER;
  ctx.stroke();
  const inset2 = inset + w * 0.011;
  roundRectPath(ctx, inset2, inset2, w - 2 * inset2, h - 2 * inset2, Math.max(w * 0.008, r - w * 0.011));
  ctx.lineWidth = Math.max(0.5, BORDER_W * w * 0.4);
  ctx.strokeStyle = golden ? rgba('#E2A529', 0.75) : rgba(BORDER, 0.65);
  ctx.stroke();

  // tiny diamonds at the middle of each side of the border
  ctx.fillStyle = golden ? '#E2A529' : BORDER;
  const d = w * 0.014;
  const mids: ReadonlyArray<readonly [number, number]> = [
    [w / 2, inset],
    [w / 2, h - inset],
    [inset, h / 2],
    [w - inset, h / 2],
  ];
  ctx.beginPath();
  for (const [mx, my] of mids) {
    ctx.moveTo(mx, my - d);
    ctx.lineTo(mx + d, my);
    ctx.lineTo(mx, my + d);
    ctx.lineTo(mx - d, my);
    ctx.closePath();
  }
  ctx.fill();

  // small khatem rosettes in the two corners without an index (top-right, bottom-left)
  const rr = w * 0.034;
  const off = inset + w * 0.052;
  const spots: ReadonlyArray<readonly [number, number]> = [
    [w - off, off],
    [off, h - off],
  ];
  for (const [x, y] of spots) {
    ctx.beginPath();
    khatemPath(ctx, x, y, rr, Math.PI / 8);
    const rg = ctx.createRadialGradient(x, y - rr * 0.3, rr * 0.1, x, y, rr);
    rg.addColorStop(0, golden ? GOLD_HI : '#FBEBC6');
    rg.addColorStop(1, golden ? GOLD : '#F0D39C');
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, w * 0.004);
    ctx.strokeStyle = golden ? '#C98A12' : '#C9A064';
    ctx.stroke();
    ctx.beginPath();
    khatemSquaresPath(ctx, x, y, rr * 0.62, Math.PI / 8);
    ctx.lineWidth = Math.max(0.4, w * 0.0025);
    ctx.stroke();
    ctx.beginPath();
    circlePath(ctx, x, y, rr * 0.2);
    ctx.fillStyle = golden ? '#C98A12' : '#C9A064';
    ctx.fill();
  }
}

function drawCoin(ctx: Ctx, cx: number, cy: number, r: number, text: string): void {
  const lw = Math.max(0.8, r * 0.12);
  ctx.beginPath();
  circlePath(ctx, cx + r * 0.08, cy + r * 0.12, r);
  ctx.fillStyle = 'rgba(92, 58, 24, 0.2)';
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx, cy, r);
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, GOLD_HI);
  g.addColorStop(0.5, GOLD);
  g.addColorStop(1, GOLD_LO);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  circlePath(ctx, cx, cy, r * 0.76);
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  ctx.strokeStyle = rgba(GOLD_LO, 0.85);
  ctx.stroke();
  const t = fitText(ctx, text, r * 0.88, r * 1.28);
  ctx.font = t.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const tx = cx - (t.right - t.left) / 2;
  const ty = cy + t.asc / 2;
  ctx.fillStyle = 'rgba(255, 246, 214, 0.9)';
  ctx.fillText(text, tx, ty + r * 0.07);
  ctx.fillStyle = GOLD_INK;
  ctx.fillText(text, tx, ty);
  ctx.beginPath();
  ellipsePath(ctx, cx - r * 0.45, cy - r * 0.48, r * 0.24, r * 0.11, -0.75);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
}

function drawIndex(ctx: Ctx, card: CardFace, w: number): void {
  const label = card.rank;
  const cx = IDX_X * w;
  const capTop = IDX_TOP * w;
  const capH = IDX_CAP * w;
  const t = fitText(ctx, label, capH, IDX_MAXW * w);
  ctx.font = t.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = suitColor(card.suit);
  ctx.fillText(label, cx - (t.right - t.left) / 2, capTop + capH);

  const pipS = IDX_PIP * w;
  // keep clear of descenders (the tail of the Q)
  const gap = Math.max(IDX_GAP * w, t.desc + w * 0.014);
  const pipY = capTop + capH + gap + pipS / 2;
  drawSuit(ctx, card.suit, cx, pipY, pipS);

  if (card.coin !== undefined) {
    const r = COIN_R * w;
    drawCoin(ctx, cx, pipY + pipS / 2 + COIN_GAP * w + r, r, String(card.coin));
  } else if (card.golden) {
    const r = w * 0.055;
    drawTwinkle(ctx, cx, pipY + pipS / 2 + COIN_GAP * w + r, r, Math.max(0.5, w * 0.004));
  }
}

// ------------------------------------------------------------- pip cards ---
function drawPipCard(ctx: Ctx, card: CardFace, w: number, h: number): void {
  const count = pipCount(card);
  const layout = PIP_LAYOUTS[count] ?? [];
  const size = pipSize(count) * w;
  const haya = !!card.golden;
  if (haya) drawGoldenGlow(ctx, w, h);
  for (const [fx, fy] of layout) {
    const x = fx * w;
    const y = fy * h;
    const flip = fy > 0.5 + 1e-6;
    ctx.save();
    ctx.translate(x + size * 0.045, y + size * 0.065);
    if (flip) ctx.rotate(Math.PI);
    pipShadow(ctx, card.suit, 0, 0, size);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    if (haya) {
      // golden aura around each pip of the Sab'a el Haya
      suitPath(ctx, card.suit, 0, 0, size);
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.34;
      ctx.strokeStyle = 'rgba(255, 196, 46, 0.35)';
      ctx.stroke();
      ctx.lineWidth = size * 0.18;
      ctx.strokeStyle = 'rgba(255, 214, 92, 0.55)';
      ctx.stroke();
    }
    drawSuit(ctx, card.suit, 0, 0, size);
    ctx.restore();
  }
  if (haya) {
    const lw = Math.max(0.5, w * 0.004);
    drawTwinkle(ctx, w * 0.5, h * 0.2, w * 0.068, lw);
    drawTwinkle(ctx, w * 0.5, h * 0.8, w * 0.068, lw);
    drawTwinkle(ctx, w * 0.5, h * 0.648, w * 0.045, lw);
  }
}

function drawGoldenGlow(ctx: Ctx, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, (h / w) * 0.95);
  const r = w * 0.5;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, 'rgba(255, 210, 84, 0.85)');
  g.addColorStop(0.55, 'rgba(255, 196, 60, 0.42)');
  g.addColorStop(1, 'rgba(255, 196, 60, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // fine gold rays
  ctx.beginPath();
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.98, a, a + Math.PI / n / 1.6);
    ctx.closePath();
  }
  const g2 = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
  g2.addColorStop(0, 'rgba(255, 236, 160, 0.35)');
  g2.addColorStop(1, 'rgba(255, 236, 160, 0)');
  ctx.fillStyle = g2;
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ aces ---
function drawAce(ctx: Ctx, card: CardFace, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const lw = Math.max(0.8, w * 0.009);
  const R = w * 0.385;

  // soft sunburst behind the medallion
  ctx.save();
  const rays = 16;
  const rr = w * 0.52;
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 - Math.PI / 2 - Math.PI / rays / 2;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rr, a, a + Math.PI / rays);
    ctx.closePath();
  }
  const sg = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, rr);
  sg.addColorStop(0, rgba(GOLD, 0.34));
  sg.addColorStop(1, rgba(GOLD, 0));
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.restore();

  // drop shadow
  ctx.beginPath();
  circlePath(ctx, cx + w * 0.008, cy + w * 0.014, R);
  ctx.fillStyle = 'rgba(92, 58, 24, 0.18)';
  ctx.fill();

  // blue studded ring
  ctx.beginPath();
  circlePath(ctx, cx, cy, R);
  const bg = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
  bg.addColorStop(0, lighten(SBS_BLUE, 0.15));
  bg.addColorStop(1, darken(SBS_BLUE, 0.15));
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const ringIn = R * 0.855;
  ctx.beginPath();
  const studs = 24;
  for (let i = 0; i < studs; i++) {
    const a = (i / studs) * Math.PI * 2;
    circlePath(ctx, cx + Math.cos(a) * (R + ringIn) * 0.5, cy + Math.sin(a) * (R + ringIn) * 0.5, w * 0.0115);
  }
  ctx.fillStyle = CREAM;
  ctx.fill();

  // cream field
  ctx.beginPath();
  circlePath(ctx, cx, cy, ringIn);
  const cg = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, ringIn);
  cg.addColorStop(0, '#FFFDF6');
  cg.addColorStop(1, '#FBEBD0');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // gold dots in the valleys between the star points
  const S = ringIn * 0.95;
  const valley = (S * Math.cos(Math.PI / 4)) / Math.cos(Math.PI / 8);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + Math.PI / 8 + (i * Math.PI) / 4;
    const rd = (valley + ringIn) / 2 + w * 0.006;
    circlePath(ctx, cx + Math.cos(a) * rd, cy + Math.sin(a) * rd, w * 0.0125);
  }
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, lw * 0.5);
  ctx.strokeStyle = GOLD_LO;
  ctx.stroke();

  // the khatem: bold Sidi Bou Said blue with a white interlace
  ctx.beginPath();
  khatemPath(ctx, cx, cy, S, -Math.PI / 2);
  const kg = ctx.createLinearGradient(cx, cy - S, cx, cy + S);
  kg.addColorStop(0, lighten(SBS_BLUE, 0.2));
  kg.addColorStop(1, darken(SBS_BLUE, 0.1));
  ctx.fillStyle = kg;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  khatemSquaresPath(ctx, cx, cy, S * 0.83, -Math.PI / 2);
  ctx.lineWidth = Math.max(0.6, lw * 0.65);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke();

  // inner disc
  const D = S * 0.62;
  ctx.beginPath();
  circlePath(ctx, cx, cy, D);
  const dg = ctx.createRadialGradient(cx, cy - D * 0.4, D * 0.1, cx, cy, D);
  dg.addColorStop(0, '#FFFFFF');
  dg.addColorStop(1, '#FFF0D2');
  ctx.fillStyle = dg;
  ctx.fill();
  ctx.lineWidth = lw * 1.9;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = GOLD;
  ctx.stroke();

  drawSuit(ctx, card.suit, cx, cy + w * 0.005, w * 0.255);
}

// --------------------------------------------------------------- figures ---
interface Cloth {
  main: string;
  dark: string;
  light: string;
}

const CLOTH: Readonly<Record<Suit, Cloth>> = {
  H: { main: '#E3456A', dark: '#B32A4D', light: '#F47F98' },
  D: { main: '#F28C21', dark: '#C9670E', light: '#FFB55C' },
  C: { main: '#2FA35D', dark: '#1D7841', light: '#62C985' },
  S: { main: '#5C4DC6', dark: '#3D3296', light: '#8B7FE2' },
};

/** Tiny pen that draws in a local "head unit" space (origin = head centre). */
class Pen {
  readonly ctx: Ctx;
  readonly ox: number;
  readonly oy: number;
  readonly u: number;
  readonly lw: number;
  constructor(ctx: Ctx, ox: number, oy: number, u: number, lw: number) {
    this.ctx = ctx;
    this.ox = ox;
    this.oy = oy;
    this.u = u;
    this.lw = lw;
  }
  x(v: number): number {
    return this.ox + v * this.u;
  }
  y(v: number): number {
    return this.oy + v * this.u;
  }
  begin(): this {
    this.ctx.beginPath();
    return this;
  }
  M(x: number, y: number): this {
    this.ctx.moveTo(this.x(x), this.y(y));
    return this;
  }
  L(x: number, y: number): this {
    this.ctx.lineTo(this.x(x), this.y(y));
    return this;
  }
  Q(cx: number, cy: number, x: number, y: number): this {
    this.ctx.quadraticCurveTo(this.x(cx), this.y(cy), this.x(x), this.y(y));
    return this;
  }
  C(ax: number, ay: number, bx: number, by: number, x: number, y: number): this {
    this.ctx.bezierCurveTo(this.x(ax), this.y(ay), this.x(bx), this.y(by), this.x(x), this.y(y));
    return this;
  }
  Z(): this {
    this.ctx.closePath();
    return this;
  }
  E(x: number, y: number, rx: number, ry: number, rot = 0): this {
    ellipsePath(this.ctx, this.x(x), this.y(y), rx * this.u, ry * this.u, rot);
    return this;
  }
  O(x: number, y: number, r: number): this {
    circlePath(this.ctx, this.x(x), this.y(y), r * this.u);
    return this;
  }
  fill(style: Paint): this {
    this.ctx.fillStyle = style;
    this.ctx.fill();
    return this;
  }
  stroke(k = 1, style: Paint = INK): this {
    this.ctx.lineWidth = Math.max(0.5, k * this.lw);
    this.ctx.strokeStyle = style;
    this.ctx.stroke();
    return this;
  }
  paint(style: Paint, k = 1): this {
    return this.fill(style).stroke(k);
  }
  /** Outline only outside the shape: right for unions of overlapping sub-paths. */
  sticker(style: Paint, k = 1): this {
    this.ctx.lineWidth = Math.max(1, 2 * k * this.lw);
    this.ctx.strokeStyle = INK;
    this.ctx.stroke();
    this.ctx.fillStyle = style;
    this.ctx.fill();
    return this;
  }
  /** Thick outlined stroke along the current path (width in head units). */
  band(width: number, style: Paint, k = 1): this {
    this.ctx.lineWidth = width * this.u + 2 * k * this.lw;
    this.ctx.strokeStyle = INK;
    this.ctx.stroke();
    this.ctx.lineWidth = width * this.u;
    this.ctx.strokeStyle = style;
    this.ctx.stroke();
    return this;
  }
  lin(x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
    const g = this.ctx.createLinearGradient(this.x(x0), this.y(y0), this.x(x1), this.y(y1));
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  rad(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: Stops): CanvasGradient {
    const g = this.ctx.createRadialGradient(this.x(x0), this.y(y0), r0 * this.u, this.x(x1), this.y(y1), r1 * this.u);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
}

interface Panel {
  cx: number;
  /** inner apex y */
  top: number;
  /** inner bottom y */
  bottom: number;
  /** inner jamb half width */
  halfW: number;
  /** horseshoe radius (inner) */
  r: number;
  /** y of the horseshoe centre */
  arcCy: number;
  /** frame band thickness */
  frame: number;
}

function figurePanel(w: number, h: number): Panel {
  const frame = 0.04 * w;
  const halfW = 0.272 * w - frame;
  const r = halfW * 1.07;
  const top = 0.045 * h + frame;
  const bottom = 0.955 * h - frame;
  return { cx: w / 2, top, bottom, halfW, r, arcCy: top + r, frame };
}

/** Horseshoe ("keyhole") arch: circle of radius r on top of jambs of half width halfW. */
function archPath(ctx: Ctx, cx: number, arcCy: number, r: number, halfW: number, bottom: number): void {
  const dy = Math.sqrt(Math.max(0, r * r - halfW * halfW));
  const a0 = Math.atan2(dy, -halfW);
  const a1 = Math.atan2(dy, halfW);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, bottom);
  ctx.lineTo(cx - halfW, arcCy + dy);
  ctx.arc(cx, arcCy, r, a0, a1 + Math.PI * 2, false);
  ctx.lineTo(cx + halfW, bottom);
  ctx.closePath();
}

function drawFigureCard(ctx: Ctx, card: CardFace, w: number, h: number): void {
  const P = figurePanel(w, h);
  const lw = Math.max(0.8, w * 0.0095);
  const outerR = P.r + P.frame;
  const outerHalf = P.halfW + P.frame;
  const outerBottom = P.bottom + P.frame;

  // drop shadow of the door
  ctx.save();
  ctx.translate(w * 0.009, w * 0.014);
  archPath(ctx, P.cx, P.arcCy, outerR, outerHalf, outerBottom);
  ctx.fillStyle = 'rgba(92, 58, 24, 0.2)';
  ctx.fill();
  ctx.restore();

  // blue frame
  archPath(ctx, P.cx, P.arcCy, outerR, outerHalf, outerBottom);
  const fg = ctx.createLinearGradient(0, P.top - P.frame, 0, outerBottom);
  fg.addColorStop(0, '#3A7BCD');
  fg.addColorStop(1, '#174A8C');
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // warm interior + the character, clipped to the opening
  ctx.save();
  archPath(ctx, P.cx, P.arcCy, P.r, P.halfW, P.bottom);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, P.top, 0, P.bottom);
  bg.addColorStop(0, '#FFE6AE');
  bg.addColorStop(1, '#F7B27F');
  ctx.fillStyle = bg;
  ctx.fillRect(P.cx - outerR, P.top, outerR * 2, P.bottom - P.top);

  const u = w * 0.172;
  const hx = P.cx;
  const hy = h * 0.392;
  // sun rays + halo behind the head
  ctx.save();
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, h, a, a + Math.PI / n);
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  const halo = ctx.createRadialGradient(hx, hy, u * 0.5, hx, hy, u * 2.3);
  halo.addColorStop(0, 'rgba(255, 252, 235, 0.9)');
  halo.addColorStop(1, 'rgba(255, 252, 235, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(hx - u * 2.4, hy - u * 2.4, u * 4.8, u * 4.8);
  ctx.restore();

  const pen = new Pen(ctx, hx, hy, u, lw);
  const cloth = CLOTH[card.suit];
  if (card.rank === 'K') drawKing(pen, cloth, card.suit);
  else if (card.rank === 'Q') drawQueen(pen, cloth, card.suit);
  else drawJack(pen, cloth, card.suit);

  // inner shadow along the opening
  archPath(ctx, P.cx, P.arcCy, P.r, P.halfW, P.bottom);
  ctx.lineWidth = w * 0.03;
  ctx.strokeStyle = 'rgba(40, 24, 60, 0.18)';
  ctx.stroke();
  ctx.restore();

  archPath(ctx, P.cx, P.arcCy, P.r, P.halfW, P.bottom);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // studs along the frame band
  const rc = P.r + P.frame / 2;
  const hc = P.halfW + P.frame / 2;
  const dyc = Math.sqrt(Math.max(0, rc * rc - hc * hc));
  const a0 = Math.atan2(dyc, -hc);
  const a1 = Math.atan2(dyc, hc) + Math.PI * 2;
  const studR = w * 0.0105;
  ctx.beginPath();
  const nArc = 12;
  for (let i = 0; i <= nArc; i++) {
    const a = a0 + ((a1 - a0) * i) / nArc;
    if (Math.abs(a - Math.PI * 1.5) < 0.2) continue; // keystone sits there
    circlePath(ctx, P.cx + Math.cos(a) * rc, P.arcCy + Math.sin(a) * rc, studR);
  }
  const jTop = P.arcCy + dyc;
  const jBot = P.bottom + P.frame / 2;
  const nJ = Math.max(2, Math.round((jBot - jTop) / (w * 0.105)));
  for (let i = 1; i <= nJ; i++) {
    const y = jTop + ((jBot - jTop) * i) / nJ;
    circlePath(ctx, P.cx - hc, y, studR);
    circlePath(ctx, P.cx + hc, y, studR);
  }
  for (let i = 1; i < 4; i++) {
    circlePath(ctx, P.cx - hc + (2 * hc * i) / 4, jBot, studR);
  }
  ctx.fillStyle = CREAM;
  ctx.fill();

  // keystone medallion with the suit pip
  const kr = w * 0.052;
  const ky = P.top - P.frame / 2;
  ctx.beginPath();
  circlePath(ctx, P.cx, ky, kr);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  drawSuit(ctx, card.suit, P.cx, ky + kr * 0.03, kr * 1.15, { gloss: false });
}

// shared body parts -----------------------------------------------------------
function drawNeck(p: Pen, half: number): void {
  p.begin().M(-half, 0.5).L(half, 0.5).L(half + 0.05, 1.6).L(-half - 0.05, 1.6).Z();
  p.paint(p.lin(0, 0.6, 0, 1.4, [[0, SKIN_LO], [1, SKIN]]));
}

/** Torso silhouette, deliberately wider than the arch so the jambs crop it. */
function torsoPath(p: Pen, sh: number, top: number): void {
  p.begin()
    .M(-sh - 0.6, 5.6)
    .L(-sh - 0.3, top + 1.0)
    .C(-sh - 0.2, top + 0.3, -sh + 0.35, top - 0.02, -0.5, top - 0.06)
    .L(0.5, top - 0.06)
    .C(sh - 0.35, top - 0.02, sh + 0.2, top + 0.3, sh + 0.3, top + 1.0)
    .L(sh + 0.6, 5.6)
    .Z();
}

function drawEars(p: Pen, y: number): void {
  for (const s of [-1, 1]) {
    p.begin().E(s * 0.96, y, 0.2, 0.25).paint(SKIN);
    p.begin().E(s * 0.99, y + 0.01, 0.085, 0.13).fill(SKIN_LO);
  }
}

function drawHead(p: Pen, rx = 1, ry = 0.97): void {
  p.begin().E(0, 0, rx, ry);
  p.paint(p.rad(-0.3, -0.38, 0.1, 0, 0, 1.08, [[0, SKIN_HI], [0.55, SKIN], [1, '#EDB48C']]));
}

function drawEye(p: Pen, x: number, y: number, r: number): void {
  p.begin().E(x, y, r * 0.92, r).fill(INK);
  p.begin().O(x + r * 0.32, y - r * 0.38, r * 0.36).fill('#FFFFFF');
}

function drawCheeks(p: Pen, y: number, dx: number): void {
  p.begin().E(-dx, y, 0.17, 0.11).E(dx, y, 0.17, 0.11).fill(BLUSH);
}

function drawChechia(p: Pen, opts: { tilt: number; tassel: 1 | -1; emblem: boolean; tall?: number }): void {
  const ctx = p.ctx;
  const tall = opts.tall ?? 1;
  ctx.save();
  const px = p.x(0);
  const py = p.y(-0.62);
  ctx.translate(px, py);
  ctx.rotate(opts.tilt);
  ctx.translate(-px, -py);

  const yb = -0.58; // brim at the sides (it dips towards the viewer in front)
  const yt = yb - 0.76 * tall; // rounded, flattened top
  const s = opts.tassel;

  // soft felt cap: slightly bulging sides rounding into a flattened dome
  p.begin()
    .M(-1.0, yb)
    .C(-1.05, yb - 0.34 * tall, -0.99, yt + 0.2, -0.72, yt + 0.04)
    .C(-0.4, yt - 0.08, 0.4, yt - 0.08, 0.72, yt + 0.04)
    .C(0.99, yt + 0.2, 1.05, yb - 0.34 * tall, 1.0, yb)
    .C(0.56, yb + 0.22, -0.56, yb + 0.22, -1.0, yb)
    .Z();
  p.paint(p.lin(-1, 0, 1, 0, [[0, CHECHIA_HI], [0.42, CHECHIA], [1, CHECHIA_LO]]));
  // hint of the flattened crown
  p.begin().E(0, yt + 0.07, 0.56, 0.08).fill('rgba(255, 150, 130, 0.35)');
  // soft highlight
  p.begin().M(-0.7, yb - 0.02).C(-0.74, yb - 0.25, -0.7, yt + 0.32, -0.6, yt + 0.17);
  p.ctx.lineCap = 'round';
  p.ctx.lineWidth = 0.11 * p.u;
  p.ctx.strokeStyle = 'rgba(255, 235, 225, 0.35)';
  p.ctx.stroke();

  if (opts.emblem) {
    const ex = p.x(0);
    const ey = p.y((yb + yt) / 2 + 0.05);
    const R = 0.2 * p.u;
    ctx.beginPath();
    khatemPath(ctx, ex, ey, R, -Math.PI / 2);
    ctx.lineJoin = 'round';
    ctx.lineWidth = p.lw * 1.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.beginPath();
    circlePath(ctx, ex, ey, R * 0.32);
    ctx.fillStyle = GOLD_HI;
    ctx.fill();
  }

  // black silk tassel from the top, falling over one side
  p.begin().M(s * 0.05, yt - 0.03).Q(s * 0.5, yt - 0.2, s * 0.78, yt + 0.06);
  p.band(0.075, TASSEL, 0.7);
  p.begin()
    .M(s * 0.74, yt + 0.0)
    .C(s * 0.98, yt + 0.08, s * 1.12, yt + 0.42, s * 1.14, yt + 0.8)
    .C(s * 1.07, yt + 0.88, s * 0.96, yt + 0.88, s * 0.88, yt + 0.82)
    .C(s * 0.9, yt + 0.52, s * 0.84, yt + 0.26, s * 0.66, yt + 0.08)
    .Z();
  p.paint(p.lin(s * 0.74, 0, s * 1.12, 0, [[0, '#45405a'], [1, TASSEL]]), 0.9);
  p.begin()
    .M(s * 0.95, yt + 0.26)
    .Q(s * 1.03, yt + 0.52, s * 1.03, yt + 0.76)
    .M(s * 0.86, yt + 0.28)
    .Q(s * 0.93, yt + 0.52, s * 0.94, yt + 0.74);
  p.stroke(0.5, 'rgba(255,255,255,0.28)');
  ctx.restore();
}

function drawJasmine(p: Pen, x: number, y: number, r: number, rot: number): void {
  p.begin();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    p.E(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.3, a);
  }
  p.sticker('#FFFFFF', 0.7);
  p.begin();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    p.M(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25).L(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75);
  }
  p.stroke(0.45, 'rgba(200, 180, 210, 0.9)');
  p.begin().O(x, y, r * 0.2).paint('#F9C93E', 0.5);
}

// King ----------------------------------------------------------------------
function drawKing(p: Pen, cl: Cloth, suit: Suit): void {
  const ctx = p.ctx;
  drawNeck(p, 0.36);
  torsoPath(p, 1.75, 1.18);
  p.paint(p.lin(0, 1.1, 0, 4.4, [[0, cl.light], [0.3, cl.main], [1, cl.dark]]));
  // shirt
  p.begin().M(-0.64, 1.06).L(0.64, 1.06).L(0, 2.5).Z().paint(SHIRT);
  // gold collar bands + placket
  const gold = p.lin(0, 1.0, 0, 3.2, [[0, GOLD_HI], [0.5, GOLD], [1, GOLD_LO]]);
  for (const s of [-1, 1]) {
    p.begin().M(s * 0.6, 1.04).L(s * 1.02, 1.1).L(s * 0.21, 2.92).L(0, 2.52).Z().paint(gold);
    p.begin();
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      p.O(s * (0.81 - 0.6 * t), 1.07 + 1.6 * t, 0.045);
    }
    p.fill(GOLD_LO);
  }
  p.begin().M(-0.15, 2.75).L(0.15, 2.75).L(0.2, 5.6).L(-0.2, 5.6).Z().paint(gold);
  p.begin().O(0, 3.25, 0.085).O(0, 3.75, 0.085).O(0, 4.25, 0.085).paint(GOLD_LO, 0.6);

  // medal with the suit pip
  const mx = 0.92;
  const my = 2.42;
  p.begin().M(mx - 0.17, 1.86).L(mx + 0.17, 1.86).L(mx + 0.17, 2.22).L(mx, 2.12).L(mx - 0.17, 2.22).Z();
  p.paint(p.lin(mx - 0.17, 0, mx + 0.17, 0, [[0, '#FFFFFF'], [0.34, '#FFFFFF'], [0.35, RED], [0.65, RED], [0.66, '#FFFFFF']]), 0.8);
  p.begin().O(mx, my, 0.3).paint(gold);
  p.begin().O(mx, my, 0.21).paint('#FFF8E8', 0.6);
  drawSuit(ctx, suit, p.x(mx), p.y(my), 0.26 * p.u, { gloss: false });

  // head
  drawEars(p, 0.08);
  drawHead(p, 1.0, 0.97);

  // face
  drawCheeks(p, 0.2, 0.56);
  drawEye(p, -0.35, -0.04, 0.105);
  drawEye(p, 0.35, -0.04, 0.105);
  // bushy white brows, raised in a jolly arch
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    p.begin().M(s * 0.17, -0.25).Q(s * 0.38, -0.43, s * 0.6, -0.26);
    p.band(0.13, '#FFFFFF', 0.85);
  }

  // beard: puffy cloud from sideburn to sideburn
  const bx = 0;
  const by = 0.28;
  const brx = 1.1;
  const bry = 1.3;
  const a0 = Math.PI + 0.55;
  const a1 = -0.55;
  const N = 8;
  p.begin();
  p.M(bx + brx * Math.cos(a0), by + bry * Math.sin(a0));
  for (let i = 1; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const am = a0 + ((a1 - a0) * (i - 0.5)) / N;
    p.Q(bx + brx * 1.13 * Math.cos(am), by + bry * 1.1 * Math.sin(am), bx + brx * Math.cos(a), by + bry * Math.sin(a));
  }
  const ex = bx + brx * Math.cos(a1);
  const ey = by + bry * Math.sin(a1);
  p.C(ex - 0.08, ey + 0.4, 0.72, 0.42, 0.45, 0.44).C(0.2, 0.47, -0.2, 0.47, -0.45, 0.44);
  p.C(-0.72, 0.42, -ex + 0.08, ey + 0.4, -ex, ey).Z();
  p.paint(p.lin(0, 0.3, 0, 1.6, [[0, '#FFFFFF'], [1, BEARD_LO]]));
  // beard curls
  p.begin()
    .M(-0.62, 0.95).Q(-0.5, 1.08, -0.38, 0.98)
    .M(0.38, 0.98).Q(0.5, 1.08, 0.62, 0.95)
    .M(-0.14, 1.22).Q(0, 1.34, 0.14, 1.22)
    .M(-0.86, 0.5).Q(-0.8, 0.62, -0.7, 0.6)
    .M(0.86, 0.5).Q(0.8, 0.62, 0.7, 0.6);
  p.stroke(0.6, 'rgba(150, 140, 135, 0.8)');

  // open smile
  p.begin().M(-0.27, 0.62).Q(0, 0.98, 0.27, 0.62).Q(0, 0.7, -0.27, 0.62).Z().paint(MOUTH, 0.9);
  p.begin().E(0, 0.8, 0.12, 0.06).fill(TONGUE);
  // mustache
  for (const s of [-1, 1]) {
    p.begin()
      .M(0, 0.38)
      .C(s * 0.2, 0.26, s * 0.5, 0.28, s * 0.66, 0.38)
      .C(s * 0.75, 0.44, s * 0.85, 0.4, s * 0.87, 0.28)
      .C(s * 0.93, 0.5, s * 0.74, 0.65, s * 0.5, 0.62)
      .C(s * 0.3, 0.6, s * 0.12, 0.55, 0, 0.5)
      .Z();
    p.paint(p.lin(0, 0.28, 0, 0.62, [[0, '#FFFFFF'], [1, '#E4DFD8']]), 0.9);
  }
  // nose
  p.begin().E(0, 0.24, 0.17, 0.14).paint(p.rad(-0.05, 0.19, 0.02, 0, 0.24, 0.17, [[0, '#F7C3A3'], [1, '#E79A7C']]), 0.85);
  p.begin().E(-0.06, 0.2, 0.05, 0.03, -0.5).fill('rgba(255,255,255,0.75)');

  drawChechia(p, { tilt: 0, tassel: 1, emblem: true, tall: 1.05 });
}

// Queen ---------------------------------------------------------------------
function drawQueen(p: Pen, cl: Cloth, suit: Suit): void {
  const ctx = p.ctx;
  // hair mass + bun (behind everything)
  p.begin().O(0, -1.2, 0.47).paint(p.rad(-0.15, -1.36, 0.05, 0, -1.2, 0.5, [[0, HAIR_Q_HI], [1, HAIR_Q]]));
  p.begin().M(-0.3, -1.28).Q(0, -1.12, 0.3, -1.28).stroke(0.6, HAIR_Q_HI);
  p.begin()
    .M(-0.96, 0.56)
    .C(-1.24, 0.2, -1.24, -0.58, -0.84, -0.94)
    .C(-0.5, -1.22, 0.5, -1.22, 0.84, -0.94)
    .C(1.24, -0.58, 1.24, 0.2, 0.96, 0.56)
    .Q(0, 0.8, -0.96, 0.56)
    .Z();
  p.paint(p.lin(0, -1.1, 0, 0.6, [[0, HAIR_Q_HI], [0.35, HAIR_Q]]));

  drawNeck(p, 0.3);
  torsoPath(p, 1.55, 1.24);
  p.paint(p.lin(0, 1.1, 0, 4.4, [[0, cl.light], [0.3, cl.main], [1, cl.dark]]));
  // neckline (skin) with gold embroidered trim
  p.begin().M(-0.66, 1.16).C(-0.58, 1.95, 0.58, 1.95, 0.66, 1.16).Z().fill(p.lin(0, 1.1, 0, 1.8, [[0, SKIN_LO], [0.4, SKIN]]));
  p.begin().M(-0.7, 1.15).C(-0.62, 2.02, 0.62, 2.02, 0.7, 1.15);
  ctx.lineCap = 'round';
  p.band(0.12, GOLD, 0.8);
  // embroidery: little gold dots on the dress
  p.begin();
  const dots: ReadonlyArray<readonly [number, number]> = [
    [-1.05, 2.0], [1.05, 2.0], [-0.75, 2.45], [0.75, 2.45], [-1.15, 2.9], [1.15, 2.9], [-0.45, 2.85], [0.45, 2.85],
    [-0.85, 3.4], [0.85, 3.4], [0, 3.2], [-0.3, 3.75], [0.3, 3.75], [-1.2, 3.85], [1.2, 3.85],
  ];
  for (const [dx, dy] of dots) p.O(dx, dy, 0.05);
  p.fill(rgba(GOLD_HI, 0.9));

  // necklace of gold beads + fibula pendant with the suit pip
  p.begin();
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // quadratic curve (-0.52, 1.2) → (0, 1.95) → (0.52, 1.2)
    const x = -0.52 + 1.04 * t;
    const y = 1.2 + 1.5 * t * (1 - t);
    p.O(x, y, 0.062);
  }
  p.paint(GOLD, 0.6);
  // khlala-style pendant: ring + triangular plate
  p.begin().O(0, 1.7, 0.1).paint(GOLD, 0.7);
  p.begin().M(-0.34, 1.8).L(0.34, 1.8).Q(0.3, 2.05, 0, 2.4).Q(-0.3, 2.05, -0.34, 1.8).Z();
  p.paint(p.lin(0, 1.8, 0, 2.4, [[0, GOLD_HI], [1, GOLD_LO]]));
  drawSuit(ctx, suit, p.x(0), p.y(1.98), 0.25 * p.u, { gloss: false });
  p.begin().O(-0.18, 2.42, 0.05).O(0, 2.52, 0.055).O(0.18, 2.42, 0.05).paint(GOLD, 0.5);

  // head
  drawHead(p, 0.97, 0.97);
  // front hair with a centre parting
  p.begin()
    .M(-1.06, 0.22)
    .C(-1.14, -0.58, -0.62, -1.08, 0, -1.08)
    .C(0.62, -1.08, 1.14, -0.58, 1.06, 0.22)
    .C(0.98, -0.12, 0.78, -0.42, 0.4, -0.56)
    .C(0.2, -0.62, 0.06, -0.6, 0, -0.5)
    .C(-0.06, -0.6, -0.2, -0.62, -0.4, -0.56)
    .C(-0.78, -0.42, -0.98, -0.12, -1.06, 0.22)
    .Z();
  p.paint(p.lin(0, -1.1, 0, 0.2, [[0, HAIR_Q_HI], [0.5, HAIR_Q]]));
  p.begin().M(-0.5, -0.86).Q(-0.3, -0.98, -0.1, -0.96).M(0.3, -0.9).Q(0.5, -0.86, 0.66, -0.72);
  ctx.lineCap = 'round';
  p.stroke(1.1, 'rgba(255, 220, 240, 0.35)');

  // golden tiara
  p.begin()
    .M(-0.66, -0.7)
    .L(-0.5, -0.9)
    .L(-0.36, -0.84)
    .L(-0.2, -1.1)
    .L(0, -0.94)
    .L(0.2, -1.1)
    .L(0.36, -0.84)
    .L(0.5, -0.9)
    .L(0.66, -0.7)
    .Q(0, -0.92, -0.66, -0.7)
    .Z();
  p.paint(p.lin(0, -1.1, 0, -0.7, [[0, GOLD_HI], [1, GOLD_LO]]), 0.85);
  p.begin().O(0, -0.86, 0.085).paint('#2BB3AC', 0.6);
  p.begin().O(-0.02, -0.88, 0.03).fill('#FFFFFF');

  // face
  drawCheeks(p, 0.24, 0.55);
  for (const s of [-1, 1]) {
    drawEye(p, s * 0.36, -0.02, 0.105);
    // lashes
    p.begin()
      .M(s * 0.44, -0.1)
      .L(s * 0.55, -0.17)
      .M(s * 0.46, -0.03)
      .L(s * 0.58, -0.06);
    ctx.lineCap = 'round';
    p.stroke(0.85);
    // thin brows
    p.begin().M(s * 0.22, -0.26).Q(s * 0.38, -0.36, s * 0.54, -0.28).stroke(1.1, HAIR_Q);
  }
  p.begin().M(-0.03, 0.2).Q(0.05, 0.26, 0.0, 0.3).stroke(0.8, '#C98468');
  // smile with red lips
  p.begin().M(-0.23, 0.48).Q(0, 0.56, 0.23, 0.48).Q(0, 0.8, -0.23, 0.48).Z().paint(LIPS, 0.85);
  p.begin().M(-0.15, 0.53).Q(0, 0.58, 0.15, 0.53).stroke(0.6, '#FFFFFF');

  // earrings
  for (const s of [-1, 1]) {
    p.begin().O(s * 1.0, 0.36, 0.06).paint(GOLD, 0.6);
    p.begin().M(s * 1.0, 0.42).C(s * 1.1, 0.52, s * 1.08, 0.66, s * 1.0, 0.68).C(s * 0.92, 0.66, s * 0.9, 0.52, s * 1.0, 0.42).Z();
    p.paint(p.lin(0, 0.42, 0, 0.68, [[0, GOLD_HI], [1, GOLD_LO]]), 0.6);
  }
  // jasmine behind the ear
  drawJasmine(p, -0.98, -0.34, 0.24, -0.3);
  p.begin().E(-1.12, -0.12, 0.13, 0.06, 0.9).paint(LEAF, 0.6);
}

// Jack ----------------------------------------------------------------------
function drawJack(p: Pen, cl: Cloth, suit: Suit): void {
  const ctx = p.ctx;
  drawNeck(p, 0.32);
  // white shirt
  torsoPath(p, 1.62, 1.2);
  p.paint(p.lin(0, 1.1, 0, 4.4, [[0, '#FFFFFF'], [1, '#EADFD0']]));
  // striped vest panels leaving a V of shirt
  for (const s of [-1, 1]) {
    const vest = (): void => {
      p.begin()
        .M(s * 0.45, 1.12)
        .C(s * 1.0, 1.12, s * 1.55, 1.22, s * 1.9, 1.62)
        .L(s * 2.35, 5.6)
        .L(s * 0.26, 5.6)
        .L(s * 0.26, 2.75)
        .Z();
    };
    vest();
    ctx.save();
    ctx.clip();
    p.fill(p.lin(0, 1.1, 0, 4.4, [[0, cl.light], [0.35, cl.main], [1, cl.dark]]));
    p.begin();
    for (let x = -2.4; x <= 2.4; x += 0.36) {
      p.M(x, 1.0).L(x + 0.1, 5.6).L(x + 0.22, 5.6).L(x + 0.12, 1.0).Z();
    }
    p.fill(rgba(cl.dark, 0.55));
    ctx.restore();
    vest();
    p.stroke();
    // gold piping along the front edge
    p.begin().M(s * 0.45, 1.12).L(s * 0.26, 2.75).L(s * 0.26, 5.6);
    p.band(0.07, GOLD, 0.6);
  }
  // buttons
  p.begin().O(-0.4, 3.15, 0.08).O(-0.4, 3.65, 0.08).O(-0.4, 4.15, 0.08).paint(GOLD, 0.6);
  // shirt collar
  for (const s of [-1, 1]) {
    p.begin().M(s * 0.05, 1.28).L(s * 0.5, 1.06).L(s * 0.44, 1.56).Z().paint('#FFFFFF', 0.8);
  }
  // suit badge on the vest
  p.begin().O(0.95, 2.35, 0.27).paint(CREAM, 0.8);
  drawSuit(ctx, suit, p.x(0.95), p.y(2.36), 0.32 * p.u, { gloss: false });

  // head
  drawEars(p, 0.1);
  drawHead(p, 0.98, 0.96);
  // sideburns + fringe peeking under the cap
  for (const s of [-1, 1]) {
    p.begin().M(s * 0.98, -0.42).C(s * 1.04, -0.2, s * 0.98, 0.0, s * 0.9, 0.1).C(s * 0.84, -0.05, s * 0.8, -0.25, s * 0.78, -0.42).Z();
    p.paint(HAIR_J, 0.8);
  }
  p.begin().M(-0.45, -0.44).Q(-0.25, -0.18, -0.05, -0.36).Q(-0.18, -0.32, -0.2, -0.46).Z().paint(HAIR_J, 0.8);

  // face: cheeky wink
  drawCheeks(p, 0.24, 0.56);
  drawEye(p, -0.36, -0.03, 0.105);
  ctx.lineCap = 'round';
  p.begin().M(0.24, -0.02).Q(0.36, -0.13, 0.48, -0.02).stroke(1.15);
  p.begin().M(-0.54, -0.3).Q(-0.38, -0.4, -0.2, -0.32).stroke(1.2, HAIR_J);
  p.begin().M(0.2, -0.24).Q(0.36, -0.3, 0.54, -0.22).stroke(1.2, HAIR_J);
  p.begin().E(0, 0.22, 0.12, 0.1).fill(SKIN_LO);
  p.begin().E(-0.04, 0.19, 0.04, 0.025, -0.4).fill('rgba(255,255,255,0.7)');
  // grin
  p.begin().M(-0.28, 0.52).Q(0.02, 0.88, 0.32, 0.46).Q(0.02, 0.62, -0.28, 0.52).Z().paint(MOUTH, 0.9);
  p.begin().M(-0.2, 0.555).Q(0.03, 0.62, 0.25, 0.51).L(0.22, 0.58).Q(0.02, 0.67, -0.17, 0.6).Z().fill('#FFFFFF');
  // curled mustache
  for (const s of [-1, 1]) {
    p.begin()
      .M(0, 0.36)
      .C(s * 0.18, 0.28, s * 0.42, 0.29, s * 0.56, 0.36)
      .C(s * 0.66, 0.4, s * 0.74, 0.32, s * 0.7, 0.24)
      .C(s * 0.68, 0.2, s * 0.62, 0.2, s * 0.62, 0.25)
      .C(s * 0.62, 0.17, s * 0.74, 0.14, s * 0.78, 0.24)
      .C(s * 0.84, 0.4, s * 0.62, 0.48, s * 0.46, 0.46)
      .C(s * 0.3, 0.44, s * 0.12, 0.42, 0, 0.46)
      .Z();
    p.paint(HAIR_J, 0.85);
  }

  // machmoum (jasmine sprig) tucked behind the ear
  p.begin().M(-0.98, 0.0).Q(-1.06, -0.25, -1.1, -0.48).M(-0.94, 0.02).Q(-0.98, -0.3, -0.96, -0.5);
  p.stroke(1, '#6B8E3A');
  p.begin();
  const buds: ReadonlyArray<readonly [number, number, number]> = [
    [-1.2, -0.5, -0.4], [-1.05, -0.6, 0], [-0.9, -0.52, 0.4], [-1.13, -0.7, -0.2], [-0.97, -0.72, 0.2], [-1.06, -0.82, 0],
  ];
  for (const [bx, by, br] of buds) p.E(bx, by, 0.075, 0.11, br);
  p.sticker('#FFFFFF', 0.6);
  p.begin();
  for (const [bx, by] of buds) p.O(bx, by + 0.04, 0.025);
  p.fill('rgba(247, 201, 62, 0.8)');

  drawChechia(p, { tilt: 0.2, tassel: 1, emblem: false, tall: 0.95 });
}

// ------------------------------------------------------------- public API ---
/** Draws a card face into (0,0)–(w,h) of the current transform. Corners stay transparent. */
export function drawCardFace(ctx: CanvasRenderingContext2D, card: CardFace, w: number, h: number): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  cardPath(ctx, w, h);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawPaper(ctx, w, h, !!card.golden);
  if (card.rank === 'A') drawAce(ctx, card, w, h);
  else if (pipCount(card) > 0) drawPipCard(ctx, card, w, h);
  else drawFigureCard(ctx, card, w, h);

  drawIndex(ctx, card, w);
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  drawIndex(ctx, card, w);
  ctx.restore();

  // subtle card edge
  cardPath(ctx, w, h);
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeStyle = 'rgba(120, 86, 44, 0.35)';
  ctx.stroke();
  ctx.restore();
}

/** Draws the card back (Sidi Bou Said blue tiles + medallion); 180°-rotation symmetric. */
export function drawCardBack(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const lw = Math.max(0.8, w * 0.008);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  cardPath(ctx, w, h);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const base = ctx.createRadialGradient(cx, cy, w * 0.1, cx, cy, h * 0.62);
  base.addColorStop(0, lighten(BACK_BLUE, 0.1));
  base.addColorStop(1, darken(BACK_BLUE, 0.22));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // outer stud row in the margin
  const mInset = w * 0.03;
  ctx.beginPath();
  const stepX = (w - 2 * mInset) / 12;
  for (let i = 1; i < 12; i++) {
    circlePath(ctx, mInset + i * stepX, mInset, w * 0.007);
    circlePath(ctx, mInset + i * stepX, h - mInset, w * 0.007);
  }
  const ny = Math.round((h - 2 * mInset) / stepX);
  const stepY = (h - 2 * mInset) / ny;
  for (let i = 1; i < ny; i++) {
    circlePath(ctx, mInset, mInset + i * stepY, w * 0.007);
    circlePath(ctx, w - mInset, mInset + i * stepY, w * 0.007);
  }
  ctx.fillStyle = 'rgba(255, 243, 220, 0.75)';
  ctx.fill();

  // tile field
  const fi = w * 0.062;
  const fw = w * 0.026;
  const pi = fi + fw;
  const fr = Math.max(w * 0.01, CARD_CORNER * w - fi * 0.7);
  ctx.save();
  roundRectPath(ctx, pi, pi, w - 2 * pi, h - 2 * pi, Math.max(w * 0.005, fr - fw));
  ctx.clip();
  const field = ctx.createRadialGradient(cx, cy, w * 0.1, cx, cy, h * 0.55);
  field.addColorStop(0, '#2A6DC0');
  field.addColorStop(1, '#1B5299');
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  drawStarCrossTiles(ctx, cx, cy, w * 0.19, w, h);
  ctx.restore();

  // cream frame band
  const bw = w - 2 * fi - fw;
  const bh = h - 2 * fi - fw;
  const br = Math.max(0, Math.min(fr - fw / 2, bw / 2, bh / 2));
  roundRectPath(ctx, fi + fw / 2, fi + fw / 2, bw, bh, br);
  ctx.lineWidth = fw + lw * 2;
  ctx.strokeStyle = '#123C73';
  ctx.stroke();
  ctx.lineWidth = fw;
  ctx.strokeStyle = CREAM;
  ctx.stroke();
  // blue stitch dots along the band, placed symmetrically (keeps the 180° symmetry exact)
  ctx.beginPath();
  const bx0 = fi + fw / 2 + br;
  const bx1 = w - fi - fw / 2 - br;
  const by0 = fi + fw / 2 + br;
  const by1 = h - fi - fw / 2 - br;
  const nxs = Math.max(1, Math.round((bx1 - bx0) / (w * 0.03)));
  const nys = Math.max(1, Math.round((by1 - by0) / (w * 0.03)));
  const dotR = Math.max(0.4, w * 0.0042);
  for (let i = 0; i <= nxs; i++) {
    const x = bx0 + ((bx1 - bx0) * i) / nxs;
    circlePath(ctx, x, fi + fw / 2, dotR);
    circlePath(ctx, x, h - fi - fw / 2, dotR);
  }
  for (let i = 0; i <= nys; i++) {
    const y = by0 + ((by1 - by0) * i) / nys;
    circlePath(ctx, fi + fw / 2, y, dotR);
    circlePath(ctx, w - fi - fw / 2, y, dotR);
  }
  ctx.fillStyle = rgba(SBS_BLUE, 0.75);
  ctx.fill();

  // corner rosettes
  const corners: ReadonlyArray<readonly [number, number]> = [
    [fi + fw / 2, fi + fw / 2],
    [w - fi - fw / 2, fi + fw / 2],
    [fi + fw / 2, h - fi - fw / 2],
    [w - fi - fw / 2, h - fi - fw / 2],
  ];
  for (const [x, y] of corners) {
    ctx.beginPath();
    khatemPath(ctx, x, y, w * 0.042, Math.PI / 8);
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = '#123C73';
    ctx.stroke();
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.beginPath();
    circlePath(ctx, x, y, w * 0.013);
    ctx.fillStyle = SBS_BLUE;
    ctx.fill();
  }

  // central medallion
  const R = w * 0.255;
  ctx.beginPath();
  circlePath(ctx, cx, cy, R * 1.12);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.12);
  halo.addColorStop(0, 'rgba(8, 28, 64, 0.5)');
  halo.addColorStop(1, 'rgba(8, 28, 64, 0)');
  ctx.fillStyle = halo;
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx, cy, R);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#123C73';
  ctx.stroke();
  ctx.beginPath();
  circlePath(ctx, cx, cy, R * 0.92);
  ctx.fillStyle = SBS_BLUE;
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx, cy, R * 0.82);
  const mg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 0.82);
  mg.addColorStop(0, '#FFFBF1');
  mg.addColorStop(1, '#F8E7C8');
  ctx.fillStyle = mg;
  ctx.fill();
  // ring of studs
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    circlePath(ctx, cx + Math.cos(a) * R * 0.87, cy + Math.sin(a) * R * 0.87, w * 0.0085);
  }
  ctx.fillStyle = CREAM;
  ctx.fill();
  // blue khatem
  const S = R * 0.72;
  ctx.beginPath();
  khatemPath(ctx, cx, cy, S, 0);
  const sg = ctx.createRadialGradient(cx, cy, S * 0.2, cx, cy, S);
  sg.addColorStop(0, lighten(SBS_BLUE, 0.12));
  sg.addColorStop(1, darken(SBS_BLUE, 0.1));
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#123C73';
  ctx.stroke();
  ctx.beginPath();
  khatemSquaresPath(ctx, cx, cy, S * 0.8, 0);
  ctx.lineWidth = Math.max(0.5, lw * 0.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  // jasmine (8 petals keeps the 180° symmetry)
  const jr = R * 0.3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    ellipsePath(ctx, cx + Math.cos(a) * jr * 0.55, cy + Math.sin(a) * jr * 0.55, jr * 0.5, jr * 0.22, a);
  }
  ctx.lineWidth = lw * 1.2;
  ctx.strokeStyle = '#123C73';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, cx, cy, jr * 0.22);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, lw * 0.6);
  ctx.strokeStyle = GOLD_LO;
  ctx.stroke();

  // subtle edge
  cardPath(ctx, w, h);
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeStyle = 'rgba(8, 28, 64, 0.45)';
  ctx.stroke();
  ctx.restore();
}

/** Classic star-and-cross tiling: 8-pointed stars on a square lattice, crosses between. */
function drawStarCrossTiles(ctx: Ctx, cx: number, cy: number, L: number, w: number, h: number): void {
  const R = L / 2;
  const nx = Math.ceil(w / 2 / L) + 1;
  const ny = Math.ceil(h / 2 / L) + 1;
  ctx.beginPath();
  for (let i = -nx; i <= nx; i++) {
    for (let j = -ny; j <= ny; j++) khatemPath(ctx, cx + i * L, cy + j * L, R, 0);
  }
  ctx.fillStyle = 'rgba(120, 175, 235, 0.32)';
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, w * 0.0075);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.stroke();
  // inner stars
  ctx.beginPath();
  for (let i = -nx; i <= nx; i++) {
    for (let j = -ny; j <= ny; j++) khatemPath(ctx, cx + i * L, cy + j * L, R * 0.42, Math.PI / 8);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  // cross centres
  ctx.beginPath();
  for (let i = -nx; i <= nx; i++) {
    for (let j = -ny; j <= ny; j++) {
      const x = cx + (i + 0.5) * L;
      const y = cy + (j + 0.5) * L;
      const d = L * 0.07;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    }
  }
  ctx.fillStyle = 'rgba(255, 243, 220, 0.85)';
  ctx.fill();
}

/** Creates a canvas with the card drawn on it (default 320 px wide, height = width / CARD_ASPECT). */
export function makeCardCanvas(card: CardFace | 'back', width = 320): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(w / CARD_ASPECT));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (card === 'back') drawCardBack(ctx, w, h);
    else drawCardFace(ctx, card, w, h);
  }
  return canvas;
}
