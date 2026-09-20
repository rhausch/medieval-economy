import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { WorldData } from './net';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;
const GRID_MIN_ZOOM = 12;
const CLICK_SLOP_PX = 4;

interface Selected {
  x: number;
  y: number;
}

/** Draws the world as one nearest-filtered texture (1 pixel per tile) with pan, zoom and selection. */
export class WorldView {
  private readonly app = new Application();
  private readonly stage = new Container();
  private readonly grid = new Graphics();
  private readonly highlight = new Graphics();
  private sprite: Sprite | null = null;
  private width = 0;
  private height = 0;
  private zoom = 4;
  private selected: Selected | null = null;

  onTileClick: (x: number, y: number) => void = () => {};

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
    this.stage.addChild(this.grid, this.highlight);
    this.bindInput(this.app.canvas);
    this.app.renderer.on('resize', () => this.redrawOverlays());
  }

  setWorld(data: WorldData): void {
    const { width, height } = data.meta.params;
    const colors = new Map(data.meta.terrain.map((t) => [t.id, t.color]));

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

    if (this.sprite) {
      this.stage.removeChild(this.sprite);
      this.sprite.destroy({ texture: true, textureSource: true });
    }
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    this.sprite = new Sprite(texture);
    this.stage.addChildAt(this.sprite, 0);

    const resized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.selected = null;
    if (resized) this.fit();
    this.redrawOverlays();
  }

  select(x: number, y: number): void {
    this.selected = { x, y };
    this.redrawOverlays();
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

  private redrawOverlays(): void {
    const { width: vw, height: vh } = this.app.screen;
    const z = this.zoom;

    this.grid.clear();
    if (z >= GRID_MIN_ZOOM && this.width > 0) {
      const x0 = Math.max(0, Math.floor(-this.stage.position.x / z));
      const y0 = Math.max(0, Math.floor(-this.stage.position.y / z));
      const x1 = Math.min(this.width, Math.ceil((vw - this.stage.position.x) / z));
      const y1 = Math.min(this.height, Math.ceil((vh - this.stage.position.y) / z));
      for (let x = x0; x <= x1; x++) this.grid.moveTo(x, y0).lineTo(x, y1);
      for (let y = y0; y <= y1; y++) this.grid.moveTo(x0, y).lineTo(x1, y);
      this.grid.stroke({ width: 1 / z, color: 0x000000, alpha: 0.25 });
    }

    this.highlight.clear();
    if (this.selected) {
      this.highlight
        .rect(this.selected.x, this.selected.y, 1, 1)
        .stroke({ width: Math.max(2 / z, 0.05), color: 0xffffff, alpha: 0.95 });
    }
  }
}
