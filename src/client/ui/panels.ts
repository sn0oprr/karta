import { type Card, cardShort } from '../../shared/cards';
import { AVATAR_COLORS, CHAT_MAX, type ChatMessage, EMOTES, type EmoteId, type GameKind, type RoomView } from '../../shared/protocol';
import { sfx } from '../sfx';
import { VoiceChat } from '../voice';
import { h, modal } from './dom';
import { miniCard } from './miniCard';

// ───────────────────────────── chat ─────────────────────────────

export class ChatPanel {
  readonly el: HTMLElement;
  private log = h('div', { class: 'chat-log' });
  private input: HTMLInputElement;
  private open = false;
  unread = 0;
  onUnread: (n: number) => void = () => {};

  constructor(send: (text: string) => void) {
    this.input = h('input', { class: 'field', maxlength: CHAT_MAX, placeholder: 'Say something…', enterkeyhint: 'send' });
    const submit = () => {
      const t = this.input.value.trim();
      if (!t) return;
      send(t);
      this.input.value = '';
    };
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') this.toggle(false);
    });
    this.el = h(
      'div',
      { class: 'panel chat hidden' },
      h(
        'div',
        { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'label', style: 'margin:0' }, '💬 Table chat'),
        h('button', { class: 'btn small ghost icon-btn', onclick: () => this.toggle(false) }, '✕'),
      ),
      this.log,
      h('div', { class: 'row' }, h('div', { class: 'grow' }, this.input), h('button', { class: 'btn small blue', onclick: submit }, 'Send')),
    );
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) {
      this.unread = 0;
      this.onUnread(0);
      this.log.scrollTop = this.log.scrollHeight;
      if (matchMedia('(pointer: fine)').matches) this.input.focus();
    }
  }

  get isOpen() {
    return this.open;
  }

  clear() {
    this.log.replaceChildren();
    this.unread = 0;
    this.onUnread(0);
  }

  add(m: ChatMessage, quiet = false) {
    const el = m.system
      ? h('div', { class: 'chat-msg system' }, m.text)
      : h(
          'div',
          { class: 'chat-msg' },
          h('b', { style: { color: shade(AVATAR_COLORS[m.color] ?? '#333') } }, `${m.name}: `),
          m.text,
        );
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    this.log.appendChild(el);
    while (this.log.children.length > 120) this.log.firstChild?.remove();
    if (atBottom || !this.open) this.log.scrollTop = this.log.scrollHeight;
    if (!this.open && !m.system && !quiet) {
      this.unread++;
      this.onUnread(this.unread);
      sfx.play('message');
    }
  }
}

function shade(hex: string): string {
  // Darken bright avatar colours a little so names stay readable on cream.
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.7);
  const g = Math.round(((n >> 8) & 255) * 0.7);
  const b = Math.round((n & 255) * 0.7);
  return `rgb(${r},${g},${b})`;
}

// ───────────────────────────── emotes ─────────────────────────────

export class EmotePicker {
  readonly el: HTMLElement;
  private open = false;

  constructor(send: (id: EmoteId) => void) {
    this.el = h(
      'div',
      { class: 'panel emotes hidden' },
      h('div', { class: 'label' }, 'Quick reactions'),
      h(
        'div',
        { class: 'emote-grid' },
        ...EMOTES.map((e) =>
          h(
            'button',
            {
              onclick: () => {
                send(e.id);
                this.toggle(false);
              },
            },
            `${e.icon} ${e.text}`,
          ),
        ),
      ),
    );
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
  }
}

// ───────────────────────────── voice ─────────────────────────────

export class VoicePanel {
  readonly el: HTMLElement;
  private open = false;
  private body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  private levelEls = new Map<string, HTMLElement>();
  private room: RoomView | null = null;

