import {
  AVATAR_COLORS,
  type CharacterId,
  GAMES,
  GAME_INFO,
  type GameKind,
  type GameMode,
  NAME_MAX,
  ROOM_CODE_LENGTH,
  type RoomListing,
  type RoomPrivacy,
  isGameKind,
  normalizeRoomCode,
} from '../../shared/protocol';
import { profile, readPref, saveProfile, writePref } from '../identity';
import { sfx } from '../sfx';
import { type ModalHandle, h, modal } from './dom';
import { avatarDot } from './lobby';

export interface HomeActions {
  create: (game: GameKind, mode: GameMode, privacy: RoomPrivacy) => Promise<void>;
  join: (code: string, spectate: boolean) => Promise<void>;
  /** Joins a private table picked in the list with the code typed for it: the error, or null once in. */
  joinListed: (listing: RoomListing, code: string, spectate: boolean) => Promise<string | null>;
  rules: (game: GameKind) => void;
  profileChanged: () => void;
  /** Portrait of a character, if one can be drawn. */
  portrait: (character: CharacterId, skin: number, color: number) => string | null;
}

export interface HomeScreen {
  el: HTMLElement;
  /** The list of tables (null: still looking). */
  setRooms: (list: RoomListing[] | null) => void;
  /** Closes what the home screen opened over the page (the code prompt). */
  close: () => void;
}

const PRIVACY_LABEL: Record<RoomPrivacy, string> = { public: '🌍 Public', private: '🔒 Private' };
const PRIVACY_HINT: Record<RoomPrivacy, string> = {
  public: 'Listed for everyone: anyone can join from the list.',
  private: 'Listed without its code: only friends with the code or the link get in.',
};

function shake(el: HTMLElement) {
  el.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220, iterations: 2 });
}

/** Room for a seat: a lobby with an empty chair. */
function hasOpenSeat(r: RoomListing): boolean {
  return r.phase === 'lobby' && r.seated < r.seats;
}

function tableName(r: RoomListing): string {
  return r.host ? `${r.host.name}'s table` : 'A table';
}

function statusBadge(r: RoomListing): HTMLElement {
  if (r.phase === 'lobby') {
    return hasOpenSeat(r)
      ? h('span', { class: 'badge open' }, `👤 ${r.seated}/${r.seats} · waiting`)
      : h('span', { class: 'badge full' }, `👤 ${r.seats}/${r.seats} · full`);
  }
  if (r.phase === 'gameOver') return h('span', { class: 'badge live' }, '🏁 game over');
  return h('span', { class: 'badge live' }, `▶ playing · hand ${r.round}`);
}

