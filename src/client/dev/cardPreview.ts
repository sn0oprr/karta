/**
 * Dev-only contact sheet for the card artwork (open /card-preview.html with `npx vite`).
 * Query params: ?w=<css px> display width of the deck sheet cards (default 160).
 */
import '@fontsource/lilita-one';
import '@fontsource/fredoka';
import { RANKS, SUITS, makeCard, cardShort } from '../../shared/cards';
import type { Card } from '../../shared/cards';
import { type BCard, beloteCardShort, makeBeloteDeck } from '../../shared/belote';
import { beloteFace, chkobbaFace, ensureCardFonts, makeCardCanvas } from '../game3d/cardArt';

declare global {
  interface Window {
    __cardsReady?: boolean;
    __cardStats?: { firstMs: number; avgMs: number; fontsMs: number };
  }
}

function section(title: string, cls: string, id?: string): HTMLDivElement {
  const app = document.getElementById('app')!;
  const h = document.createElement('h2');
  h.textContent = title;
  app.appendChild(h);
  const row = document.createElement('div');
  row.className = `row ${cls}`;
  if (id) row.id = id;
  app.appendChild(row);
  return row;
}

function add(row: HTMLElement, canvas: HTMLCanvasElement, title: string): void {
  canvas.title = title;
  row.appendChild(canvas);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const cssW = Number(params.get('w') ?? '160');
  document.documentElement.style.setProperty('--card-w', `${cssW}px`);

  const f0 = performance.now();
  await ensureCardFonts();
  const fontsMs = performance.now() - f0;

  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(makeCard(r, s));
  const belote: BCard[] = makeBeloteDeck();

  // timing: first full pass + a few repeats at 320 px
  const t0 = performance.now();
  const full = deck.map((c) => makeCardCanvas(chkobbaFace(c)));
  const back = makeCardCanvas('back');
  const firstMs = performance.now() - t0;
  const reps = 3;
  const t1 = performance.now();
  for (let i = 0; i < reps; i++) {
    for (const c of deck) makeCardCanvas(chkobbaFace(c));
    makeCardCanvas('back');
  }
  const avgMs = (performance.now() - t1) / reps;

  document.getElementById('stats')!.textContent =
    `41 canvases @ 320×480 — first pass ${firstMs.toFixed(1)} ms, average ${avgMs.toFixed(1)} ms ` +
    `(fonts ready in ${fontsMs.toFixed(0)} ms)`;

  SUITS.forEach((s, si) => {
    const row = section(`Chkobba — suit ${s}`, 'sheet');
    for (let i = 0; i < RANKS.length; i++) {
      const card = deck[si * RANKS.length + i]!;
      add(row, full[si * RANKS.length + i]!, cardShort(card));
    }
  });
  SUITS.forEach((s) => {
    const row = section(`Belote — suit ${s}`, 'sheet');
    for (const card of belote.filter((c) => c.suit === s)) add(row, makeCardCanvas(beloteFace(card)), beloteCardShort(card));
  });
  const backRow = section('Back', 'sheet');
  add(backRow, back, 'back');

  const small = section('Small (90 px wide, drawn natively)', 'small', 'small');
  for (const c of deck) add(small, makeCardCanvas(chkobbaFace(c), 90), cardShort(c));
  for (const c of belote) if (['8', '9', '10'].includes(c.rank)) add(small, makeCardCanvas(beloteFace(c), 90), beloteCardShort(c));
  add(small, makeCardCanvas('back', 90), 'back');

  const figs = section('Figures, 7♦, Belote 8–10 and back at 1:1 (320×480)', 'zoom', 'figures');
  for (const s of SUITS) for (const r of [8, 9, 10] as const) add(figs, makeCardCanvas(chkobbaFace(makeCard(r, s))), cardShort(makeCard(r, s)));
  add(figs, makeCardCanvas(chkobbaFace(makeCard(7, 'D'))), '7♦');
  for (const c of belote) if (c.suit === 'H' && ['8', '9', '10'].includes(c.rank)) add(figs, makeCardCanvas(beloteFace(c)), beloteCardShort(c));
  add(figs, makeCardCanvas('back'), 'back');

  window.__cardStats = { firstMs, avgMs, fontsMs };
  window.__cardsReady = true;
}

void main();
