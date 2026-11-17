import type { Card } from '../../shared/cards';
import { cardCanvas } from '../game3d/cardMesh';

/** A small picture of a card (of either game, by id) for the DOM UI. */
export function miniCard(card: Card | string, w = 44): HTMLCanvasElement {
  const id = typeof card === 'string' ? card : card.id;
  const src = cardCanvas(id);
  const c = document.createElement('canvas');
  const scale = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * scale);
  c.height = Math.round(w * 1.5 * scale);
  c.className = 'mini-card';
  c.style.width = `${w}px`;
  c.style.height = `${w * 1.5}px`;
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
