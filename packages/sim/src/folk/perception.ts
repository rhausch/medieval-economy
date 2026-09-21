import type { Settings } from '../config';
import type { ForageDef } from '../data/actions';
import type { Ecology } from '../ecology';
import type { Rng } from '../rng';
import type { World } from '../world';
import { gridOf, type FolkStore } from './store';

/** A species Folk can gather or hunt, as perception sees it. */
export interface FoodSpecies {
  def: ForageDef;
  /** Index into the ecology's species. */
  species: number;
}

export interface Frontier {
  /** A walkable tile in the square worth exploring, or -1 if there is none. */
  tile: number;
  /** Estimated ticks to walk there. */
  ticks: number;
  /** Share of the nearby squares that are unexplored or long unvisited. */
  unexplored: number;
}

/**
 * What a Folk perceives and remembers. Every step it sees how much of each food species the tiles within that
 * species' detection range hold, and the lie of the land within the terrain range. Food it sees goes on its
 * blackboard as a remembered place (merged with nearby sightings of the same species); the land it has seen is
 * marked on its explored map. Nothing is known about places it has never been near.
 */
export class Perception {
  private readonly slots: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: number;

  constructor(
    private readonly world: World,
    private readonly eco: Ecology,
    private readonly store: FolkStore,
    private readonly settings: Settings,
    private readonly foods: readonly FoodSpecies[],
    private readonly walkable: Uint8Array,
  ) {
    this.slots = settings.perception.memorySlots;
    const grid = gridOf(world, settings);
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.cells = grid.cells;
  }

  /** The square of the explored map that contains a tile. */
  cellOf(x: number, y: number): number {
    const size = this.settings.perception.cellSize;
    return Math.floor(y / size) * this.cols + Math.floor(x / size);
  }

