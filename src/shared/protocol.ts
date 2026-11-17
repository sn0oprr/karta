/**
 * Client ⇄ server contract (Socket.IO events and payloads).
 */
import type { Card, Suit } from './cards';
import type {
  BCard,
  BeloteRoundResult,
  BidInfo,
  BeloteTrickInfo,
  DeclarationsResult,
  PublicDeclaration,
  TrickPlay,
} from './belote';
import { BELOTE_TARGETS } from './belote';
import type { PlayInfo, RoundResult } from './chkobba';
import type { Team } from './teams';

export type GameMode = '1v1' | '2v2';

export const GAMES = ['chkobba', 'belote'] as const;
export type GameKind = (typeof GAMES)[number];

/** Chkobba's targets (Belote's are BELOTE_TARGETS). */
export const TARGET_SCORES = [11, 21, 31] as const;

export interface GameInfo {
  name: string;
  /** The name in Arabic script. */
  arabic: string;
  modes: readonly GameMode[];
  targets: readonly number[];
  defaultTarget: number;
}

export const GAME_INFO: Readonly<Record<GameKind, GameInfo>> = {
  chkobba: { name: 'Chkobba', arabic: 'شكبّة', modes: ['1v1', '2v2'], targets: TARGET_SCORES, defaultTarget: 21 },
  belote: { name: 'Belote', arabic: 'بلوت', modes: ['2v2'], targets: BELOTE_TARGETS, defaultTarget: 501 },
};

export function isGameKind(v: unknown): v is GameKind {
  return GAMES.includes(v as GameKind);
}

export const TURN_TIMERS = [0, 15, 30, 60] as const;
export type TurnTimer = (typeof TURN_TIMERS)[number];

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevelSetting = (typeof BOT_LEVELS)[number];

export interface RoomSettings {
  game: GameKind;
  mode: GameMode;
  /** Points to reach: one of the game's `targets`. */
  targetScore: number;
  /** Seconds per turn; 0 = unlimited. When time runs out the move is played automatically. */
  turnSeconds: TurnTimer;
  botLevel: BotLevelSetting;
  /** Belote: tierces, cinquantes, cents and carrés count. */
  announcements: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  game: 'chkobba',
  mode: '1v1',
  targetScore: 21,
  turnSeconds: 0,
  botLevel: 'normal',
  announcements: true,
};

export function seatCount(mode: GameMode): 2 | 4 {
  return mode === '1v1' ? 2 : 4;
}

/** Avatar shirt colours (index stored in the profile). */
export const AVATAR_COLORS = [
  '#ff6b6b', // coral
  '#2ec4b6', // teal
  '#ffbe0b', // sunflower
  '#8e7dff', // lavender
  '#ff8fab', // pink
  '#3a86ff', // sea blue
  '#06d6a0', // mint
  '#fb8500', // orange
] as const;

/** Who you are at the café table: one of the regulars… */
export const REGULARS = [
  { id: 'hajj', name: 'El Hajj', hint: 'Old man in a red chechia' },
  { id: 'wled', name: 'Wled 7ouma', hint: 'Guy from the neighbourhood' },
  { id: 'patron', name: 'El Patron', hint: 'The café boss' },
  { id: 'sportif', name: 'Sportif', hint: 'Cap on backwards' },
  { id: 'lella', name: 'Lella', hint: 'Jasmine behind the ear' },
  { id: 'hajja', name: 'El Hajja', hint: 'Grandma in her headscarf' },
  { id: 'taleba', name: 'Taleba', hint: 'Curly-haired student' },
  { id: 'nejma', name: 'Nejma', hint: 'The star of the café' },
] as const;

/**
 * …or one of the crew: real friends, drawn after their own portraits (shown in the café menu).
 * Picking one also gives you its name, unless you typed your own. Bots never play them.
 */
export const CREW = [
  { id: 'rafaa', name: 'Rafaa', hint: 'Shades and a puffer jacket' },
  { id: 'nini', name: 'NiNi Nina', hint: 'Turtleneck and tinted glasses' },
  { id: 'tha3loub', name: 'Tha3loub', hint: 'Sleepy eyes and a big beard' },
  { id: 'ta7foun', name: 'ta7foun', hint: 'Big grin and a grey hoodie' },
  { id: 'sn0opr', name: 'Sn0opr', hint: 'Polo shirt and a crossbody bag' },
  { id: 'bou3ish', name: 'Bou3ish', hint: 'No shirt, big smile' },
  { id: '7saan', name: '7saan', hint: 'Curls, glasses and a big moustache' },
  { id: 'habboub', name: 'habboub', hint: 'Curls and round glasses' },
  { id: 'gratos', name: 'Gratos', hint: 'Shades and the red-and-yellow jersey' },
] as const;

export const CHARACTERS = [...REGULARS, ...CREW] as const;
export type CharacterId = (typeof CHARACTERS)[number]['id'];
export type CrewId = (typeof CREW)[number]['id'];

export const SKIN_TONES = ['#f6c9a0', '#e8b088', '#d39a6a', '#b97a4f', '#8d5a3a'] as const;

