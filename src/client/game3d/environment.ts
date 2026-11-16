/**
 * The setting: a Sidi Bou Said terrace at golden hour — kilim rug, terracotta tiles,
 * white walls with blue doors, bougainvillea, the sea and a warm sky.
 */
import * as THREE from 'three';
import { addOutline, canvasTexture, makeCanvas, toon, toonMesh } from './materials';

export const FLOOR_Y = -5.6;

const COLORS = {
  skyTop: '#5fb4f5',
  skyMid: '#a9d8ff',
  horizon: '#ffd9ae',
  sea: '#2f86c9',
  seaDeep: '#1c5f9c',
  plaster: '#f8f4ec',
  blue: '#1f62b5',
  terracotta: '#c8693f',
};

function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(190, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(COLORS.skyTop) },
      mid: { value: new THREE.Color(COLORS.skyMid) },
      horizon: { value: new THREE.Color(COLORS.horizon) },
      sunDir: { value: new THREE.Vector3(0.55, 0.16, -0.82).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, top, smoothstep(0.18, 0.75, h));
        if (h < 0.0) col = horizon;
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.82, 0.55) * pow(sun, 18.0) * 0.55;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9975, 0.999, sun);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function cloud(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#fff7ef', fog: false });
  const puffs = [
    [0, 0, 0, 3.2],
    [3.2, -0.4, 0.3, 2.4],
    [-3.1, -0.6, -0.2, 2.2],
    [1.4, 1.2, 0, 2.3],
    [-1.4, 0.9, 0.4, 2.0],
  ] as const;
  for (const [x, y, z, r] of puffs) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    m.position.set(x, y, z);
    m.scale.y = 0.72;
    g.add(m);
  }
  return g;
}

function tileFloorTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  const n = 8;
  const s = 512 / n;
  ctx.fillStyle = '#ead6bd';
  ctx.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = rnd();
      const base = v < 0.33 ? '#c86a40' : v < 0.66 ? '#d07549' : '#bf6139';
      const gx = x * s + 3;
      const gy = y * s + 3;
      const w = s - 6;
      const grad = ctx.createLinearGradient(gx, gy, gx + w, gy + w);
      grad.addColorStop(0, base);
      grad.addColorStop(1, shade(base, -0.08));
      ctx.fillStyle = grad;
      roundRect(ctx, gx, gy, w, w, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      roundRect(ctx, gx + 4, gy + 4, w * 0.5, 5, 3);
      ctx.fill();
    }
  }
  return canvasTexture(c, { repeat: [4, 4] });
}

function kilimTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const red = '#a8322a';
  const deep = '#7c1f1d';
  const orange = '#e58a2f';
  const cream = '#f6e6c8';
  const navy = '#203a6b';
  const ink = '#2a1714';
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, S, S);

  // Concentric frames.
  const band = (inset: number, width: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, S - inset * 2, width);
    ctx.fillRect(inset, S - inset - width, S - inset * 2, width);
    ctx.fillRect(inset, inset, width, S - inset * 2);
    ctx.fillRect(S - inset - width, inset, width, S - inset * 2);
  };
  band(0, 26, ink);
  band(26, 40, cream);
  band(66, 10, ink);
  band(160, 10, ink);
  band(170, 22, orange);

  // Zigzag border (triangles) between the frames.
  const zig = (inset: number, depth: number, step: number, colA: string, colB: string) => {
    const L = S - inset * 2;
    for (let side = 0; side < 4; side++) {
      ctx.save();
      ctx.translate(S / 2, S / 2);
      ctx.rotate((side * Math.PI) / 2);
      ctx.translate(-S / 2, -S / 2);
      for (let i = 0; i < L / step; i++) {
        const x = inset + i * step;
        ctx.fillStyle = i % 2 ? colA : colB;
        ctx.beginPath();
        ctx.moveTo(x, inset);
        ctx.lineTo(x + step / 2, inset + depth);
        ctx.lineTo(x + step, inset);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  ctx.fillStyle = deep;
  ctx.fillRect(76, 76, S - 152, 84);
  zig(76, 70, 56, orange, cream);

  // Field of lozenges.
  const field0 = 192;
  const size = 96;
  for (let y = field0; y < S - field0; y += size) {
    for (let x = field0; x < S - field0; x += size) {
      const cx = x + size / 2;
      const cy = y + size / 2;
      const odd = ((x - field0) / size + (y - field0) / size) % 2 === 1;
      diamond(ctx, cx, cy, size * 0.46, odd ? navy : orange, ink);
      diamond(ctx, cx, cy, size * 0.27, cream, ink);
      diamond(ctx, cx, cy, size * 0.1, odd ? orange : navy, null);
      // Little hooks ("eyes") around each lozenge.
      ctx.fillStyle = cream;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        ctx.fillRect(cx + dx * size * 0.5 - 4, cy + dy * size * 0.5 - 4, 8, 8);
      }
    }
  }
  // Fringe-like dashes on two edges.
  ctx.fillStyle = cream;
  for (let x = 6; x < S; x += 14) {
    ctx.fillRect(x, 4, 6, 14);
    ctx.fillRect(x, S - 18, 6, 14);
  }
  return canvasTexture(c, { anisotropy: 8 });
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string | null) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

function doorTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 512);
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(0, 0, 256, 512);
  // Studs drawing the classic Tunisian door motifs.
  ctx.fillStyle = '#f5f0e6';
  const stud = (x: number, y: number, r = 5) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let y = 60; y < 500; y += 22) {
    stud(18, y);
    stud(238, y);
  }
  for (let x = 40; x < 230; x += 22) {
    stud(x, 470);
    stud(x, 250);
  }
  // Arch of studs.
  for (let a = 0; a <= Math.PI; a += Math.PI / 12) stud(128 + Math.cos(a) * 92, 160 - Math.sin(a) * 92);
  // Central rosette / star.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    stud(128 + Math.cos(a) * 34, 360 + Math.sin(a) * 34, 6);
  }
  stud(128, 360, 9);
  // Panel lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 40, 184, 420);
  return canvasTexture(c);
}

function windowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#18263f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 14;
  // Moucharabieh grille: arches and bars.
  for (let x = 20; x <= 236; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x, 70);
    ctx.stroke();
  }
  for (let x = 20; x < 236; x += 54) {
    ctx.beginPath();
    ctx.arc(x + 27, 70, 27, Math.PI, 0);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(256, 170);
  ctx.stroke();
  ctx.lineWidth = 18;
  ctx.strokeRect(0, 0, 256, 256);
  return canvasTexture(c);
}

function bougainvillea(radius: number, count: number, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const leafGeo = new THREE.SphereGeometry(1, 8, 6);
  const leaves = new THREE.InstancedMesh(leafGeo, toon('#3f9a4a'), Math.ceil(count * 0.6));
  const flowers = new THREE.InstancedMesh(leafGeo, toon('#ff3fa4'), count);
  const flowers2 = new THREE.InstancedMesh(leafGeo, toon('#ff7cc7'), Math.ceil(count * 0.5));
  const m = new THREE.Matrix4();
  const place = (mesh: THREE.InstancedMesh, n: number, rMin: number, rMax: number) => {
    for (let i = 0; i < n; i++) {
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1) * 0.75;
      const r = radius * (0.65 + rand() * 0.4);
      const s = rMin + rand() * (rMax - rMin);
      m.compose(
        new THREE.Vector3(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * 0.8, Math.sin(v) * Math.sin(u) * r),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s * 0.8, s),
      );
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
  };
  place(leaves, leaves.count, radius * 0.22, radius * 0.34);
  place(flowers, flowers.count, radius * 0.12, radius * 0.2);
  place(flowers2, flowers2.count, radius * 0.1, radius * 0.16);
  g.add(leaves, flowers, flowers2);
  return g;
}