  /** Mark every square within `range` tiles of (x, y) as seen at `tick`. */
  private markSeen(slot: number, tick: number, x: number, y: number, range: number): void {
    const size = this.settings.perception.cellSize;
    const x0 = Math.max(0, Math.floor((x - range) / size));
    const x1 = Math.min(this.cols - 1, Math.floor((x + range) / size));
    const y0 = Math.max(0, Math.floor((y - range) / size));
    const y1 = Math.min(this.rows - 1, Math.floor((y + range) / size));
    const base = slot * this.cells;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const at = base + cy * this.cols + cx;
        if (this.store.seenCells[at]! < 0)
          this.store.seenCount[slot] = this.store.seenCount[slot]! + 1;
        this.store.seenCells[at] = tick;
      }
    }
  }

  private full(slot: number): boolean {
    const base = slot * this.slots;
    for (let k = 0; k < this.slots; k++) if (this.store.memSpecies[base + k]! < 0) return false;
    return true;
  }

  private remove(at: number): void {
    this.store.memSpecies[at] = -1;
    this.store.memTile[at] = -1;
  }

  /**
   * Remember a sighting: refresh the remembered place of that species nearby (keeping the richer tile), or
   * add a new one, replacing the longest unseen if memory is full. Returns 1 for a newly remembered place.
   */
  private upsert(
    slot: number,
    species: number,
    tile: number,
    amount: number,
    tick: number,
  ): number {
    const { store, world, settings } = this;
    const base = slot * this.slots;
    const tx = tile % world.width;
    const ty = (tile - tx) / world.width;
    const merge = settings.perception.mergeRadius;
    let free = -1;
    let oldest = -1;
    for (let k = 0; k < this.slots; k++) {
      const at = base + k;
      if (store.memSpecies[at]! < 0) {
        if (free < 0) free = at;
        continue;
      }
      if (store.memSpecies[at] === species) {
        const other = store.memTile[at]!;
        const ox = other % world.width;
        const oy = (other - ox) / world.width;
        if (Math.abs(ox - tx) <= merge && Math.abs(oy - ty) <= merge) {
          if (amount > store.memAmount[at]! || other === tile) {
            store.memTile[at] = tile;
            store.memAmount[at] = amount;
          }
          store.memSeen[at] = tick;
          return 0;
        }
      }
      if (oldest < 0 || store.memSeen[at]! < store.memSeen[oldest]!) oldest = at;
    }
    const at = free >= 0 ? free : oldest;
    store.memSpecies[at] = species;
    store.memTile[at] = tile;
    store.memAmount[at] = amount;
    store.memSeen[at] = tick;
    return 1;
  }

  /**
   * Look around from where the Folk stands: update what it remembers of the food it can see, forget
   * places it sees are empty (or has not seen for too long), and mark the land it sees as explored.
   * Returns how many new places it remembered.
   */
  perceive(slot: number, tick: number): number {
    const { store, world, eco, settings } = this;
    const x = store.x[slot]!;
    const y = store.y[slot]!;
    const base = slot * this.slots;
    let found = 0;
    for (let k = 0; k < this.slots; k++) {
      const at = base + k;
      if (
        store.memSpecies[at]! >= 0 &&
        tick - store.memSeen[at]! > settings.perception.memoryTicks
      ) {
        this.remove(at);
      }
    }
    for (const f of this.foods) {
      const range = eco.species[f.species]!.detectRange;
      if (range <= 0) continue;
      const stock = eco.stock[f.species]!;
      // Places in sight: refresh how much is there, and forget the ones that have run out.
      for (let k = 0; k < this.slots; k++) {
        const at = base + k;
        if (store.memSpecies[at] !== f.species) continue;
        const tile = store.memTile[at]!;
        const tx = tile % world.width;
        const ty = (tile - tx) / world.width;
        if (Math.abs(tx - x) > range || Math.abs(ty - y) > range) continue;
        const now = stock[tile]!;
        if (now < f.def.minStock) this.remove(at);
        else {
          store.memAmount[at] = now;
          store.memSeen[at] = tick;
        }
      }
      // Tiles in sight with enough to work: remember them.
      const y0 = Math.max(0, y - range);
      const y1 = Math.min(world.height - 1, y + range);
      const x0 = Math.max(0, x - range);
      const x1 = Math.min(world.width - 1, x + range);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const tile = ty * world.width + tx;
          const amount = stock[tile]!;
          if (amount >= f.def.minStock) found += this.upsert(slot, f.species, tile, amount, tick);
        }
      }
    }
    this.markSeen(slot, tick, x, y, settings.perception.terrainRange);
    return found;
  }

  /**
   * Give a Folk knowledge of the ground within `radius` tiles of where it stands, as if it grew up there: the
   * land is marked explored and the nearest patches of food are remembered (as many as memory holds).
   */
  learnArea(slot: number, tick: number, radius: number): void {
    const { store, world, eco } = this;
    const x = store.x[slot]!;
    const y = store.y[slot]!;
    const seen: { species: number; tile: number; amount: number; d: number }[] = [];
    for (const f of this.foods) {
      const stock = eco.stock[f.species]!;
      for (let ty = Math.max(0, y - radius); ty <= Math.min(world.height - 1, y + radius); ty++) {
        for (let tx = Math.max(0, x - radius); tx <= Math.min(world.width - 1, x + radius); tx++) {
          const tile = ty * world.width + tx;
          const amount = stock[tile]!;
          if (amount >= f.def.minStock) {
            seen.push({
              species: f.species,
              tile,
              amount,
              d: Math.max(Math.abs(tx - x), Math.abs(ty - y)),
            });
          }
        }
      }
    }
    seen.sort((a, b) => a.d - b.d || a.tile - b.tile);
    // Nearest first, and stop when memory is full: farther places must not push out nearer ones.
    for (const s of seen) {
      if (this.full(slot)) break;
      this.upsert(slot, s.species, s.tile, s.amount, tick);
    }
    this.markSeen(slot, tick, x, y, radius);
  }

  /**
   * Pick a square to go and look at: the closest of those unexplored or not seen for a long time, with a
   * walkable tile in it to walk to. `unexplored` is the share of nearby squares that qualify.
   */
  frontier(slot: number, tick: number, rng: Rng, out: Frontier): void {
    const { store, world, settings, walkable } = this;
    const { cellSize, exploreRadiusCells, staleExploreTicks, walkEstimate } = settings.perception;
    const x = store.x[slot]!;
    const y = store.y[slot]!;
    const cx0 = Math.floor(x / cellSize);
    const cy0 = Math.floor(y / cellSize);
    const base = slot * this.cells;
    const tried = new Set<number>();
    let total = 0;
    let worth = 0;
    out.tile = -1;
    out.ticks = 0;
    for (let attempt = 0; attempt < 3 && out.tile < 0; attempt++) {
      let best = -1;
      let bestScore = 0;
      total = 0;
      worth = 0;
      for (let cy = cy0 - exploreRadiusCells; cy <= cy0 + exploreRadiusCells; cy++) {
        for (let cx = cx0 - exploreRadiusCells; cx <= cx0 + exploreRadiusCells; cx++) {
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
          total++;
          const cell = cy * this.cols + cx;
          const seen = store.seenCells[base + cell]!;
          const age = seen < 0 ? Infinity : tick - seen;
          if (age < staleExploreTicks) continue;
          worth++;
          if (tried.has(cell)) continue;
          const distance = Math.max(Math.abs(cx - cx0), Math.abs(cy - cy0));
          const score = 1 / (1 + distance);
          if (score > bestScore) {
            bestScore = score;
            best = cell;
          }
        }
      }
      if (best < 0) break;
      tried.add(best);
      const cx = best % this.cols;
      const cy = (best - cx) / this.cols;
      const tx0 = cx * cellSize;
      const ty0 = cy * cellSize;
      for (let i = 0; i < 8 && out.tile < 0; i++) {
        const tx = Math.min(world.width - 1, tx0 + Math.floor(rng.next() * cellSize));
        const ty = Math.min(world.height - 1, ty0 + Math.floor(rng.next() * cellSize));
        const tile = ty * world.width + tx;
        if (walkable[world.terrain[tile]!]) {
          out.tile = tile;
          out.ticks = (Math.abs(tx - x) + Math.abs(ty - y)) * walkEstimate;
        }
      }
    }
    out.unexplored = total > 0 ? worth / total : 0;
  }
}
