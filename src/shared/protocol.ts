/**
 * Client ⇄ server contract (Socket.IO events and payloads).
 */
import type { Card } from './cards';
import type { Move, PlayInfo, RoundResult, Team } from './chkobba';

export type GameMode = '1v1' | '2v2';
export const TARGET_SCORES = [11, 21, 31] as const;
export type TargetScore = (typeof TARGET_SCORES)[number];
export const TURN_TIMERS = [0, 15, 30, 60] as const;
export type TurnTimer = (typeof TURN_TIMERS)[number];

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevelSetting = (typeof BOT_LEVELS)[number];

export interface RoomSettings {
  mode: GameMode;
  targetScore: TargetScore;
  /** Seconds per turn; 0 = unlimited. When time runs out the move is played automatically. */
  turnSeconds: TurnTimer;
  botLevel: BotLevelSetting;
}

export const DEFAULT_SETTINGS: RoomSettings = { mode: '1v1', targetScore: 21, turnSeconds: 0, botLevel: 'normal' };

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

export const NAME_MAX = 18;
export const CHAT_MAX = 200;

export interface Profile {
  name: string;
  color: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
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

export interface GameView {
  round: number;
  dealer: number;
  turn: number;
  deckCount: number;
  table: Card[];
  handCounts: number[];
  /** The viewer's own hand (null for spectators). */
  myHand: Card[] | null;
  pileCounts: number[];
  /** Cards that made a chkobba, kept face up on each seat's pile. */
  chkobbaCards: Card[][];
  scores: [number, number];
  lastCapturer: number | null;
  lastPlay: PlayInfo | null;
  lastRound: RoundResult | null;
  winner: Team | null;
  /** Epoch ms (server clock) when the current turn times out, or null. */
  turnDeadline: number | null;
  /** Ids of players who are ready for the next hand (roundOver phase). */
  ready: string[];
  /** Epoch ms (server clock) when the next hand starts automatically (roundOver phase). */
  nextRoundAt: number | null;
}

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

export type GameEvent = DealEvent | PlayEvent | RoundEndEvent | GameStartEvent;

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
  play: (move: Move, ack: Ack) => void;
  continue: () => void;
  rematch: (ack: Ack) => void;
  toLobby: (ack: Ack) => void;
  chat: (p: { text: string }) => void;
  emote: (p: { id: EmoteId }) => void;
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
  'voice:signal': (p: { from: string; data: unknown }) => void;
}

export interface HandshakeAuth {
  secret: string;
  name: string;
  color: number;
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