export function renderHome(actions: HomeActions, opts: { prefillCode?: string; spectate?: boolean } = {}): HomeScreen {
  let mode: GameMode = '2v2';
  const saved = readPref<unknown>('game', 'chkobba');
  let game: GameKind = isGameKind(saved) ? saved : 'chkobba';
  const savedPrivacy = readPref<unknown>('privacy', 'public');
  let privacy: RoomPrivacy = savedPrivacy === 'private' ? 'private' : 'public';
  let busy = false;

  const nameInput = h('input', {
    class: 'field',
    maxlength: NAME_MAX,
    placeholder: 'Your name',
    autocomplete: 'nickname',
    value: profile.name,
  });
  nameInput.value = profile.name;
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.trim();
    if (v) {
      saveProfile({ name: v.slice(0, NAME_MAX), named: true, typed: true });
      actions.profileChanged();
    }
  });

  const swatches = h('div', { class: 'swatches' });
  const drawSwatches = () => {
    swatches.replaceChildren(
      ...AVATAR_COLORS.map((c, i) =>
        h('button', {
          class: `swatch ${profile.color === i ? 'on' : ''}`,
          style: { background: c },
          title: 'Shirt colour',
          'aria-label': `Colour ${i + 1}`,
          onclick: () => {
            sfx.unlock();
            sfx.play('pop');
            saveProfile({ color: i });
            drawSwatches();
            actions.profileChanged();
          },
        }),
      ),
    );
  };
  drawSwatches();

  const modeSeg = h('div', { class: 'seg' });
  const drawMode = () => {
    const modes = GAME_INFO[game].modes;
    modeSeg.replaceChildren(
      ...modes.map((m) =>
        h(
          'button',
          {
            class: mode === m || modes.length === 1 ? 'on' : '',
            disabled: modes.length === 1,
            title: modes.length === 1 ? `${GAME_INFO[game].name} is played by four, in two teams` : undefined,
            onclick: () => {
              mode = m;
              sfx.play('click');
              drawMode();
            },
          },
          m === '1v1' ? '1 vs 1' : '2 vs 2',
        ),
      ),
    );
  };
  drawMode();

  const privacySeg = h('div', { class: 'seg' });
  const privacyHint = h('div', { class: 'muted privacy-hint' });
  const drawPrivacy = () => {
    privacySeg.replaceChildren(
      ...(['public', 'private'] as const).map((p) =>
        h(
          'button',
          {
            class: privacy === p ? 'on' : '',
            'aria-pressed': privacy === p ? 'true' : 'false',
            onclick: () => {
              if (privacy === p) return;
              privacy = p;
              writePref('privacy', p);
              sfx.play('click');
              drawPrivacy();
            },
          },
          PRIVACY_LABEL[p],
        ),
      ),
    );
    privacyHint.textContent = PRIVACY_HINT[privacy];
  };
  drawPrivacy();

  const createBtn = h('button', { class: 'btn big blue grow create-btn' }, '🃏 Create a table');
  createBtn.addEventListener('click', async () => {
    if (busy) return;
    sfx.unlock();
    sfx.play('click');
    busy = true;
    createBtn.disabled = true;
    try {
      await actions.create(game, GAME_INFO[game].modes.includes(mode) ? mode : GAME_INFO[game].modes[0]!, privacy);
    } finally {
      busy = false;
      createBtn.disabled = false;
    }
  });

  const codeInput = h('input', {
    class: 'field code-field',
    maxlength: 5,
    placeholder: 'CODE',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
  });
  if (opts.prefillCode) codeInput.value = opts.prefillCode;
  codeInput.addEventListener('input', () => {
    codeInput.value = normalizeRoomCode(codeInput.value);
  });
  const doJoin = async (spectate: boolean) => {
    if (busy) return;
    sfx.unlock();
    sfx.play('click');
    const code = normalizeRoomCode(codeInput.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      codeInput.focus();
      shake(codeInput);
      return;
    }
    busy = true;
    try {
      await actions.join(code, spectate);
    } finally {
      busy = false;
    }
  };
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doJoin(false);
  });
  const joinBtn = h('button', { class: 'btn', onclick: () => void doJoin(false) }, 'Join');
  const watchBtn = h('button', { class: 'btn ghost', title: 'Watch as a spectator', onclick: () => void doJoin(true) }, '👀 Watch');

  const rulesBtn = h('button', { class: 'btn small ghost', onclick: () => actions.rules(game) });
  const games = h('div', { class: 'game-picker' });
  const drawGames = () => {
    games.replaceChildren(
      ...GAMES.map((k) =>
        h(
          'button',
          {
            class: `game-tile ${game === k ? 'on' : ''}`,
            'aria-pressed': game === k ? 'true' : 'false',
            onclick: () => {
              if (game === k) return;
              game = k;
              writePref('game', k);
              sfx.unlock();
              sfx.play('click');
              drawGames();
              drawMode();
            },
          },
          GAME_INFO[k].name,
          h('span', { class: 'soon' }, GAME_INFO[k].arabic),
        ),
      ),
      h('div', { class: 'game-tile locked' }, 'Rami', h('span', { class: 'soon' }, 'coming soon')),
    );
    rulesBtn.textContent = `📜 How to play ${GAME_INFO[game].name}`;
  };
  drawGames();

  // ───────────────────────── the list of tables ─────────────────────────

  let prompt: ModalHandle | null = null;

  /** A private table: ask for its code. */
  const askCode = (r: RoomListing) => {
    prompt?.close();
    const input = h('input', {
      class: 'field code-field',
      maxlength: ROOM_CODE_LENGTH,
      placeholder: 'CODE',
      autocapitalize: 'characters',
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': 'Table code',
    });
    const error = h('div', { class: 'code-error', role: 'alert' });
    let trying = false;
    const attempt = async (spectate: boolean) => {
      if (trying) return;
      sfx.unlock();
      sfx.play('click');
      const code = normalizeRoomCode(input.value);
      if (code.length !== ROOM_CODE_LENGTH) {
        input.focus();
        shake(input);
        return;
      }
      trying = true;
      error.textContent = '';
      for (const b of buttons) b.disabled = true;
      const failed = await actions.joinListed(r, code, spectate);
      trying = false;
      for (const b of buttons) b.disabled = false;
      if (failed === null) {
        handle.close();
        return;
      }
      error.textContent = failed;
      input.select();
      shake(input);
    };
    input.addEventListener('input', () => {
      input.value = normalizeRoomCode(input.value);
      error.textContent = '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void attempt(!hasOpenSeat(r));
    });
    const buttons = hasOpenSeat(r)
      ? [
          h('button', { class: 'btn ghost', title: 'Watch as a spectator', onclick: () => void attempt(true) }, '👀 Watch'),
          h('button', { class: 'btn blue', onclick: () => void attempt(false) }, 'Join'),
        ]
      : [h('button', { class: 'btn blue', onclick: () => void attempt(true) }, '👀 Watch')];
    const body = h(
      'div',
      { class: 'code-prompt' },
      h('h2', null, `🔒 ${tableName(r)}`),
      h(
        'p',
        { class: 'muted', style: 'text-align:center;margin:0 0 12px' },
        `This ${GAME_INFO[r.game].name} table is private. Type its code to get in${r.host ? ` — ${r.host.name} can give it to you` : ''}.`,
      ),
      input,
      error,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => handle.close() }, 'Cancel'), ...buttons),
    );
    const handle = modal(body, {
      className: 'code-modal',
      onClose: () => {
        if (prompt === handle) prompt = null;
      },
    });
    prompt = handle;
    requestAnimationFrame(() => input.focus());
  };

  const pick = async (r: RoomListing, spectate: boolean) => {
    if (busy) return;
    sfx.unlock();
    sfx.play('click');
    if (r.code === null) {
      askCode(r);
      return;
    }
    busy = true;
    try {
      await actions.join(r.code, spectate);
    } finally {
      busy = false;
    }
  };

  const tableRow = (r: RoomListing) => {
    const info = GAME_INFO[r.game];
    const locked = r.privacy === 'private';
    const open = hasOpenSeat(r);
    const button = locked
      ? h('button', { class: 'btn small', title: 'Private table: type its code', onclick: () => void pick(r, !open) }, open ? '🔒 Join' : '🔒 Watch')
      : open
        ? h('button', { class: 'btn small', onclick: () => void pick(r, false) }, 'Join')
        : h('button', { class: 'btn small ghost', title: 'Watch as a spectator', onclick: () => void pick(r, true) }, '👀 Watch');
    const host = r.host;
    return h(
      'div',
      { class: `table-row ${locked ? 'private' : ''} ${open ? 'open' : ''}`, dataset: { id: r.id } },
      avatarDot(host ? { name: host.name, color: host.color, character: host.character } : null, 40, host ? actions.portrait(host.character, host.skin, host.color) : null),
      h(
        'div',
        { class: 'grow', style: 'flex:1;min-width:0' },
        h('div', { class: 'name' }, locked ? h('span', { class: 'lock', title: 'Private' }, '🔒') : null, tableName(r)),
        h('div', { class: 'meta' }, `${info.name} · ${r.mode === '1v1' ? '1 vs 1' : '2 vs 2'} · to ${r.targetScore}`),
        h(
          'div',
          { class: 'meta badges' },
          statusBadge(r),
          r.bots ? h('span', { class: 'badge bot' }, `🤖 ${r.bots}`) : null,
          r.spectators ? h('span', { class: 'badge' }, `👀 ${r.spectators}`) : null,
        ),
      ),
      button,
    );
  };

  const listEl = h('div', { class: 'table-list' }, h('div', { class: 'table-empty' }, h('div', { class: 'spinner small' }), 'Looking for tables…'));
  const countEl = h('span', { class: 'table-count' });
  const setRooms = (list: RoomListing[] | null) => {
    if (list === null) return;
    const scroll = listEl.scrollTop;
    countEl.textContent = list.length ? String(list.length) : '';
    listEl.replaceChildren(
      ...(list.length
        ? list.map(tableRow)
        : [h('div', { class: 'table-empty' }, h('div', { class: 'big-emoji' }, '🪑'), 'No tables yet.', h('br'), 'Create one: it shows up here for everyone.')]),
    );
    listEl.scrollTop = scroll;
  };
  const tablesCard = h(
    'div',
    { class: 'panel tables-card' },
    h('div', { class: 'tables-head' }, h('div', { class: 'label', style: 'margin:0' }, '☕ Tables at the café'), countEl),
    listEl,
  );

  const invited = !!opts.prefillCode;
  const card = h(
    'div',
    { class: 'panel home-card' },
    h('div', null, h('label', { class: 'label' }, 'Your name'), nameInput),
    h('div', null, h('label', { class: 'label' }, 'Your colour'), swatches),
    invited
      ? h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn big blue grow', onclick: () => void doJoin(!!opts.spectate) }, opts.spectate ? `👀 Watch table ${opts.prefillCode}` : `Join table ${opts.prefillCode}`),
        )
      : null,
    invited ? h('div', { class: 'divider' }, 'or start your own') : null,
    h('div', null, h('label', { class: 'label' }, 'Game'), games),
    h('div', null, h('div', { class: 'row wrap table-options' }, modeSeg, privacySeg), privacyHint),
    h('div', { class: 'row' }, createBtn),
    h('div', { class: 'divider' }, 'have a code?'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, codeInput), joinBtn, watchBtn),
  );

  const el = h(
    'div',
    { class: 'home' },
    h(
      'div',
      { class: 'home-inner' },
      h(
        'div',
        { class: 'logo' },
        h('div', { class: 'logo-word' }, h('span', { class: 'k' }, 'K'), 'arta', h('span', { class: 'dot' }, '.')),
        h('div', null, h('span', { class: 'logo-sub' }, 'Tunisian card games', h('span', { class: 'ar' }, 'كارطة'))),
      ),
      h('div', { class: 'home-grid' }, card, tablesCard),
      h(
        'div',
        { class: 'home-links' },
        rulesBtn,
      ),
    ),
  );

  return { el, setRooms, close: () => prompt?.close() };
}