  constructor(private readonly voice: VoiceChat) {
    this.el = h(
      'div',
      { class: 'panel voice-panel hidden' },
      h(
        'div',
        { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'label', style: 'margin:0' }, '🎧 Voice chat'),
        h('button', { class: 'btn small ghost icon-btn', onclick: () => this.toggle(false) }, '✕'),
      ),
      this.body,
    );
    voice.onChange(() => this.render());
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) this.render();
  }

  get isOpen() {
    return this.open;
  }

  update(room: RoomView) {
    this.room = room;
    if (this.open) this.render();
  }

  private nameOf(id: string): string {
    const r = this.room;
    if (!r) return '?';
    const p = [...r.seats, ...r.spectators].find((x) => x?.id === id);
    return p?.name ?? 'Someone';
  }

  render() {
    const v = this.voice.state;
    const room = this.room;
    this.levelEls.clear();
    if (!VoiceChat.supported()) {
      this.body.replaceChildren(h('div', { class: 'muted' }, 'Voice chat is not supported in this browser.'));
      return;
    }
    if (!v.joined) {
      const count = room?.voice.length ?? 0;
      this.body.replaceChildren(
        h('div', { class: 'muted' }, count ? `${count} ${count > 1 ? 'people are' : 'person is'} talking at this table.` : 'Talk with everyone at the table — players and spectators.'),
        h(
          'button',
          { class: 'btn teal', disabled: v.joining, onclick: () => void this.voice.join() },
          v.joining ? 'Connecting…' : '🎙️ Join voice chat',
        ),
        ...(v.error ? [h('div', { class: 'muted' }, v.error)] : []),
      );
      return;
    }
    const rows: HTMLElement[] = [];
    const me = room?.you.id;
    if (v.audioBlocked) {
      rows.push(h('button', { class: 'btn teal', onclick: () => this.voice.resumeAudio() }, '🔊 Tap to hear everyone'));
    }
    for (const m of room?.voice ?? []) {
      const level = h('i', { style: { height: '0%' } });
      this.levelEls.set(m.id, level);
      const isMe = m.id === me;
      const info = isMe ? null : this.voice.peerInfo(m.id);
      const status = !info || info.state === 'connected' ? null : info.attempts >= 2 ? 'trouble connecting' : 'connecting…';
      rows.push(
        h(
          'div',
          { class: 'voice-row' },
          h('span', { class: 'level' }, level),
          h('span', { class: 'nm' }, `${this.nameOf(m.id)}${isMe ? ' (you)' : ''}`, m.muted ? ' 🔇' : '', status ? h('span', { class: 'muted' }, ` · ${status}`) : null),
          !isMe && info && VoiceChat.canSetVolume
            ? h('input', {
                type: 'range',
                min: '0',
                max: '1',
                step: '0.05',
                value: String(info.volume),
                title: 'Volume',
                oninput: (e: Event) => this.voice.setPeerVolume(m.id, Number((e.target as HTMLInputElement).value)),
              })
            : null,
          !isMe && info
            ? h(
                'button',
                { class: 'btn small ghost icon-btn', title: 'Mute for me', onclick: () => this.voice.togglePeerMute(m.id) },
                info.muted ? '🔈' : '🔊',
              )
            : null,
        ),
      );
    }
    this.body.replaceChildren(
      ...rows,
      h(
        'div',
        { class: 'row wrap' },
        h(
          'button',
          { class: `btn small ${v.muted ? 'mic-off' : 'mic-on'}`, onclick: () => this.voice.toggleMute() },
          !v.hasMic ? '🚫 Enable mic' : v.muted ? '🔇 Unmute' : '🎙️ Mute',
        ),
        h('button', { class: 'btn small ghost', onclick: () => this.voice.toggleDeafen() }, v.deafened ? '🔈 Undeafen' : '🎧 Deafen'),
        h('button', { class: 'btn small coral', onclick: () => this.voice.leave() }, 'Leave'),
      ),
      h('div', { class: 'muted' }, v.hasMic ? (v.muted ? 'Hold V to talk while muted.' : 'Your mic is live.') : v.error ?? 'Listening only.'),
    );
  }

  /** Called every frame with speaking levels. */
  levels(levels: Map<string, number>) {
    if (!this.open) return;
    for (const [id, el] of this.levelEls) el.style.height = `${Math.round((levels.get(id) ?? 0) * 100)}%`;
  }
}

// ───────────────────────────── capture chooser ─────────────────────────────

