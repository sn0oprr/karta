import { AVATAR_COLORS, type GameMode, NAME_MAX, normalizeRoomCode } from '../../shared/protocol';
import { profile, saveProfile } from '../identity';
import { sfx } from '../sfx';
import { h } from './dom';

export interface HomeActions {
  create: (mode: GameMode) => Promise<void>;
  join: (code: string, spectate: boolean) => Promise<void>;
  rules: () => void;
  profileChanged: () => void;
}

export function renderHome(actions: HomeActions, opts: { prefillCode?: string; spectate?: boolean } = {}): HTMLElement {
  let mode: GameMode = '2v2';
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
    modeSeg.replaceChildren(
      ...(['1v1', '2v2'] as const).map((m) =>
        h(
          'button',
          {
            class: mode === m ? 'on' : '',
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

  const createBtn = h('button', { class: 'btn big blue grow create-btn' }, '🃏 Create a table');
  createBtn.addEventListener('click', async () => {
    if (busy) return;
    sfx.unlock();
    sfx.play('click');
    busy = true;
    createBtn.disabled = true;
    try {
      await actions.create(mode);
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
    if (code.length !== 5) {
      codeInput.focus();
      codeInput.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], {
        duration: 220,
        iterations: 2,
      });
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

  const games = h(
    'div',
    { class: 'game-picker' },
    h('div', { class: 'game-tile on' }, 'Chkobba', h('span', { class: 'soon' }, 'شكبّة')),
    h('div', { class: 'game-tile locked' }, 'Rami', h('span', { class: 'soon' }, 'coming soon')),
    h('div', { class: 'game-tile locked' }, 'Belote', h('span', { class: 'soon' }, 'coming soon')),
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
    h('div', { class: 'row wrap' }, modeSeg, createBtn),
    h('div', { class: 'divider' }, 'have a code?'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, codeInput), joinBtn, watchBtn),
  );

  return h(
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
      card,
      h(
        'div',
        { class: 'home-links' },
        h('button', { class: 'btn small ghost', onclick: () => actions.rules() }, '📜 How to play Chkobba'),
      ),
    ),
  );
}
