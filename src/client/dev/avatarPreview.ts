/**
 * Dev-only sheet of the café characters (open /avatar-preview.html with `npm run dev`): each crew
 * member's portrait next to their 3D look-alike from the front, the side, and from across the
 * table. Query params: ?all=1 adds the regulars, ?only=<id,id> picks characters, ?size=<render px>,
 * ?view=<display px>.
 */
import '@fontsource/lilita-one';
import '@fontsource/fredoka';
import * as THREE from 'three';
import { AVATAR_COLORS, CREW, type CharacterId, REGULARS, isCrew } from '../../shared/protocol';
import { CREW_PORTRAITS } from '../crewPortraits';
import { Avatar } from '../game3d/avatar';

declare global {
  interface Window {
    __avatarsReady?: boolean;
  }
}

const params = new URLSearchParams(location.search);
const SIZE = Number(params.get('size') ?? 440);
const only = params.get('only')?.split(',');
if (params.get('view')) document.documentElement.style.setProperty('--view', `${Number(params.get('view'))}px`);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#d7ecff', '#f2c89b', 1.55));
const sun = new THREE.DirectionalLight('#fff0d9', 2.4);
sun.position.set(-6, 10, -9);
const fill = new THREE.DirectionalLight('#ffd7f0', 0.5);
fill.position.set(8, 4, -4);
scene.add(sun, fill);
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);

/** Where the camera sits for each view (the avatar faces −Z). */
const VIEWS: { yaw: number; from: [number, number, number]; at: [number, number, number] }[] = [
  { yaw: 0.2, from: [0, 2.7, -10.5], at: [0, 1.5, 0] },
  { yaw: 1.2, from: [0, 2.7, -10.5], at: [0, 1.5, 0] },
  // Roughly how a player across the table sees them: from above, at a distance.
  { yaw: 0.05, from: [0, 9.5, -12], at: [0, 1.0, 0] },
  // Close-up on the face.
  { yaw: 0.15, from: [0, 2.6, -6.4], at: [0, 2.2, 0] },
];

const ids: CharacterId[] = [...CREW, ...(params.get('all') ? REGULARS : [])].map((c) => c.id).filter((id) => !only || only.includes(id));
const app = document.getElementById('app')!;

for (const id of ids) {
  const row = document.createElement('div');
  row.className = 'row';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = [...CREW, ...REGULARS].find((c) => c.id === id)!.name;
  row.appendChild(who);
  if (isCrew(id)) {
    const img = document.createElement('img');
    img.src = CREW_PORTRAITS[id];
    img.alt = '';
    row.appendChild(img);
  }
  const av = new Avatar({ character: id, skin: 1, color: AVATAR_COLORS[1], chair: false });
  av.update(0, 0);
  scene.add(av.root);
  for (const v of VIEWS) {
    av.root.rotation.y = v.yaw;
    camera.position.set(...v.from);
    camera.lookAt(...v.at);
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    row.appendChild(canvas);
  }
  scene.remove(av.root);
  av.dispose();
  app.appendChild(row);
}
window.__avatarsReady = true;