export function chooseCapture(card: Card, options: Card[][], onHover: (ids: string[] | null) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const host = document.getElementById('ui')!;
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      onHover(null);
      el.remove();
      window.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) finish(n - 1);
    };
    window.addEventListener('keydown', onKey);
    const el = h(
      'div',
      { class: 'panel chooser' },
      h('div', { class: 'title' }, `What does your ${cardShort(card)} take?`),
      h(
        'div',
        { class: 'options' },
        ...options.map((opt, i) =>
          h(
            'button',
            {
              class: 'opt',
              title: opt.map(cardShort).join(' + '),
              onclick: () => {
                sfx.play('click');
                finish(i);
              },
              onpointerenter: () => onHover(opt.map((c) => c.id)),
              onpointerleave: () => onHover(null),
            },
            ...opt.flatMap((c, j) => (j === 0 ? [miniCard(c, 40)] : [h('span', { class: 'plus' }, '+'), miniCard(c, 40)])),
          ),
        ),
      ),
      h('button', { class: 'btn small ghost', onclick: () => finish(null) }, 'Cancel'),
    );
    host.appendChild(el);
  });
}

// ───────────────────────────── rules ─────────────────────────────

export function showRules(game: GameKind = 'chkobba') {
  if (game === 'belote') {
    showBeloteRules();
    return;
  }
  const body = h(
    'div',
    { class: 'rules' },
    h('h2', null, 'How to play Chkobba'),
    h('p', null, 'Chkobba (شكبّة) is Tunisia’s favourite café card game, a cousin of the Italian Scopa. Play 1 vs 1, or 2 vs 2 with your partner sitting opposite you.'),
    h('h3', null, 'The cards'),
    h(
      'ul',
      null,
      h('li', null, '40 cards: Ace to 7, plus the figures.'),
      h('li', null, 'Values: Ace = 1, 2–7 = face value, ', h('b', null, 'Queen = 8, Jack = 9, King = 10'), ' (the gold coin on figures shows it).'),
    ),
    h('h3', null, 'Playing'),
    h(
      'ul',
      null,
      h('li', null, 'Everyone gets 3 cards and 4 go face up on the table. New hands of 3 are dealt until the deck runs out.'),
      h('li', null, 'On your turn, play one card. If a table card has the same value you take it. Otherwise you may take several cards that add up to your card’s value.'),
      h('li', null, h('b', null, 'Capturing is compulsory'), ', and a single matching card must be taken before any sum.'),
      h('li', null, 'If you cannot capture, your card stays on the table.'),
      h('li', null, 'Clear the whole table and you score a ', h('b', null, 'CHKOBBA'), ' (1 point) — except with the very last card of the hand.'),
      h('li', null, 'At the end, the cards left on the table go to whoever captured last.'),
    ),
    h('h3', null, 'Scoring each hand'),
    h(
      'ul',
      null,
      h('li', null, h('b', null, 'Karta'), ' — most cards (21+): 1 point.'),
      h('li', null, h('b', null, 'Dinari'), ' — most diamonds (6+): 1 point.'),
      h('li', null, h('b', null, 'Bermila'), ' — most sevens (if tied, most sixes): 1 point.'),
      h('li', null, h('b', null, "Sab'a el Haya"), ' — the 7 of diamonds: 1 point.'),
      h('li', null, h('b', null, 'Chkobba'), ' — 1 point each.'),
    ),
    h('p', null, 'First side to reach the target (11, 21 or 31) at the end of a hand wins. Ties play another hand.'),
    h('h3', null, 'Controls'),
    h(
      'ul',
      null,
      h('li', null, 'Hover a card to preview what it captures; click to play it. On touch screens: tap to select, tap again to play.'),
      h('li', null, 'Keys ', h('span', { class: 'kbd' }, '1'), ' ', h('span', { class: 'kbd' }, '2'), ' ', h('span', { class: 'kbd' }, '3'), ' select a card, ', h('span', { class: 'kbd' }, 'Enter'), ' plays it.'),
      h('li', null, 'Tap your drink on the table (or press ', h('span', { class: 'kbd' }, 'D'), ') to take a sip — or a puff of chicha. Change your order and your character with the ☕ button.'),
      h('li', null, 'In voice chat, hold ', h('span', { class: 'kbd' }, 'V'), ' to talk while muted.'),
    ),
  );
  const m = modal(body);
  body.appendChild(h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Yalla, let’s play!')));
}

function showBeloteRules() {
  const kbd = (k: string) => h('span', { class: 'kbd' }, k);
  const values = (title: string, list: [string, string][]) =>
    h(
      'div',
      { class: 'values' },
      h('b', null, title),
      h('div', { class: 'value-row' }, ...list.map(([card, pts]) => h('span', { class: 'value' }, h('span', { class: 'v-card' }, card), h('span', { class: 'v-pts' }, pts)))),
    );
  const body = h(
    'div',
    { class: 'rules' },
    h('h2', null, 'How to play Belote'),
    h(
      'p',
      null,
      'Tunisian Belote (بلوت) is played the way Tunisian cafés play it: with an auction, as in ',
      h('i', null, 'belote coinchée'),
      '. Four players in two teams; your partner sits opposite you.',
    ),
    h('h3', null, 'The cards'),
    h('p', null, '32 cards, 7 to Ace. The trump suit ranks differently from the others:'),
    values('Trumps', [
      ['J', '20'],
      ['9', '14'],
      ['A', '11'],
      ['10', '10'],
      ['K', '4'],
      ['Q', '3'],
      ['8', '0'],
      ['7', '0'],
    ]),
    values('Other suits', [
      ['A', '11'],
      ['10', '10'],
      ['K', '4'],
      ['Q', '3'],
      ['J', '2'],
      ['9', '0'],
      ['8', '0'],
      ['7', '0'],
    ]),
    h('p', null, 'The last trick is worth 10 more (', h('i', null, 'dix de der'), '): 162 points in a hand.'),
    h('h3', null, 'The auction'),
    h(
      'ul',
      null,
      h('li', null, 'Everyone gets 8 cards, in two lots of 4. The player on the dealer’s right speaks first.'),
      h('li', null, 'Bid what your team will make with your trumps: ', h('b', null, '90 to 160'), ' (by tens), or ', h('b', null, 'Kabbout'), ' (كبوط) — every trick. Each bid must be higher than the last; you may bid again, even over your partner.'),
      h('li', null, 'The other team may say ', h('b', null, 'Contre'), ' (×2); the bidders may answer ', h('b', null, 'Surcontre'), ' (×4).'),
      h('li', null, 'Three passes after a bid end the auction. If all four pass, the next dealer deals again.'),
    ),
    h('h3', null, 'Tricks'),
    h(
      'ul',
      null,
      h('li', null, 'The player on the dealer’s right leads; whoever wins a trick leads the next.'),
      h('li', null, h('b', null, 'Follow suit'), ' if you can. When trumps are led, play a higher trump if you can.'),
      h(
        'li',
        null,
        'If you cannot follow: when your partner is winning the trick you may play anything (with nothing but trumps, beat the best one if you can); otherwise you ',
        h('b', null, 'must trump'),
        ' — higher than any trump already played if you can.',
      ),
      h('li', null, 'The best trump wins the trick, else the best card of the suit led.'),
      h('li', null, 'King and Queen of trumps in one hand: ', h('b', null, 'Belote'), ' and ', h('b', null, 'Rebelote'), ' as you play them, 20 points.'),
    ),
    h('h3', null, 'Scoring'),
    h(
      'ul',
      null,
      h('li', null, 'Each team’s card points are rounded to the ten (5 and up rounds up); the belote adds 20.'),
      h('li', null, 'The bidders must make ', h('b', null, 'their bid and more than the other team'), '. Then each team scores what it made.'),
      h('li', null, 'If they fail it’s a ', h('b', null, 'chute'), ': the other team scores 160 (and the belote). As soon as the bid can no longer be made, the cards are thrown in.'),
      h('li', null, 'Every trick without having bid Kabbout: ', h('b', null, 'capot'), ', 250. Kabbout is worth 500, won or lost; it is lost with the first trick the other team takes.'),
      h('li', null, 'After a contre, a contract made or lost scores 160 ×2 (×4 after surcontre); the belote is never doubled.'),
    ),
    h('p', null, 'First team to reach the target (1000, 1500 or 2000) at the end of a hand wins.'),
    h('h3', null, 'Controls'),
    h(
      'ul',
      null,
      h('li', null, 'Click a card to play it; on touch screens tap to select, tap again to play. Cards the rules don’t allow right now are shaded.'),
      h('li', null, 'Keys ', kbd('1'), '–', kbd('8'), ' select a card, ', kbd('Enter'), ' plays it.'),
      h('li', null, 'In the auction, pick a value with − and +, then click the trump suit to bid it.'),
      h('li', null, 'The gold token in front of the bidder shows the trumps; the contract is shown between the scores.'),
      h('li', null, 'Tap your drink (or press ', kbd('D'), ') to take a sip. In voice chat, hold ', kbd('V'), ' to talk while muted.'),
    ),
  );
  const m = modal(body);
  body.appendChild(h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Yalla, let’s play!')));
}
