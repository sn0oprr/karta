import '@fontsource/lilita-one';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './styles.css';
import { makeDeck } from '../shared/cards';
import { DRINKS, type DrinkId, type GameMode, type RoomMessage, type RoomView, normalizeRoomCode } from '../shared/protocol';
import { drinkAudio } from './drinkAudio';
import { Board, type SfxName } from './game3d/board';
import { ensureCardFonts } from './game3d/cardArt';
import { prewarmCardTextures, setMaxAnisotropy } from './game3d/cardMesh';
import { Environment } from './game3d/environment';
import { PortraitStudio } from './game3d/portrait';
import { Stage } from './game3d/stage';
import { Table } from './game3d/table';
import { animator } from './game3d/tween';
import { profile, saveProfile } from './identity';
import { Net } from './net';
import { sfx } from './sfx';
import { CafePicker } from './ui/cafe';
import { h, modal, toast } from './ui/dom';
import { renderHome } from './ui/home';
import { Hud } from './ui/hud';
import { Lobby } from './ui/lobby';
import { ChatPanel, EmotePicker, VoicePanel, chooseCapture, showRules } from './ui/panels';
import { ResultsView } from './ui/results';
import { SeatTags } from './ui/tags';
import { VoiceChat } from './voice';

const uiRoot = document.getElementById('ui')!;
const stageEl = document.getElementById('stage')!;

const drinkInfo = (id: DrinkId) => DRINKS.find((d) => d.id === id) ?? DRINKS[0];

function routeCode(): { code: string | null; spectate: boolean } {
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9]{5})\/?$/);
  const params = new URLSearchParams(location.search);
  const code = m ? normalizeRoomCode(m[1]!) : params.get('room') ? normalizeRoomCode(params.get('room')!) : null;
  return { code, spectate: params.has('watch') || params.has('spectate') };
}

class App {
  stage: Stage;
  board: Board;
  net = new Net();
  voice: VoiceChat;
  hud: Hud;
  lobby: Lobby;
  tags: SeatTags;
  chat: ChatPanel;
  emotes: EmotePicker;
  voicePanel: VoicePanel;
  results: ResultsView;
  studio = new PortraitStudio();
  cafe: CafePicker;
  /** In-game pop-up holding the café picker (the lobby shows it inline). */
  private cafePop: HTMLElement;
  private cafeSlot = h('div');

  /** Latest room state from the server. */
  room: RoomView | null = null;
  /** Room state currently shown on the board (lags behind during animations). */
  displayed: RoomView | null = null;
  roomCode: string | null = null;
  private screen: 'home' | 'loading' | 'room' = 'home';
  private homeEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private roomLayer = h('div', { class: 'room-layer' });
  private wasMyTurn = false;
  private env: Environment;

  constructor() {
    this.stage = new Stage(stageEl);
    setMaxAnisotropy(this.stage.renderer.capabilities.getMaxAnisotropy());
    this.env = new Environment(this.stage.scene);
    new Table(this.stage.scene);
    this.board = new Board(this.stage, {
      onPlay: async (move) => {
        const res = await this.net.call('play', move);
        if (!res.ok) toast(res.error, 'error');
        return res.ok;
      },
      chooseCapture: (card, options) => chooseCapture(card, options, (ids) => this.board.highlightOption(ids)),
      onChkobba: (seat) => this.chkobbaBanner(seat),
      onRoundEnd: () => {},
      onDisplayed: (room) => this.onDisplayed(room),
      sfx: (name: SfxName) => sfx.play(name),
      onInvalid: (reason) => toast(reason),
      onSip: () => {
        sfx.unlock();
        this.net.socket.emit('sip');
      },
      drinkSound: (drink, pan) => drinkAudio.play(drink, { pan }),
    });
    this.studio.sound = (drink) => drinkAudio.play(drink);
    this.cafe = new CafePicker(this.studio, (patch) => {
      saveProfile(patch);
      this.net.updateProfile();
      this.cafe.render();
      this.hud.setDrink(drinkInfo(profile.drink).icon);
      drinkAudio.prefetch(profile.drink);
    });
    this.cafePop = h(
      'div',
      { class: 'panel cafe-pop hidden' },
      h(
        'div',
        { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'label', style: 'margin:0' }, '☕ At the café'),
        h('button', { class: 'btn small ghost icon-btn', title: 'Close', onclick: () => this.toggleCafe(false) }, '✕'),
      ),
      this.cafeSlot,
    );
    this.stage.onFrame((dt, t) => {
      this.studio.frame(dt, t);
      this.env.update(t);
      this.voice.updateLevels();
      this.tags.levels = this.voice.levels;
      this.voicePanel.levels(this.voice.levels);
      this.hud.setMicLevel(this.net.id ? (this.voice.levels.get(this.net.id) ?? 0) : 0);
      const room = this.displayed;
      if (room) {
        for (let s = 0; s < room.seats.length; s++) {
          const p = room.seats[s];
          if (p) this.board.setTalking(s, this.voice.levels.get(p.id) ?? 0);
        }
      }
    });

