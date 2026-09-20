import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { FolkInfo, ResourceData, SpeciesInfo, WorldData } from './net';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;
const GRID_MIN_ZOOM = 12;
/** Tile sprites only appear when zoomed in this far. */
const SPRITE_MIN_ZOOM = 14;
/** Below this fill fraction a resource is drawn as absent (bare). */
const SPRITE_MIN_FILL = 0.04;
const CLICK_SLOP_PX = 4;
/** Folk are drawn at least this many screen pixels across, and at least FOLK_MIN_TILES tiles. */
const FOLK_SCREEN_PX = 9;
const FOLK_MIN_TILES = 0.6;
const FOLK_COLOR = 0xffd23f;
/** How close (in screen pixels) a click must be to a Folk to select it. */
const FOLK_PICK_PX = 9;

interface Selected {
  x: number;
  y: number;
}

function folkTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
}

function circleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

/** Draws the world as one nearest-filtered texture (1 pixel per tile) with pan, zoom and selection. */
export class WorldView {
  private readonly app = new Application();
  private readonly stage = new Container();
  private readonly markers = new Container();
  private readonly grid = new Graphics();
  private readonly highlight = new Graphics();
  private readonly folkLayer = new Container();
  private readonly markerPool: Sprite[] = [];
  private readonly folkPool: Sprite[] = [];
  private sprite: Sprite | null = null;
  private overlay: Sprite | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayImage: ImageData | null = null;
  private circle: Texture | null = null;
  private folkTex: Texture | null = null;
  private folk: FolkInfo[] = [];
  private selectedFolk: number | null = null;
  private width = 0;
  private height = 0;
  private zoom = 4;
  private selected: Selected | null = null;

  private species: SpeciesInfo[] = [];
  private frames: Uint8Array[] = [];
  private overlaySpecies: number | null = null;
  private showSprites = true;