/** What you order from the café. Tap it on the table to take a sip. */
export const DRINKS = [
  { id: 'express', name: 'Express', icon: '☕', order: 'Wa7ed express!' },
  { id: 'tea', name: 'Tea', icon: '🍵', order: 'Tay bel bondok!' },
  { id: 'chicha', name: 'Chicha', icon: '💨', order: 'Jibli chicha!' },
  { id: 'coke', name: 'Coke', icon: '🥤', order: 'Wa7da Coca!' },
] as const;
export type DrinkId = (typeof DRINKS)[number]['id'];

export function isCharacter(v: unknown): v is CharacterId {
  return CHARACTERS.some((c) => c.id === v);
}

export function isCrew(v: unknown): v is CrewId {
  return CREW.some((c) => c.id === v);
}

export function isDrink(v: unknown): v is DrinkId {
  return DRINKS.some((d) => d.id === v);
}

export function isSkin(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < SKIN_TONES.length;
}

export const NAME_MAX = 18;
export const CHAT_MAX = 200;

export interface Profile {
  name: string;
  color: number;
  character: CharacterId;
  skin: number;
  drink: DrinkId;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  character: CharacterId;
  skin: number;
  drink: DrinkId;
  bot: boolean;
  connected: boolean;
  /** The server is playing for this (disconnected) player. */
  autopilot: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'roundOver' | 'gameOver';

export interface VoiceMember {
  id: string;
  muted: boolean;
}

/** Most people in one table's voice chat (a full mesh: everyone connects to everyone). */
export const VOICE_MAX = 12;

/** What every game's view has. */
export interface GameViewBase {
  round: number;
  dealer: number;
  /** The seat the table waits for (to play, or to bid). */
  turn: number;
  handCounts: number[];
  /** Cards in each seat's pile of captured cards / won tricks. */
  pileCounts: number[];
  scores: [number, number];
  winner: Team | null;
  /** Epoch ms (server clock) when the current turn times out, or null. */
  turnDeadline: number | null;
  /** Ids of players who are ready for the next hand (roundOver phase). */
  ready: string[];
  /** Epoch ms (server clock) when the next hand starts automatically (roundOver phase). */
  nextRoundAt: number | null;
}

export interface ChkobbaView extends GameViewBase {
  kind: 'chkobba';
  deckCount: number;
  table: Card[];
  /** The viewer's own hand (null for spectators). */
  myHand: Card[] | null;
  /** Cards that made a chkobba, kept face up on each seat's pile. */
  chkobbaCards: Card[][];
  lastCapturer: number | null;
  lastPlay: PlayInfo | null;
  lastRound: RoundResult | null;
}

export interface BeloteView extends GameViewBase {
  kind: 'belote';
  /** Bidding while the turned card is up, then playing tricks; done once the last trick is in. */
  stage: 'bidding' | 'playing' | 'done';
  bidRound: 1 | 2;
  /** The card turned up for the bidding; once taken, the taker holds it until they play it. */
  upCard: BCard | null;
  /** Face-down cards left to deal (11 during the bidding). */
  stockCount: number;
  /** Bids of the current deal. */
  bids: BidInfo[];
  trump: Suit | null;
  taker: number | null;
  /** The viewer's own hand (null for spectators). */
  myHand: BCard[] | null;
  /** The trick in progress, in play order. */
  trick: TrickPlay[];
  /** The last completed trick of this hand. */
  lastTrick: Pick<BeloteTrickInfo, 'plays' | 'winner'> | null;
  /** Tricks won by each seat this hand. */
  tricksWon: number[];
  /** Who said "Belote", and how many of the King and Queen of trumps they have played. */
  belote: { seat: number; stage: number } | null;
  /** Announcements made so far this hand. */
  declared: PublicDeclaration[];
  /** After the first trick: whose announcements count (their cards are shown). */
  declResult: DeclarationsResult | null;
  /** Points of a litige waiting for the winner of a hand. */
  reserve: number;
  announcements: boolean;
  lastRound: BeloteRoundResult | null;
}

export type GameView = ChkobbaView | BeloteView;

export interface RoomView {
  code: string;
  hostId: string;
  settings: RoomSettings;
  phase: RoomPhase;
  seats: (PlayerInfo | null)[];
  spectators: PlayerInfo[];
  voice: VoiceMember[];
  game: GameView | null;
  you: { id: string; seat: number | null };
  /** Server clock at emission, to align deadlines with the client clock. */
  serverTime: number;
  /** Increases with every broadcast of this room. */
  version: number;
}

/** Deal as seen by one viewer: other players' cards stay hidden. */
export interface DealEvent {
  kind: 'deal';
  round: number;
  dealer: number;
  initial: boolean;
  order: number[];
  table: Card[];
  /** Viewer's newly dealt cards (null for spectators). */
  myCards: Card[] | null;
  redeals: number;
  deckCountAfter: number;
}

export interface PlayEvent {
  kind: 'play';
  play: PlayInfo;
  /** Move was made automatically (timeout / autopilot). */
  auto: boolean;
}

export interface RoundEndEvent {
  kind: 'roundEnd';
  result: RoundResult;
}

export interface GameStartEvent {
  kind: 'gameStart';
}

/** Belote: 5 cards each and one turned up (also after everybody passed twice: `redeals` > 0). */
export interface BeloteDealEvent {
  kind: 'beloteDeal';
  round: number;
  dealer: number;
  order: number[];
  /** Viewer's cards (null for spectators). */
  myCards: BCard[] | null;
  turned: BCard;
  stockAfter: number;
  redeals: number;
}

export interface BeloteBidEvent {
  kind: 'beloteBid';
  bid: BidInfo;
  auto: boolean;
}

/** Belote: someone took; the taker picks up the turned card and the rest is dealt. */
export interface BeloteTakeEvent {
  kind: 'beloteTake';
  taker: number;
  trump: Suit;
  turned: BCard;
  order: number[];
  /** Viewer's new cards, the turned card not included (null for spectators). */
  myCards: BCard[] | null;
}

export interface BelotePlayEvent {
  kind: 'belotePlay';
  seat: number;
  card: BCard;
  belote: 'belote' | 'rebelote' | null;
  /** Announcements made with this card. */
  declared: PublicDeclaration[];
  auto: boolean;
}

export interface BeloteTrickEvent {
  kind: 'beloteTrick';
  trick: BeloteTrickInfo;
  /** After the first trick: whose announcements count. */
  declResult: DeclarationsResult | null;
}

export interface BeloteEndEvent {
  kind: 'beloteEnd';
  result: BeloteRoundResult;
}

export type GameEvent =
  | DealEvent
  | PlayEvent
  | RoundEndEvent
  | GameStartEvent
  | BeloteDealEvent
  | BeloteBidEvent
  | BeloteTakeEvent
  | BelotePlayEvent
  | BeloteTrickEvent
  | BeloteEndEvent;

export interface RoomMessage {
  room: RoomView;
  events: GameEvent[];
}

export interface ChatMessage {
  id: number;
  from: string | null;
  name: string;
  color: number;
  text: string;
  ts: number;
  system: boolean;
}

export const EMOTES = [
  { id: 'sahha', text: 'Ya3tik sa77a!', icon: '👏' },
  { id: 'mabrouk', text: 'Mabrouk!', icon: '🎉' },
  { id: 'yezzi', text: 'Yezzi ba3d!', icon: '😤' },
  { id: 'ghaleb', text: 'Allah ghaleb…', icon: '🤷' },
  { id: 'fissa', text: 'Fissa, fissa!', icon: '⏰' },
  { id: 'chkobba', text: 'Chkobba jeya!', icon: '🔥' },
  { id: 'haha', text: 'Hahaha!', icon: '😂' },
  { id: 'tea', text: 'Tay bel bondok?', icon: '🍵' },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];

export interface PlayRequest {
  cardId: string;
  /** Chkobba: ids of the table cards captured. */
  capture?: string[];
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface Welcome {
  id: string;
  iceServers: IceServerConfig[];
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  profile: (p: Profile) => void;
  create: (p: { settings?: Partial<RoomSettings> }, ack: Ack<{ code: string }>) => void;
  join: (p: { code: string; spectate?: boolean }, ack: Ack<{ code: string }>) => void;
  leave: () => void;
  sit: (p: { seat: number }, ack: Ack) => void;
  stand: (ack: Ack) => void;
  settings: (p: Partial<RoomSettings>, ack: Ack) => void;
  addBot: (p: { seat: number }, ack: Ack) => void;
  removeBot: (p: { seat: number }, ack: Ack) => void;
  kick: (p: { playerId: string }, ack: Ack) => void;
  start: (ack: Ack) => void;
  /** Plays a card (Chkobba: with the table cards it captures). */
  play: (move: PlayRequest, ack: Ack) => void;
  /** Belote: take with a trump suit, or pass (null). */
  bid: (p: { suit: Suit | null }, ack: Ack) => void;
  continue: () => void;
  rematch: (ack: Ack) => void;
  toLobby: (ack: Ack) => void;
  chat: (p: { text: string }) => void;
  emote: (p: { id: EmoteId }) => void;
  /** A seated player sips their drink (or puffs their chicha). */
  sip: () => void;
  'voice:join': (p: { muted: boolean }, ack: Ack) => void;
  'voice:leave': () => void;
  'voice:mute': (p: { muted: boolean }) => void;
  'voice:signal': (p: { to: string; data: unknown }) => void;
}

export interface ServerToClient {
  welcome: (w: Welcome) => void;
  room: (m: RoomMessage) => void;
  left: (p: { reason: 'kicked' | 'closed' | 'left' | 'elsewhere' }) => void;
  chat: (m: ChatMessage) => void;
  chatHistory: (m: ChatMessage[]) => void;
  emote: (p: { from: string; id: EmoteId }) => void;
  /** Someone else at the table took a sip (the sender animates their own sip locally). */
  sip: (p: { from: string }) => void;
  'voice:signal': (p: { from: string; data: unknown }) => void;
}

export interface HandshakeAuth {
  secret: string;
  name: string;
  color: number;
  character: CharacterId;
  skin: number;
  drink: DrinkId;
}

/** Room codes avoid look-alike characters (no I, O, 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