    this.voice = new VoiceChat(this.net);
    this.voice.onChange(() => {
      const v = this.voice.state;
      this.hud.setVoice(v.joined, v.muted, v.hasMic);
    });

    this.hud = new Hud({
      leave: () => this.leaveRoom(),
      rules: () => showRules(),
      toggleChat: () => {
        this.emotes.toggle(false);
        this.toggleCafe(false);
        this.chat.toggle();
      },
      toggleEmotes: () => {
        this.chat.toggle(false);
        this.toggleCafe(false);
        this.emotes.toggle();
      },
      toggleCafe: () => {
        sfx.unlock();
        this.chat.toggle(false);
        this.emotes.toggle(false);
        this.toggleCafe();
      },
      toggleVoice: () => {
        sfx.unlock();
        this.voicePanel.toggle();
      },
      toggleMic: () => this.voice.toggleMute(),
      rotateView: (step) => this.board.rotateSpectatorView(step),
      takeSeat: (seat) => void this.act('sit', { seat }),
    });
    this.hud.setDrink(drinkInfo(profile.drink).icon);
    this.lobby = new Lobby(
      {
        sit: (seat) => void this.act('sit', { seat }),
        stand: () => void this.act('stand'),
        addBot: (seat) => void this.act('addBot', { seat }),
        removeBot: (seat) => void this.act('removeBot', { seat }),
        kick: (playerId) => void this.act('kick', { playerId }),
        settings: (patch) => void this.act('settings', patch),
        start: () => void this.act('start'),
        leave: () => this.leaveRoom(),
      },
      { cafe: this.cafe.el, portrait: (p) => this.studio.characterURL(p.character, p.skin, p.color) },
    );
    this.tags = new SeatTags(this.stage, this.board);
    // The camera frames the table around the HUD.
    this.stage.setOverlaySource(() => this.hud.overlayRects());
    this.chat = new ChatPanel((text) => this.net.socket.emit('chat', { text }));
    this.chat.onUnread = (n) => this.hud.setUnread(n);
    this.emotes = new EmotePicker((id) => this.net.socket.emit('emote', { id }));
    this.voicePanel = new VoicePanel(this.voice);
    this.results = new ResultsView({
      continue: () => this.net.socket.emit('continue'),
      rematch: () => void this.act('rematch'),
      toLobby: () => void this.act('toLobby'),
      leave: () => this.leaveRoom(),
    });
    this.roomLayer.append(this.tags.el, this.hud.el, this.lobby.el, this.chat.el, this.emotes.el, this.cafePop, this.voicePanel.el);

