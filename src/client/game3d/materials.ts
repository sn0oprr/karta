import * as THREE from 'three';

let gradientMap: THREE.DataTexture | null = null;

/** Three-band ramp for cartoon (toon) shading. */
export function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export function toon(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

const outlineCache = new Map<string, THREE.ShaderMaterial>();

/** Inverted-hull outline material: vertices pushed along normals, back faces only. */
export function outlineMaterial(thickness = 0.03, color: THREE.ColorRepresentation = '#1d1b2e'): THREE.ShaderMaterial {
  const key = `${thickness}|${new THREE.Color(color).getHexString()}`;
  const cached = outlineCache.get(key);
  if (cached) return cached;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      color: { value: new THREE.Color(color) },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float thickness;
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
  });
  outlineCache.set(key, mat);
  return mat;
}

/** Adds an outline hull as a child of `mesh` (shares the geometry). */
export function addOutline(mesh: THREE.Mesh, thickness = 0.03, color?: THREE.ColorRepresentation): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  hull.name = 'outline';
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}

/** Creates a mesh with toon material, shadows and an optional outline. */
export function toonMesh(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  opts: { outline?: number; cast?: boolean; receive?: boolean; material?: THREE.MeshToonMaterialParameters } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color, opts.material));
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  if (opts.outline) addOutline(mesh, opts.outline);
  return mesh;
}

export function canvasTexture(canvas: HTMLCanvasElement, opts: { repeat?: [number, number]; anisotropy?: number } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  if (opts.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unsupported');
  return [c, ctx];
}