function pot(): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const profile = [
    [0, 0],
    [1.0, 0],
    [1.15, 0.2],
    [1.5, 1.9],
    [1.7, 2.05],
    [1.72, 2.35],
    [1.45, 2.4],
  ];
  for (const [x, y] of profile) pts.push(new THREE.Vector2(x, y));
  const potMesh = toonMesh(new THREE.LatheGeometry(pts, 24), COLORS.terracotta, { outline: 0.06 });
  g.add(potMesh);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(1.45, 20), toon('#5a3b28'));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 2.2;
  g.add(soil);
  return g;
}

function blueRailing(radius: number, height: number, from: number, to: number): THREE.Group {
  const g = new THREE.Group();
  const blue = toon(COLORS.blue);
  const arc = to - from;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 6, 96, arc), blue);
  rail.rotation.x = Math.PI / 2;
  rail.rotation.z = from;
  rail.position.y = height;
  g.add(rail);
  const rail2 = rail.clone();
  rail2.position.y = height * 0.45;
  g.add(rail2);
  const count = Math.round((radius * arc) / 0.55);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, height, 6), blue, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = from + (i / (count - 1)) * arc;
    m.makeTranslation(Math.cos(a) * radius, height / 2, Math.sin(a) * radius);
    posts.setMatrixAt(i, m);
  }
  posts.castShadow = true;
  g.add(posts);
  return g;
}

export class Environment {
  readonly group = new THREE.Group();
  private clouds: THREE.Group[] = [];
  private sea: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(COLORS.horizon);
    scene.fog = new THREE.Fog(COLORS.horizon, 70, 185);
    this.group.add(skyDome());

    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    // Sea far below the terrace.
    this.sea = new THREE.Mesh(
      new THREE.CircleGeometry(185, 64),
      new THREE.MeshLambertMaterial({ color: COLORS.sea, emissive: COLORS.seaDeep, emissiveIntensity: 0.25 }),
    );
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = FLOOR_Y - 26;
    this.group.add(this.sea);

    for (let i = 0; i < 7; i++) {
      const cl = cloud();
      const a = rand() * Math.PI * 2;
      const r = 120 + rand() * 40;
      cl.position.set(Math.cos(a) * r, 14 + rand() * 24, Math.sin(a) * r);
      cl.lookAt(0, cl.position.y, 0);
      cl.scale.setScalar(1.6 + rand() * 1.4);
      this.clouds.push(cl);
      this.group.add(cl);
    }

