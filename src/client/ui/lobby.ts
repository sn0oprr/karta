import { teamOf } from '../../shared/chkobba';
import {
  AVATAR_COLORS,
  BOT_LEVELS,
  type PlayerInfo,
  type RoomSettings,
  type RoomView,
  TARGET_SCORES,
  TURN_TIMERS,
} from '../../shared/protocol';
import { sfx } from '../sfx';
import { copyText, h, initials, toast } from './dom';

export interface LobbyActions {
  sit: (seat: number) => void;
  stand: () => void;
  addBot: (seat: number) => void;
  removeBot: (seat: number) => void;
  kick: (playerId: string) => void;
  settings: (patch: Partial<RoomSettings>) => void;
  start: () => void;
  leave: () => void;
}

export function roomLink(code: string, spectate = false): string {
  return `${location.origin}/room/${code}${spectate ? '?watch=1' : ''}`;
}

export async function shareRoom(code: string) {
  const url = roomLink(code);
  const text = `Join my Chkobba table on Karta! Code ${code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Karta · Chkobba', text, url });
      return;
    } catch {
      /* cancelled → fall back to copy */
    }
  }
  if (await copyText(url)) toast('Invite link copied — send it to your friends!');
  else toast(url);
}

export function avatarDot(p: PlayerInfo | null, size = 34): HTMLElement {
  return h(
    'span',
    {
      class: 'avatar-dot',
      style: { background: p ? (AVATAR_COLORS[p.color] ?? '#ccc') : 'transparent', width: `${size}px`, height: `${size}px` },
    },
    p ? (p.bot ? '🤖' : initials(p.name)) : '',
  );
}

export class Lobby {
  readonly el: HTMLElement;
  private body: HTMLElement;

  private footer: HTMLElement;

  constructor(private readonly actions: LobbyActions) {
    this.body = h('div', { class: 'lobby-scroll' });
    this.footer = h('div', { class: 'lobby-footer' });
    this.el = h('div', { class: 'lobby' }, this.body, this.footer);
  }

  update(room: RoomView) {
    const me = room.you.id;
    const isHost = room.hostId === me;
    const n = room.seats.length;
    const full = room.seats.every(Boolean);
    const mySeat = room.you.seat;

    const codeCard = h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'room-code' },
        h('div', null, h('div', { class: 'label' }, 'Table code'), h('div', { class: 'code' }, room.code)),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn small blue',
              onclick: () => {
                sfx.play('click');
                void shareRoom(room.code);
              },
            },
            '🔗 Invite',
          ),
          h(
            'button',
            {
              class: 'btn small ghost icon-btn',
              title: 'Copy code',
              onclick: async () => {
                sfx.play('click');
                if (await copyText(room.code)) toast(`Code ${room.code} copied`);
              },
            },
            '📋',
          ),
        ),
      ),
      h('div', { class: 'muted', style: 'margin-top:8px' }, 'Friends join with the link or the code. Anyone extra can watch as a spectator.'),
    );

    const seatRow = (seat: number) => {
      const p = room.seats[seat] ?? null;
      const isMe = p?.id === me;
      const actions: HTMLElement[] = [];
      if (!p) {
        if (mySeat === null || mySeat !== seat) {
          actions.push(h('button', { class: 'btn small', onclick: () => this.actions.sit(seat) }, mySeat === null ? 'Sit' : 'Move'));
        }
        if (isHost) actions.push(h('button', { class: 'btn small ghost', title: 'Add a computer player', onclick: () => this.actions.addBot(seat) }, '+ 🤖'));
      } else if (isHost && !isMe) {
        actions.push(
          h(
            'button',
            {
              class: 'btn small ghost icon-btn',
              title: p.bot ? 'Remove bot' : 'Remove player',
              onclick: () => (p.bot ? this.actions.removeBot(seat) : this.actions.kick(p.id)),
            },
            '✕',
          ),
        );
      }
      const meta: (string | HTMLElement)[] = [];
      if (p) {
        if (isMe) meta.push(h('span', { class: 'badge' }, 'you'));
        if (p.id === room.hostId) meta.push(h('span', { class: 'badge host' }, 'host'));
        if (p.bot) meta.push(h('span', { class: 'badge bot' }, `bot · ${room.settings.botLevel}`));
        if (!p.connected) meta.push(h('span', { class: 'badge away' }, 'offline'));
      }
      return h(
        'div',
        { class: `seat ${p ? '' : 'empty'} ${isMe ? 'me' : ''}` },
        avatarDot(p),
        h(
          'div',
          { class: 'grow', style: 'flex:1;min-width:0' },
          h('div', { class: 'name' }, p ? p.name : 'Empty seat'),
          h('div', { class: 'meta' }, ...(p ? meta : ['Waiting for a player…'])),
        ),
        ...actions,
      );
    };

    const seats = h('div', { class: 'seat-list' });
    if (n === 4) {
      for (const team of [0, 1] as const) {
        seats.appendChild(
          h(
            'div',
            { class: 'team-head' },
            h('span', { class: 'team-dot', style: { background: team === 0 ? 'var(--team-a)' : 'var(--team-b)' } }),
            team === 0 ? 'Team A' : 'Team B',
            h('span', { class: 'muted', style: 'font-family:var(--font);font-size:.8rem' }, ' · partners sit opposite'),
          ),
        );
        for (let s = 0; s < n; s++) if (teamOf(s) === team) seats.appendChild(seatRow(s));
      }
    } else {
      for (let s = 0; s < n; s++) seats.appendChild(seatRow(s));
    }

    const spectators = room.spectators.length
      ? h(
          'div',
          null,
          h('div', { class: 'label', style: 'margin-top:8px' }, `👀 Spectators (${room.spectators.length})`),
          h(
            'div',
            { class: 'spectators' },
            ...room.spectators.map((p) =>
              h('span', { class: 'chip' }, avatarDot(p, 20), p.name, p.id === me ? h('span', { class: 'badge' }, 'you') : null),
            ),
          ),
        )
      : null;

    const seatsCard = h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' },
        h('div', { class: 'label', style: 'margin:0' }, `Players (${room.seats.filter(Boolean).length}/${n})`),
        mySeat !== null ? h('button', { class: 'btn small ghost', onclick: () => this.actions.stand() }, '👀 Just watch') : null,
      ),
      seats,
      spectators,
    );

    const seg = <T extends string | number>(values: readonly T[], current: T, label: (v: T) => string, onPick: (v: T) => void) =>
      h(
        'div',
        { class: 'seg' },
        ...values.map((v) =>
          h(
            'button',
            {
              class: v === current ? 'on' : '',
              disabled: !isHost,
              onclick: () => {
                if (!isHost || v === current) return;
                sfx.play('click');
                onPick(v);
              },
            },
            label(v),
          ),
        ),
      );

    const s = room.settings;
    const settingsCard = h(
      'div',
      { class: 'panel' },
      h('div', { class: 'label' }, isHost ? 'Table settings' : 'Table settings (host decides)'),
      h(
        'div',
        { class: 'settings-grid' },
        h('span', { class: 'label' }, 'Mode'),
        seg(['1v1', '2v2'] as const, s.mode, (v) => (v === '1v1' ? '1 vs 1' : '2 vs 2'), (v) => this.actions.settings({ mode: v })),
        h('span', { class: 'label' }, 'Play to'),
        seg(TARGET_SCORES, s.targetScore, (v) => String(v), (v) => this.actions.settings({ targetScore: v })),
        h('span', { class: 'label' }, 'Turn timer'),
        seg(TURN_TIMERS, s.turnSeconds, (v) => (v === 0 ? 'Off' : `${v}s`), (v) => this.actions.settings({ turnSeconds: v })),
        h('span', { class: 'label' }, 'Bots'),
        seg(BOT_LEVELS, s.botLevel, (v) => v[0]!.toUpperCase() + v.slice(1), (v) => this.actions.settings({ botLevel: v })),
      ),
    );

    const startBtn = isHost
      ? h(
          'button',
          {
            class: 'btn big',
            disabled: !full,
            onclick: () => {
              sfx.play('click');
              this.actions.start();
            },
          },
          full ? '▶ Start the game' : `Waiting for ${room.seats.filter((x) => !x).length} more…`,
        )
      : h('div', { class: 'chip', style: 'flex:1;justify-content:center;padding:.8em' }, full ? 'Waiting for the host to start…' : 'Waiting for players…');

    const actionsRow = h(
      'div',
      { class: 'lobby-actions' },
      h('button', { class: 'btn coral', style: 'flex:0 0 auto', title: 'Leave the table', onclick: () => this.actions.leave() }, '⟵'),
      startBtn,
    );

    const scroll = this.body.scrollTop;
    this.body.replaceChildren(codeCard, seatsCard, settingsCard);
    this.body.scrollTop = scroll;
    this.footer.replaceChildren(actionsRow);
  }
}
