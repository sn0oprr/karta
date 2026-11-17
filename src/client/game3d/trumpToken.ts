import * as THREE from 'three';
import type { Suit } from '../../shared/cards';
import { drawSuit } from './cardArt';
import { canvasTexture, makeCanvas, toon } from './materials';

const RADIUS = 0.5;
const HEIGHT = 0.1;
const INK = '#1d1b2e';

/** The medallion's face: a gold rim, studs, and the suit on cream paper (same art as the cards). */
function faceCanvas(suit: Suit): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const m = S / 2;
  const ring = (r: number, fill: string | CanvasGradient, stroke?: string, width = 0) => {
    ctx.beginPath();
    ctx.arc(m, m, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  const gold = ctx.createLinearGradient(0, 0, 0, S);
  gold.addColorStop(0, '#FFE699');
  gold.addColorStop(0.5, '#F6BE32');
  gold.addColorStop(1, '#D08A12');
  ring(m - 3, gold, INK, 6);
  ctx.fillStyle = '#FFF3DC';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * (m - 19), m + Math.sin(a) * (m - 19), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const paper = ctx.createRadialGradient(m, m * 0.8, 10, m, m, m - 34);
  paper.addColorStop(0, '#FFFDF6');
  paper.addColorStop(1, '#FBEBD0');
  ring(m - 34, paper, INK, 5);
  drawSuit(ctx, suit, m, m + 4, S * 0.46);
  return c;
}

/** The trump token: a gold medallion showing the trump suit, on the table in front of the taker. */
export class TrumpToken {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly faces = new Map<Suit, THREE.MeshStandardMaterial>();
  private readonly side: THREE.Material;
  suit: Suit | null = null;

  constructor() {
    this.side = toon('#e9a92a');
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 48), [this.side, this.side, this.side]);
    this.mesh.position.y = HEIGHT / 2 + 0.01;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.root.visible = false;
  }

  /** Shows the token for `suit` (null hides it). */
  setSuit(suit: Suit | null) {
    this.suit = suit;
    this.root.visible = suit !== null;
    if (!suit) return;
    let face = this.faces.get(suit);
    if (!face) {
      face = new THREE.MeshStandardMaterial({ map: canvasTexture(faceCanvas(suit)), roughness: 0.5, metalness: 0.05 });
      this.faces.set(suit, face);
    }
    (this.mesh.material as THREE.Material[])[1] = face;
  }
}
