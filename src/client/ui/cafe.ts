import {
  AVATAR_COLORS,
  CHARACTERS,
  type CharacterId,
  DRINKS,
  type DrinkId,
  SKIN_TONES,
} from '../../shared/protocol';
import type { PortraitStudio } from '../game3d/portrait';
import { profile } from '../identity';
import { sfx } from '../sfx';
import { h } from './dom';

export interface Look {
  character: CharacterId;
  skin: number;
  color: number;
  drink: DrinkId;
}

/**
 * "Your café order": pick who you are at the table (character, skin tone, shirt) and what you
 * drink. A live preview shows you, and sips when tapped. Lives in the lobby, or in a pop-up
 * panel during the game.
 */
export class CafePicker {
  readonly el: HTMLElement;
  private preview: HTMLElement;
  private drinksEl = h('div', { class: 'cafe-drinks' });
  private charsEl = h('div', { class: 'cafe-chars' });
  private skinsEl = h('div', { class: 'swatches mini' });
  private colorsEl = h('div', { class: 'swatches mini' });
  private nameEl = h('div', { class: 'cafe-who' });

  constructor(
    private readonly studio: PortraitStudio,
    private readonly change: (patch: Partial<Look>) => void,
  ) {
    this.preview = h(
      'button',
      {
        class: 'cafe-preview',
        title: 'Take a sip',
        'aria-label': 'Take a sip',
        onclick: () => {
          sfx.unlock();
          void this.studio.sip(true);
        },
      },
      studio.canvas,
    );
    this.el = h(
      'div',
      { class: 'cafe' },
      h(
        'div',
        { class: 'cafe-top' },
        h('div', { class: 'cafe-me' }, this.preview, this.nameEl),
        h('div', { class: 'cafe-menu' }, h('div', { class: 'label' }, 'Your order'), this.drinksEl),
      ),
      h('div', { class: 'label' }, 'Who are you today?'),
      this.charsEl,
      h('div', { class: 'cafe-colors' }, h('span', { class: 'label' }, 'Skin'), this.skinsEl, h('span', { class: 'label' }, 'Shirt'), this.colorsEl),
      h('div', { class: 'muted cafe-tip' }, 'Tap your drink on the table', h('span', { class: 'kbd-only' }, ' (or press D)'), ' to take a sip!'),
    );
  }

  private pick(patch: Partial<Look>) {
    sfx.unlock();
    sfx.play('pop');
    this.change(patch);
  }

  /** Redraws from the saved profile. */
  render() {
    const me: Look = { character: profile.character, skin: profile.skin, color: profile.color, drink: profile.drink };
    this.studio.setPersona(me);
    const who = CHARACTERS.find((c) => c.id === me.character)!;
    const drink = DRINKS.find((d) => d.id === me.drink)!;
    this.nameEl.replaceChildren(h('b', null, who.name), h('span', null, `${drink.icon} ${drink.name}`));

    this.drinksEl.replaceChildren(
      ...DRINKS.map((d) => {
        const img = this.studio.drinkURL(d.id);
        return h(
          'button',
          {
            class: `cafe-drink ${d.id === me.drink ? 'on' : ''}`,
            title: `“${d.order}”`,
            'aria-pressed': d.id === me.drink ? 'true' : 'false',
            onclick: () => d.id !== me.drink && this.pick({ drink: d.id }),
          },
          img ? h('img', { src: img, alt: '' }) : h('span', { class: 'emoji' }, d.icon),
          h('span', null, d.name),
        );
      }),
    );

    this.charsEl.replaceChildren(
      ...CHARACTERS.map((c) => {
        const img = this.studio.characterURL(c.id, me.skin, me.color);
        return h(
          'button',
          {
            class: `cafe-char ${c.id === me.character ? 'on' : ''}`,
            title: c.hint,
            'aria-pressed': c.id === me.character ? 'true' : 'false',
            onclick: () => c.id !== me.character && this.pick({ character: c.id }),
          },
          img ? h('img', { src: img, alt: '' }) : h('span', { class: 'emoji' }, c.name[0]),
          h('span', null, c.name),
        );
      }),
    );

    this.skinsEl.replaceChildren(
      ...SKIN_TONES.map((tone, i) =>
        h('button', {
          class: `swatch ${me.skin === i ? 'on' : ''}`,
          style: { background: tone },
          title: 'Skin tone',
          'aria-label': `Skin tone ${i + 1}`,
          onclick: () => me.skin !== i && this.pick({ skin: i }),
        }),
      ),
    );
    this.colorsEl.replaceChildren(
      ...AVATAR_COLORS.map((c, i) =>
        h('button', {
          class: `swatch ${me.color === i ? 'on' : ''}`,
          style: { background: c },
          title: 'Shirt colour',
          'aria-label': `Shirt colour ${i + 1}`,
          onclick: () => me.color !== i && this.pick({ color: i }),
        }),
      ),
    );
  }
}
