/**
 * Walking-time search over the terrain. Each step costs time that depends on the ground stepped onto
 * (its speed) and the slope (steeper is slower), so the nearest place is the one that takes the least
 * time to reach, not the fewest tiles, and a Folk will go around slow ground when that is quicker.
 */
import type { Settings } from '../config';
import { TERRAIN_LIST } from '../data/terrain';
import type { World } from '../world';

/** Neighbour offsets in a fixed order so searches are deterministic. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Binary min-heap ordered by key, then node index, so equal costs always resolve the same way. */
class MinHeap {
  keys = new Float64Array(1024);
  nodes = new Int32Array(1024);
  size = 0;
  topKey = 0;
  topNode = 0;

  clear(): void {
    this.size = 0;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a]!;
    const kb = this.keys[b]!;
    return ka < kb || (ka === kb && this.nodes[a]! < this.nodes[b]!);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    const n = this.nodes[a]!;
    this.keys[a] = this.keys[b]!;
    this.nodes[a] = this.nodes[b]!;
    this.keys[b] = k;
    this.nodes[b] = n;
  }

  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const nodes = new Int32Array(this.size * 2);
      keys.set(this.keys);
      nodes.set(this.nodes);
      this.keys = keys;
      this.nodes = nodes;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.nodes[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Remove the smallest entry into `topKey` and `topNode`. */
  pop(): void {
    this.topKey = this.keys[0]!;
    this.topNode = this.nodes[0]!;
    this.size--;
    if (this.size === 0) return;
    this.keys[0] = this.keys[this.size]!;
    this.nodes[0] = this.nodes[this.size]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.less(l, m)) m = l;
      if (r < this.size && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}

export interface Router {
  /** Walking speed per terrain id, in tiles per tick (0 = cannot walk there). */
  readonly speed: Float64Array;
  readonly dist: Float64Array;
  /** Calories to walk there: time at the walking rate plus climbing. */
  readonly kcal: Float64Array;
  readonly parent: Int32Array;
  readonly stamp: Uint32Array;
  readonly closed: Uint32Array;
  readonly heap: MinHeap;
  current: number;
}

export function createRouter(world: World, settings: Settings): Router {
  const n = world.width * world.height;
  const speed = new Float64Array(TERRAIN_LIST.length);
  for (const t of TERRAIN_LIST) {
    speed[t.id] = t.walkable ? (settings.movement.terrainSpeed[t.key] ?? 1) : 0;
  }
  return {
    speed,
    dist: new Float64Array(n),
    kcal: new Float64Array(n),
    parent: new Int32Array(n),
    stamp: new Uint32Array(n),
    closed: new Uint32Array(n),
    heap: new MinHeap(),
    current: 0,
  };
}

/** Ticks one step from tile `from` to the adjacent tile `to` takes an uninjured Folk. */
export function stepTicks(
  world: World,
  settings: Settings,
  router: Router,
  from: number,
  to: number,
): number {
  const meters =
    (world.elevation[to]! - world.elevation[from]!) * settings.movement.elevationRangeM;
  const grade = (meters < 0 ? -meters : meters) / settings.units.tileMeters;
  return (1 + settings.movement.slopeSlowdown * grade) / router.speed[world.terrain[to]!]!;
}

/** Metres climbed stepping from `from` to `to` (0 when the step is level or downhill). */
export function climbMeters(world: World, settings: Settings, from: number, to: number): number {
  const meters =
    (world.elevation[to]! - world.elevation[from]!) * settings.movement.elevationRangeM;
  return meters > 0 ? meters : 0;
}

/**
 * Explore outward from `start` in order of walking time, calling `visit(tile, ticks, kcal)` for each tile
 * as it is reached; the search stops when `visit` returns true, or when the time budget
 * (`folk.searchTicks`) is used up. Afterwards `router.parent` holds the route to every tile reached.
 */
export function search(
  world: World,
  settings: Settings,
  router: Router,
  start: number,
  visit: (tile: number, ticks: number, kcal: number) => boolean,
): void {
  const { width, height, terrain, elevation } = world;
  const { movement, units, folk, activity } = settings;
  const r = router;
  const maxTicks = folk.searchTicks;
  const stampNow = ++r.current;
  r.heap.clear();
  r.stamp[start] = stampNow;
  r.dist[start] = 0;
  r.kcal[start] = 0;
  r.parent[start] = -1;
  r.heap.push(0, start);
  while (r.heap.size > 0) {
    r.heap.pop();
    const node = r.heap.topNode;
    if (r.closed[node] === stampNow) continue;
    r.closed[node] = stampNow;
    const d = r.dist[node]!;
    if (visit(node, d, r.kcal[node]!)) return;
    const cx = node % width;
    const cy = (node - cx) / width;
    const e0 = elevation[node]!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const speed = r.speed[terrain[next]!]!;
      if (speed === 0 || r.closed[next] === stampNow) continue;
      const meters = (elevation[next]! - e0) * movement.elevationRangeM;
      const grade = (meters < 0 ? -meters : meters) / units.tileMeters;
      const step = (1 + movement.slopeSlowdown * grade) / speed;
      const nd = d + step;
      if (nd > maxTicks) continue;
      if (r.stamp[next] !== stampNow || nd < r.dist[next]!) {
        r.stamp[next] = stampNow;
        r.dist[next] = nd;
        r.kcal[next] =
          r.kcal[node]! +
          step * activity.moving +
          (meters > 0 ? meters * movement.climbKcalPerMeter : 0);
        r.parent[next] = node;
        r.heap.push(nd, next);
      }
    }
  }
}

/** The tiles to walk from the last search's start to `target`, in order (excluding the start). */
export function routeTo(router: Router, target: number): Int32Array {
  const steps: number[] = [];
  for (let t = target; router.parent[t]! >= 0; t = router.parent[t]!) steps.push(t);
  return Int32Array.from(steps.reverse());
}
