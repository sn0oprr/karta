import * as THREE from 'three';
import { animator } from './tween';
import type { Rect } from './viewFit';

export type FrameCallback = (dt: number, time: number) => void;

/** Renderer, scene, camera, lights and the render loop. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly container: HTMLElement;
  private callbacks = new Set<FrameCallback>();
  private resizeCallbacks = new Set<(w: number, h: number) => void>();
  private layoutCallbacks = new Set<() => void>();
  private overlaySource: (() => Rect[]) | null = null;
  private overlayCheckedAt = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the pending resize callbacks were first scheduled (they run at least this often while resizing). */
  private resizePendingSince = 0;
  /** The size the resize callbacks last saw. */
  private notifiedW = 0;
  private notifiedH = 0;
  private last = performance.now();
  private running = false;
  private shakeAmount = 0;
  private shakeOffset = new THREE.Vector3();
  width = 1;
  height = 1;
  /** Screen boxes (CSS px) covered by the HUD, refreshed on resize and twice a second. */
  overlay: Rect[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'stage-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.camera.position.set(0, 12, 11);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight('#d7ecff', '#f2c89b', 1.55);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight('#fff0d9', 2.6);
    this.sun.position.set(-7, 16, 9);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -11;
    sc.right = 11;
    sc.top = 11;
    sc.bottom = -11;
    sc.near = 1;
    sc.far = 45;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    const fill = new THREE.DirectionalLight('#ffd7f0', 0.45);
    fill.position.set(8, 6, -6);
    this.scene.add(fill);

    // Mobile toolbars and rotations resize the visual viewport, sometimes in several steps.
    const changed = () => this.viewportChanged();
    window.addEventListener('resize', changed);
    // Some browsers report a rotation before the new size: look again once it has landed.
    window.addEventListener('orientationchange', () => {
      changed();
      setTimeout(changed, 350);
    });
    window.visualViewport?.addEventListener('resize', changed);
    this.applySize();
    this.resize();
  }

  /**
   * The drawing buffer and the camera's aspect follow the new size at once (so nothing is drawn
   * stretched), while the costlier layout work (camera fit, hand, labels) waits for the size to
   * settle. Events that leave the size as it was (pinch-zoom, an on-screen keyboard over the page)
   * only re-measure the HUD.
   */
  private viewportChanged() {
    if (this.applySize() || this.resizeTimer) this.scheduleResize();
    else this.refreshOverlay();
  }

  /** Sizes the renderer and the camera to the container; true if the size changed. */
  private applySize(): boolean {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return true;
  }

  private scheduleResize() {
    const now = performance.now();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    else this.resizePendingSince = now;
    // Trailing debounce, but a window dragged for a while still re-lays out a few times a second.
    const wait = now - this.resizePendingSince > 250 ? 0 : 90;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.applySize();
      this.resize();
    }, wait);
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeCallbacks.add(cb);
    cb(this.width, this.height);
    return () => this.resizeCallbacks.delete(cb);
  }

  /** Called when the HUD layout changes (not on plain resizes, which `onResize` covers). */
  onLayout(cb: () => void): () => void {
    this.layoutCallbacks.add(cb);
    return () => this.layoutCallbacks.delete(cb);
  }

  /** Where to measure the HUD from (screen boxes the 3D view should keep its content out of). */
  setOverlaySource(fn: () => Rect[]) {
    this.overlaySource = fn;
    this.refreshOverlay(true);
  }

  /** Re-measures the HUD; true (and listeners told unless `quiet`) if it moved. */
  refreshOverlay(quiet = false): boolean {
    this.overlayCheckedAt = performance.now();
    const next = this.overlaySource?.() ?? [];
    const prev = this.overlay;
    const same =
      next.length === prev.length &&
      next.every((r, i) => {
        const q = prev[i]!;
        return (
          Math.abs(r.left - q.left) < 2 && Math.abs(r.top - q.top) < 2 && Math.abs(r.right - q.right) < 2 && Math.abs(r.bottom - q.bottom) < 2
        );
      });
    if (same) return false;
    this.overlay = next;
    if (!quiet) for (const cb of this.layoutCallbacks) cb();
    return true;
  }

  /** Re-lays out for the current size: the HUD boxes, then everyone listening to `onResize`. */
  private resize() {
    const w = this.width;
    const h = this.height;
    if (w === this.notifiedW && h === this.notifiedH) {
      // Back to the size already laid out (e.g. a toolbar shown and hidden again).
      this.refreshOverlay();
      return;
    }
    this.notifiedW = w;
    this.notifiedH = h;
    this.refreshOverlay(true);
    for (const cb of this.resizeCallbacks) cb(w, h);
  }

  /** Small camera shake (e.g. on a chkobba). */
  shake(amount = 0.18) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop((now: number) => this.frame(now));
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    animator.tick(now);
    // (Not while a resize is pending: it re-measures the HUD itself, with the size to match.)
    if (now - this.overlayCheckedAt > 500 && !this.resizeTimer) this.refreshOverlay();
    for (const cb of this.callbacks) cb(dt, now / 1000);
    // Shake is applied only for the duration of the render so camera controllers stay unaffected.
    const shaking = this.shakeAmount > 0.002;
    if (shaking) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
      );
      this.camera.position.add(this.shakeOffset);
      this.shakeAmount *= Math.pow(0.015, dt);
    } else this.shakeAmount = 0;
    this.renderer.render(this.scene, this.camera);
    if (shaking) this.camera.position.sub(this.shakeOffset);
  }

  /** Projects a world position to CSS pixels (x, y) — z > 1 means behind the camera. */
  project(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(world).project(this.camera);
    const x = (out.x * 0.5 + 0.5) * this.width;
    const y = (-out.y * 0.5 + 0.5) * this.height;
    return out.set(x, y, out.z);
  }
}