  onTileClick: (x: number, y: number) => void = () => {};
  onFolkClick: (id: number) => void = () => {};

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x0f141b,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.stage);
    this.stage.addChild(this.markers, this.grid, this.folkLayer, this.highlight);
    this.circle = circleTexture();
    this.folkTex = folkTexture();
    this.bindInput(this.app.canvas);
    this.app.renderer.on('resize', () => this.redrawOverlays());
  }

  setWorld(data: WorldData): void {
    const { width, height } = data.meta.params;
    const colors = new Map(data.meta.terrain.map((t) => [t.id, t.color]));
    this.species = data.meta.species;
    this.frames = [];

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const color = colors.get(data.terrain[i]!) ?? 0xff00ff;
      const shade = 0.72 + 0.5 * (data.elevation[i]! / 255);
      image.data[i * 4] = Math.min(255, ((color >> 16) & 255) * shade);
      image.data[i * 4 + 1] = Math.min(255, ((color >> 8) & 255) * shade);
      image.data[i * 4 + 2] = Math.min(255, (color & 255) * shade);
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    for (const old of [this.sprite, this.overlay]) {
      if (!old) continue;
      this.stage.removeChild(old);
      old.destroy({ texture: true, textureSource: true });
    }
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    this.sprite = new Sprite(texture);

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    this.overlayCtx = overlayCanvas.getContext('2d');
    this.overlayImage = this.overlayCtx?.createImageData(width, height) ?? null;
    const overlayTexture = Texture.from(overlayCanvas);
    overlayTexture.source.scaleMode = 'nearest';
    this.overlay = new Sprite(overlayTexture);
    this.overlay.visible = false;
    this.stage.addChildAt(this.sprite, 0);
    this.stage.addChildAt(this.overlay, 1);

    const resized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.selected = null;
    if (resized) this.fit();
    this.redrawOverlays();
  }

  setResources(data: ResourceData): void {
    this.frames = data.frames;
    this.updateOverlay();
    this.redrawMarkers();
  }

  /** Show one species as a colored heat layer over the terrain, or none. */
  setOverlaySpecies(index: number | null): void {
    this.overlaySpecies = index;
    this.updateOverlay();
  }

  setShowSprites(show: boolean): void {
    this.showSprites = show;
    this.redrawMarkers();
  }

  setFolk(folk: FolkInfo[]): void {
    this.folk = folk;
    this.updateFolk();
    if (this.selectedFolk !== null) this.redrawHighlight();
  }

  setSelectedFolk(id: number | null): void {
    this.selectedFolk = id;
    this.redrawHighlight();
  }

  select(x: number, y: number): void {
    this.selected = { x, y };
    this.redrawOverlays();
  }

  private updateOverlay(): void {
    const overlay = this.overlay;
    const index = this.overlaySpecies;
    const frame = index === null ? undefined : this.frames[index];
    const species = index === null ? undefined : this.species[index];
    if (!overlay || !this.overlayCtx || !this.overlayImage || !frame || !species) {
      if (overlay) overlay.visible = false;
      return;
    }
    const r = (species.color >> 16) & 255;
    const g = (species.color >> 8) & 255;
    const b = species.color & 255;
    const data = this.overlayImage.data;
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]!;
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = v === 0 ? 0 : 20 + Math.round((140 * (v - 1)) / 254);
    }
    this.overlayCtx.putImageData(this.overlayImage, 0, 0);
    overlay.texture.source.update();
    overlay.visible = true;
  }

  private fit(): void {
    const { width: vw, height: vh } = this.app.screen;
    this.zoom = Math.min(vw / this.width, vh / this.height) * 0.95;
    this.stage.scale.set(this.zoom);
    this.stage.position.set((vw - this.width * this.zoom) / 2, (vh - this.height * this.zoom) / 2);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      this.stage.position.x += dx;
      this.stage.position.y += dy;
      this.redrawOverlays();
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      if (moved > CLICK_SLOP_PX) return;
      const folk = this.folkAt(e.clientX, e.clientY);
      if (folk !== null) {
        this.onFolkClick(folk);
        return;
      }
      const tile = this.tileAt(e.clientX, e.clientY);
      if (tile) this.onTileClick(tile.x, tile.y);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, this.zoom * Math.exp(-e.deltaY * 0.0015)),
        );
        const ratio = next / this.zoom;
        this.stage.position.x = cx - (cx - this.stage.position.x) * ratio;
        this.stage.position.y = cy - (cy - this.stage.position.y) * ratio;
        this.zoom = next;
        this.stage.scale.set(next);
        this.redrawOverlays();
      },
      { passive: false },
    );
  }

  private tileAt(clientX: number, clientY: number): Selected | null {
    const rect = this.app.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.stage.position.x) / this.zoom);
    const y = Math.floor((clientY - rect.top - this.stage.position.y) / this.zoom);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return { x, y };
  }

  /** The Folk nearest the pointer, if one is close enough to count as clicked. */
  private folkAt(clientX: number, clientY: number): number | null {
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.stage.position.x) / this.zoom;
    const wy = (clientY - rect.top - this.stage.position.y) / this.zoom;
    const reach = Math.max(FOLK_MIN_TILES / 2, FOLK_PICK_PX / this.zoom);
    let best: number | null = null;
    let bestDistance = reach;
    for (const f of this.folk) {
      const d = Math.hypot(f.x + 0.5 - wx, f.y + 0.5 - wy);
      if (d <= bestDistance) {
        bestDistance = d;
        best = f.id;
      }
    }
    return best;
  }

  private folkSize(): number {
    return Math.max(FOLK_MIN_TILES, FOLK_SCREEN_PX / this.zoom);
  }

  private updateFolk(): void {
    if (!this.folkTex) return;
    const size = this.folkSize();
    this.folk.forEach((f, i) => {
      let sprite = this.folkPool[i];
      if (!sprite) {
        sprite = new Sprite(this.folkTex!);
        sprite.anchor.set(0.5);
        sprite.tint = FOLK_COLOR;
        this.folkPool.push(sprite);
        this.folkLayer.addChild(sprite);
      }
      sprite.width = sprite.height = size;
      sprite.position.set(f.x + 0.5, f.y + 0.5);
      sprite.visible = true;
    });
    for (let i = this.folk.length; i < this.folkPool.length; i++) this.folkPool[i]!.visible = false;
  }

  private redrawHighlight(): void {
    const z = this.zoom;
    this.highlight.clear();
    if (this.selected) {
      this.highlight
        .rect(this.selected.x, this.selected.y, 1, 1)
        .stroke({ width: Math.max(2 / z, 0.05), color: 0xffffff, alpha: 0.95 });
    }
    const chosen =
      this.selectedFolk === null ? undefined : this.folk.find((f) => f.id === this.selectedFolk);
    if (chosen) {
      this.highlight
        .circle(chosen.x + 0.5, chosen.y + 0.5, this.folkSize() * 0.85)
        .stroke({ width: 2 / z, color: 0xffffff, alpha: 1 });
    }
  }

  private visibleRange(): { x0: number; y0: number; x1: number; y1: number } {
    const { width: vw, height: vh } = this.app.screen;
    const z = this.zoom;
    return {
      x0: Math.max(0, Math.floor(-this.stage.position.x / z)),
      y0: Math.max(0, Math.floor(-this.stage.position.y / z)),
      x1: Math.min(this.width, Math.ceil((vw - this.stage.position.x) / z)),
      y1: Math.min(this.height, Math.ceil((vh - this.stage.position.y) / z)),
    };
  }

  /** Small per-species shapes inside each visible tile; size shows how full the tile is. */
  private redrawMarkers(): void {
    let used = 0;
    if (this.showSprites && this.zoom >= SPRITE_MIN_ZOOM && this.frames.length > 0 && this.circle) {
      const { x0, y0, x1, y1 } = this.visibleRange();
      for (let s = 0; s < this.species.length; s++) {
        const frame = this.frames[s];
        const info = this.species[s];
        if (!frame || !info) continue;
        const slotX = 0.25 + 0.5 * (s % 2);
        const slotY = 0.25 + 0.5 * Math.floor(s / 2);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const v = frame[y * this.width + x]!;
            if (v === 0) continue;
            const fill = (v - 1) / 254;
            if (fill < SPRITE_MIN_FILL) continue;
            let marker = this.markerPool[used];
            if (!marker) {
              marker = new Sprite(Texture.WHITE);
              marker.anchor.set(0.5);
              this.markerPool.push(marker);
              this.markers.addChild(marker);
            }
            marker.texture = info.kind === 'animal' ? this.circle : Texture.WHITE;
            marker.tint = info.color;
            marker.width = marker.height = 0.44 * Math.sqrt(fill);
            marker.position.set(x + slotX, y + slotY);
            marker.visible = true;
            used++;
          }
        }
      }
    }
    for (let i = used; i < this.markerPool.length; i++) this.markerPool[i]!.visible = false;
  }

  private redrawOverlays(): void {
    const z = this.zoom;

    this.grid.clear();
    if (z >= GRID_MIN_ZOOM && this.width > 0) {
      const { x0, y0, x1, y1 } = this.visibleRange();
      for (let x = x0; x <= x1; x++) this.grid.moveTo(x, y0).lineTo(x, y1);
      for (let y = y0; y <= y1; y++) this.grid.moveTo(x0, y).lineTo(x1, y);
      this.grid.stroke({ width: 1 / z, color: 0x000000, alpha: 0.25 });
    }

    this.updateFolk();
    this.redrawHighlight();
    this.redrawMarkers();
  }
}