    // Terrace platform with terracotta tiles.
    const terraceR = 17;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(terraceR, 64),
      new THREE.MeshLambertMaterial({ map: tileFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.group.add(floor);
    const cliff = toonMesh(new THREE.CylinderGeometry(terraceR, terraceR * 0.82, 26, 48, 1, true), '#e9dcc8', {
      cast: false,
      receive: false,
    });
    cliff.position.y = FLOOR_Y - 13;
    this.group.add(cliff);

    // Kilim rug under the table, square with it and wide enough for the chairs.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(17.5, 17.5), new THREE.MeshLambertMaterial({ map: kilimTexture() }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = FLOOR_Y + 0.02;
    rug.receiveShadow = true;
    this.group.add(rug);

    // Low white parapet with a blue railing, open to the sea on the south side.
    const wallShape = new THREE.Shape();
    wallShape.absarc(0, 0, terraceR + 0.4, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, terraceR - 0.3, 0, Math.PI * 2, true);
    wallShape.holes.push(hole);
    const wall = toonMesh(
      new THREE.ExtrudeGeometry(wallShape, { depth: 1.6, bevelEnabled: false, curveSegments: 72 }),
      COLORS.plaster,
      { cast: true },
    );
    wall.rotation.x = -Math.PI / 2;
    wall.position.y = FLOOR_Y;
    this.group.add(wall);
    const railing = blueRailing(terraceR, 1.6, 0, Math.PI * 2);
    railing.position.y = FLOOR_Y + 1.6;
    this.group.add(railing);

    // House façade behind the north side with a blue door and windows.
    const house = new THREE.Group();
    const facade = toonMesh(new THREE.BoxGeometry(30, 14, 3), COLORS.plaster, { cast: true });
    facade.position.set(0, 7, 0);
    house.add(facade);
    const doorFrame = toonMesh(new THREE.BoxGeometry(4.6, 7.6, 0.3), '#efe6d6', { cast: false });
    doorFrame.position.set(0, 3.8, 1.55);
    house.add(doorFrame);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 7), new THREE.MeshLambertMaterial({ map: doorTexture() }));
    door.position.set(0, 3.6, 1.72);
    house.add(door);
    const winTex = windowTexture();
    for (const x of [-8.5, 8.5]) {
      const frame = toonMesh(new THREE.BoxGeometry(3.6, 3.6, 0.3), '#efe6d6', { cast: false });
      frame.position.set(x, 6.5, 1.55);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshLambertMaterial({ map: winTex }));
      win.position.set(x, 6.5, 1.72);
      const sill = toonMesh(new THREE.BoxGeometry(4, 0.3, 0.9), COLORS.blue, { cast: true });
      sill.position.set(x, 4.6, 1.9);
      house.add(frame, win, sill);
    }
    const roofEdge = toonMesh(new THREE.BoxGeometry(31, 0.6, 3.6), '#efe6d6', { cast: true });
    roofEdge.position.set(0, 14.2, 0);
    house.add(roofEdge);
    // Climbing bougainvillea over the door.
    const climber = bougainvillea(3.2, 120, rand);
    climber.position.set(-4.5, 11.5, 2.2);
    climber.scale.set(1.5, 0.8, 0.5);
    house.add(climber);
    const climber2 = bougainvillea(2.2, 70, rand);
    climber2.position.set(5.5, 12.2, 2.0);
    climber2.scale.set(1.6, 0.7, 0.5);
    house.add(climber2);
    house.position.set(0, FLOOR_Y, -terraceR - 1.6);
    this.group.add(house);

    // Potted bougainvilleas around the terrace.
    const potSpots: [number, number, number][] = [
      [-12.5, -9, 1.1],
      [12.8, -8.5, 1.0],
      [-14.2, 4, 0.9],
      [14.4, 3.2, 0.95],
    ];
    for (const [x, z, s] of potSpots) {
      const p = pot();
      const bush = bougainvillea(2.1, 70, rand);
      bush.position.y = 3.6;
      p.add(bush);
      p.position.set(x, FLOOR_Y, z);
      p.scale.setScalar(s);
      this.group.add(p);
    }

    // A lantern hanging from a pole near the house.
    const lantern = new THREE.Group();
    const pole = toonMesh(new THREE.CylinderGeometry(0.12, 0.16, 15, 8), '#2b2b3a', { outline: 0.03 });
    pole.position.y = 7.5;
    lantern.add(pole);
    const cage = toonMesh(new THREE.CylinderGeometry(0.55, 0.8, 1.4, 8), '#c9a227', { outline: 0.04 });
    cage.position.y = 14.6;
    lantern.add(cage);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#ffe8a3' }),
    );
    glow.position.y = 14.5;
    lantern.add(glow);
    lantern.position.set(-15.5, FLOOR_Y, -6);
    this.group.add(lantern);

    scene.add(this.group);
  }

  update(time: number) {
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i]!;
      c.position.y += Math.sin(time * 0.1 + i) * 0.002;
    }
    const mat = this.sea.material as THREE.MeshLambertMaterial;
    mat.emissiveIntensity = 0.22 + Math.sin(time * 0.6) * 0.03;
  }
}

export { addOutline };