    this.bindNet();
    // The render loop pauses in background tabs: finish animations instantly there so the
    // game state (and the "your turn" alert) keeps flowing.
    const syncSpeed = () => {
      if (document.hidden) {
        animator.speed = 0;
        animator.finishAll();
      } else animator.speed = 1;
    };
    document.addEventListener('visibilitychange', syncSpeed);
    syncSpeed();
    window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    window.addEventListener('popstate', () => this.route());
    this.stage.start();
    this.route();
  }

  // ───────────────────────────── networking ─────────────────────────────

  private bindNet() {
    const s = this.net.socket;
    s.on('room', (m: RoomMessage) => this.onRoomMessage(m));
    s.on('chat', (m) => this.chat.add(m));
    s.on('chatHistory', (list) => {
      this.chat.clear();
      for (const m of list) this.chat.add(m, true);
    });
    s.on('emote', ({ from, id }) => {
      const text = this.tags.emoteText(id);
      this.tags.bubble(from, text);
      const who = [...(this.room?.seats ?? []), ...(this.room?.spectators ?? [])].find((p) => p?.id === from);
      if (who) this.chat.add({ id: -1, from, name: who.name, color: who.color, text, ts: Date.now(), system: false }, true);
      sfx.play('pop');
      const seat = this.room?.seats.findIndex((p) => p?.id === from) ?? -1;
      if (seat >= 0) this.board.emote(seat);
    });
    s.on('sip', ({ from }) => {
      // Seats as shown on the board (it may still be catching up with the latest state).
      const seat = (this.displayed ?? this.room)?.seats.findIndex((p) => p?.id === from) ?? -1;
      if (seat >= 0) this.board.sip(seat);
    });
    s.on('left', ({ reason }) => {
      if (reason === 'elsewhere') toast('You opened this table in another tab.', 'error', 4000);
      else if (reason === 'kicked') toast('The host removed you from the table.', 'error', 4000);
      else if (reason === 'closed') toast('The table was closed.', 'error');
      this.roomCode = null;
      this.goHome();
    });
    s.on('connect', () => {
      // Re-attach to the room after a reconnect.
      if (this.roomCode && this.screen === 'room') void this.net.call('join', { code: this.roomCode });
    });
    s.on('disconnect', () => {
      if (this.screen === 'room') toast('Connection lost — reconnecting…', 'error');
    });
    s.on('connect_error', () => {
      if (this.screen === 'loading') toast('Cannot reach the server, retrying…', 'error');
    });
  }

  private async act(event: 'sit' | 'stand' | 'addBot' | 'removeBot' | 'kick' | 'settings' | 'start' | 'rematch' | 'toLobby', payload?: unknown) {
    const res = await this.net.call(event, payload);
    if (!res.ok) toast(res.error, 'error');
  }

  private onRoomMessage(m: RoomMessage) {
    const first = !this.room || this.room.code !== m.room.code;
    const before = new Map((first ? [] : this.room!.seats).flatMap((p) => (p ? [[p.id, p.drink] as const] : [])));
    this.room = m.room;
    if (first) this.enterRoomScreen();
    for (const p of m.room.seats) {
      if (!p) continue;
      drinkAudio.prefetch(p.drink);
      // A new order: they call it out to the waiter.
      const prev = before.get(p.id);
      if (prev && prev !== p.drink) {
        const d = drinkInfo(p.drink);
        this.tags.bubble(p.id, `${d.icon} ${d.order}`);
      }
    }
    // Meta (lobby, voice, tags) reacts immediately; the board animates game events in order.
    this.voice.sync(m.room);
    this.voicePanel.update(m.room);
    const inLobby = m.room.phase === 'lobby';
    this.lobby.el.classList.toggle('hidden', !inLobby);
    if (inLobby) {
      // The lobby shows the café picker itself.
      this.toggleCafe(false);
      this.lobby.update(m.room);
    }
    else if (this.screen === 'room') this.hud.el.classList.remove('in-lobby');
    this.board.push(m);
    if (this.displayed) {
      // Keep connection/voice indicators fresh even while animations are running.
      this.tags.update({ ...this.displayed, seats: m.room.seats, voice: m.room.voice, hostId: m.room.hostId, serverTime: m.room.serverTime });
    }
  }

  private onDisplayed(room: RoomView) {
    const prevPhase = this.displayed?.phase;
    this.displayed = room;
    this.tags.update({ ...room, seats: this.room?.seats ?? room.seats, voice: this.room?.voice ?? room.voice });
    const inLobby = room.phase === 'lobby' && this.room?.phase === 'lobby';
    this.lobby.el.classList.toggle('hidden', this.room?.phase !== 'lobby');
    this.hud.el.classList.toggle('in-lobby', inLobby);
    for (const el of this.hud.el.querySelectorAll<HTMLElement>('.scoreboard, .turn-banner')) el.classList.toggle('hidden', inLobby);
    if (inLobby) this.lobby.update(this.room ?? room);
    this.hud.update(room, { myTurnReady: this.board.myTurnReady, busy: this.board.isAnimating });
    this.results.sync(room, this.tags.offset);
    if (room.phase === 'gameOver' && prevPhase !== 'gameOver') this.board.celebrateWinner(room);

    const myTurn = room.phase === 'playing' && room.game?.turn === room.you.seat && room.you.seat !== null;
    if (myTurn && !this.wasMyTurn) {
      sfx.play('myTurn');
      if (document.hidden) this.flashTitle();
    }
    this.wasMyTurn = myTurn;
    setTimeout(() => this.hud.update(room, { myTurnReady: this.board.myTurnReady, busy: false }), 50);
  }

  private cafeOpen = false;

  /** Opens or closes the café pop-up (in game; the lobby shows the picker inline). */
  private toggleCafe(force?: boolean) {
    const open = force ?? !this.cafeOpen;
    if (open === this.cafeOpen) return;
    this.cafeOpen = open;
    if (open) {
      this.cafeSlot.appendChild(this.cafe.el);
      this.cafe.render();
    }
    this.cafePop.classList.toggle('hidden', !open);
  }

  private titleTimer: ReturnType<typeof setInterval> | null = null;
  private flashTitle() {
    if (this.titleTimer) return;
    const orig = document.title;
    let on = false;
    this.titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? '🃏 Your turn!' : orig;
    }, 900);
    const stop = () => {
      if (this.titleTimer) clearInterval(this.titleTimer);
      this.titleTimer = null;
      document.title = orig;
      document.removeEventListener('visibilitychange', stop);
    };
    document.addEventListener('visibilitychange', stop);
  }

  private chkobbaBanner(seat: number) {
    const room = this.displayed ?? this.room;
    const p = room?.seats[seat];
    const who = seat === room?.you.seat ? 'Bravo! You swept the table!' : `${p?.name ?? 'Someone'} swept the table!`;
    const el = h('div', { class: 'big-banner' }, h('div', { class: 'word' }, 'CHKOBBA!'), h('div', { class: 'who' }, who));
    uiRoot.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ───────────────────────────── screens ─────────────────────────────

  private route() {
    const { code, spectate } = routeCode();
    if (this.screen === 'room' && this.roomCode && code !== this.roomCode) {
      this.net.socket.emit('leave');
      this.roomCode = null;
    }
    if (code && code === this.roomCode && this.screen === 'room') return;
    if (code && code.length === 5) {
      if (profile.named) void this.joinRoom(code, spectate);
      else this.goHome({ prefillCode: code, spectate });
    } else this.goHome();
  }

  private clearScreens() {
    this.homeEl?.remove();
    this.homeEl = null;
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  goHome(opts: { prefillCode?: string; spectate?: boolean } = {}) {
    this.screen = 'home';
    this.clearScreens();
    this.roomLayer.remove();
    this.results.close();
    this.room = null;
    this.displayed = null;
    this.chat.toggle(false);
    this.toggleCafe(false);
    this.voicePanel.toggle(false);
    this.voice.leave();
    this.board.showMenu();
    if (!opts.prefillCode && location.pathname !== '/') history.pushState(null, '', '/');
    this.homeEl = renderHome(
      {
        create: (mode) => this.createRoom(mode),
        join: (code, spectate) => this.joinRoom(code, spectate),
        rules: () => showRules(),
        profileChanged: () => this.net.updateProfile(),
      },
      opts,
    );
    uiRoot.appendChild(this.homeEl);
  }

  private showLoading(text: string) {
    this.clearScreens();
    this.screen = 'loading';
    this.loadingEl = h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), text));
    uiRoot.appendChild(this.loadingEl);
  }

  private async createRoom(mode: GameMode) {
    saveProfile({ named: true });
    this.net.updateProfile();
    this.showLoading('Setting the table…');
    await this.net.ready();
    const res = await this.net.call<{ code: string }>('create', { settings: { mode } });
    if (!res.ok) {
      toast(res.error, 'error');
      this.goHome();
      return;
    }
    this.roomCode = res.code;
    history.pushState(null, '', `/room/${res.code}`);
  }

  private async joinRoom(code: string, spectate: boolean) {
    saveProfile({ named: true });
    this.net.updateProfile();
    this.showLoading(`Joining table ${code}…`);
    await this.net.ready();
    const res = await this.net.call<{ code: string }>('join', { code, spectate });
    if (!res.ok) {
      toast(res.error, 'error', 4000);
      this.goHome({ prefillCode: undefined });
      return;
    }
    this.roomCode = res.code;
    if (location.pathname !== `/room/${res.code}`) history.pushState(null, '', `/room/${res.code}`);
  }

  private enterRoomScreen() {
    this.clearScreens();
    this.screen = 'room';
    if (!this.roomLayer.parentElement) uiRoot.appendChild(this.roomLayer);
    // The colour may have changed on the home screen.
    this.cafe.render();
    drinkAudio.prefetch(profile.drink);
    sfx.play('join');
  }

  private leaveRoom() {
    sfx.play('click');
    const room = this.room;
    const seated = room && room.you.seat !== null;
    const inGame = room && (room.phase === 'playing' || room.phase === 'roundOver');
    if (seated && inGame) {
      const body = h(
        'div',
        null,
        h('h2', null, 'Leave the table?'),
        h('p', { style: 'text-align:center' }, 'A bot will take your seat so the others can keep playing. You can come back with the link and watch, or take a seat again.'),
      );
      const m = modal(body);
      body.append(
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Stay'),
          h(
            'button',
            {
              class: 'btn coral',
              onclick: () => {
                m.close();
                this.doLeave();
              },
            },
            'Leave',
          ),
        ),
      );
      return;
    }
    this.doLeave();
  }

  private doLeave() {
    this.net.socket.emit('leave');
    this.roomCode = null;
    this.goHome();
  }
}

async function boot() {
  // Fonts are needed by the card art: wait (briefly) before building textures.
  await ensureCardFonts();
  const app = new App();
  // Build every card texture up front so the first deal does not stutter.
  const ids = makeDeck().map((c) => c.id);
  const warm = () => prewarmCardTextures(app.stage.renderer, ids);
  if ('requestIdleCallback' in window) (window as Window).requestIdleCallback(warm, { timeout: 1500 });
  else setTimeout(warm, 300);
  (window as unknown as { karta: App }).karta = app;
}

void boot();
