import type { DeciderInfo, SpeciesInfo, TerrainInfo } from './net';
import type { StatsMessage } from '../../packages/server/src/protocol';

/** Colors for the actions Folk can be doing. */
const ACTION_COLORS: Record<string, string> = {
  idle: '#556070',
  moving: '#8b98a8',
  eating: '#e0a030',
  resting: '#4f9bd9',
  gathering: '#b04a9c',
  digging: '#d98a3d',
  snaring: '#dfe6ee',
  chasing: '#8a5a32',
  baseline: '#8d6e63',
  healing: '#d05050',
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const compact = (v: number): string =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(2)}M`
    : v >= 1e4
      ? `${(v / 1e3).toFixed(0)}k`
      : v >= 100
        ? v.toFixed(0)
        : v.toFixed(1);
const percent = (v: number): string => `${(100 * v).toFixed(0)}%`;
const micros = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

interface Item {
  label: string;
  value: number;
  color: string;
  note?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Horizontal bars, each sized against the largest value, with the share of the total beside it. */
function bars(items: Item[]): HTMLElement {
  const box = el('div');
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  for (const item of items) {
    const row = el('div', 'share-row');
    const label = el('span', 'muted', item.label);
    const track = el('div', 'bar');
    const fill = el('span');
    fill.style.width = `${(100 * item.value) / max}%`;
    fill.style.background = item.color;
    track.append(fill);
    const note = el(
      'span',
      undefined,
      item.note ?? (total > 0 ? percent(item.value / total) : '-'),
    );
    row.append(label, track, note);
    box.append(row);
  }
  return box;
}

function table(header: string[], rows: string[][]): HTMLTableElement {
  const t = el('table', 'stats-table');
  const head = el('tr');
  for (const h of header) head.append(el('th', undefined, h));
  t.append(head);
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((cell, i) => tr.append(el(i === 0 ? 'th' : 'td', undefined, cell)));
    t.append(tr);
  }
  return t;
}

export interface StatsView {
  setWorld(species: SpeciesInfo[], terrain: TerrainInfo[], deciders: DeciderInfo[]): void;
  update(msg: StatsMessage): void;
}

/** Builds the collapsible Stats sections inside `root` and keeps them up to date. */
export function createStatsView(root: HTMLElement): StatsView {
  const sections = new Map<string, HTMLElement>();
  for (const [key, title, open] of [
    ['perf', 'Performance', true],
    ['food', 'Food by terrain', true],
    ['time', 'Time by action', false],
    ['walking', 'Walking by terrain', false],
    ['knowledge', 'What Folk know', false],
    ['energy', 'Calories in and out', false],
    ['sources', 'Where calories come from', false],
  ] as const) {
    const details = el('details');
    details.open = open;
    details.append(el('summary', undefined, title));
    const body = el('div', 'stats-body', 'Waiting for data...');
    details.append(body);
    root.append(details);
    sections.set(key, body);
  }

  let species: SpeciesInfo[] = [];
  let terrainColors = new Map<string, string>();
  let deciders: DeciderInfo[] = [];
  const set = (key: string, ...nodes: (Node | string)[]): void =>
    sections.get(key)?.replaceChildren(...nodes);

  const deciderName = (key: string): string => deciders.find((d) => d.key === key)?.name ?? key;
  const deciderTitle = (key: string): HTMLElement => {
    const row = el('div', 'stats-title');
    const swatch = el('span', 'swatch');
    swatch.style.background = hex(deciders.find((d) => d.key === key)?.color ?? 0x888888);
    row.append(swatch, deciderName(key));
    return row;
  };

  function perf(msg: StatsMessage): void {
    const p = msg.perf;
    if (!p) return set('perf', 'Collecting timing...');
    const lines = el('div');
    for (const line of [
      `${p.ticksPerSecond.toFixed(1)} ticks/s, ${p.msPerTick.toFixed(2)} ms/tick`,
      `ecology ${p.ecologyMsPerTick.toFixed(2)} ms, Folk ${p.folkMsPerTick.toFixed(3)} ms`,
      `${p.decisionsPerTick.toFixed(1)} decisions/tick`,
    ]) {
      lines.append(el('div', undefined, line));
    }
    const rows = [
      ...p.deciders
        .filter((d) => d.decisions > 0)
        .map((d) => [
          deciderName(d.key),
          String(d.decisions),
          micros(d.p50Us),
          micros(d.p95Us),
          micros(d.p99Us),
          micros(d.maxUs),
        ]),
      [
        'search',
        '',
        micros(p.scan.p50Us),
        micros(p.scan.p95Us),
        micros(p.scan.p99Us),
        micros(p.scan.maxUs),
      ],
    ];
    const note = el('div', 'muted small', 'Decision time in microseconds, whole run so far.');
    set('perf', lines, table(['', 'decisions', 'p50', 'p95', 'p99', 'max'], rows), note);
  }

  function food(msg: StatsMessage): void {
    const foods = species.filter((s) => s.food);
    const header = ['', ...foods.map((s) => s.name)];
    const rows = msg.terrains
      .filter((t) => t.species.some((s) => s.habitable > 0))
      .map((t) => [
        `${t.terrain} (${compact(t.tiles)})`,
        ...foods.map((s) => {
          const cell = t.species.find((x) => x.key === s.key);
          return cell && cell.capacity > 0 ? percent(cell.stock / cell.capacity) : '-';
        }),
      ]);
    const patches = species
      .map((s) => {
        const cells = msg.terrains.flatMap((t) => t.species.filter((x) => x.key === s.key));
        const tiles = cells.reduce((sum, c) => sum + c.habitable, 0);
        const gone = cells.reduce((sum, c) => sum + c.depleted, 0);
        return tiles > 0
          ? `${s.name}: ${compact(tiles)} tiles, ${percent(gone / tiles)} emptied`
          : null;
      })
      .filter((line): line is string => line !== null);
    const carried = Object.entries(msg.carried)
      .map(([good, units]) => `${good} ${units.toFixed(0)} kg`)
      .join(', ');
    set(
      'food',
      table(header, rows),
      el('div', 'muted small', 'Stock as a share of capacity, by terrain (tiles in brackets).'),
      el('div', 'muted small', `Carried by Folk: ${carried}`),
      el('div', 'muted small', `Patches (tiles a species lives on): ${patches.join(' · ')}`),
    );
  }

  function timeByAction(msg: StatsMessage): HTMLElement {
    const box = el('div');
    for (const d of deciders) {
      const items = msg.activity
        .filter((r) => r.decider === d.key)
        .map((r) => ({
          label: r.action,
          value: r.folkTicks,
          color: ACTION_COLORS[r.action] ?? '#888',
        }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value);
      box.append(deciderTitle(d.key));
      box.append(items.length > 0 ? bars(items) : el('div', 'muted small', 'No data yet.'));
    }
    return box;
  }

  /** Calories burned by category (baseline, healing, each activity above baseline), and calories eaten. */
  function calories(msg: StatsMessage): HTMLElement {
    const box = el('div');
    for (const d of deciders) {
      const ledger = msg.ledger.filter((r) => r.decider === d.key);
      const eaten = ledger.find((r) => r.category === 'eaten')?.kcal ?? 0;
      const items = [
        ...ledger
          .filter((r) => r.category !== 'eaten')
          .map((r) => ({
            label: r.category,
            value: r.kcal,
            color: ACTION_COLORS[r.category] ?? '#888',
          })),
        ...msg.activity
          .filter((r) => r.decider === d.key)
          .map((r) => ({
            label: r.action,
            value: r.kcal,
            color: ACTION_COLORS[r.action] ?? '#888',
          })),
      ]
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value);
      const burned =
        ledger.filter((r) => r.category !== 'eaten').reduce((sum, r) => sum + r.kcal, 0) +
        msg.activity.filter((r) => r.decider === d.key).reduce((sum, r) => sum + r.kcal, 0);
      box.append(deciderTitle(d.key));
      box.append(items.length > 0 ? bars(items) : el('div', 'muted small', 'No data yet.'));
      box.append(
        el(
          'div',
          'muted small',
          `Eaten ${compact(eaten)} kcal · burned ${compact(burned)} kcal · balance ${burned > 0 ? percent(eaten / burned) : '-'} of burn`,
        ),
      );
    }
    return box;
  }

  /** How much each decider's Folk remember and have explored. */
  function knowledge(msg: StatsMessage): void {
    const rows = msg.knowledge.map((k) => [
      deciderName(k.decider),
      k.places.toFixed(1),
      compact(k.meanAge),
      percent(k.explored),
    ]);
    set(
      'knowledge',
      rows.length > 0 ? table(['', 'places', 'avg age', 'map seen'], rows) : 'No Folk yet.',
      el(
        'div',
        'muted small',
        'Places remembered per Folk, how many ticks ago they were seen on average, and the share of the map each has seen.',
      ),
    );
  }

  /** Steps taken on each terrain, how long they took (1 is a tile a tick) and what they cost. */
  function walking(msg: StatsMessage): void {
    const byTerrain = new Map<string, { steps: number; ticks: number; kcal: number }>();
    for (const r of msg.travel) {
      const t = byTerrain.get(r.terrain) ?? { steps: 0, ticks: 0, kcal: 0 };
      t.steps += r.steps;
      t.ticks += r.ticks;
      t.kcal += r.kcal;
      byTerrain.set(r.terrain, t);
    }
    const total = [...byTerrain.values()].reduce((sum, t) => sum + t.steps, 0);
    const rows = [...byTerrain.entries()]
      .sort((a, b) => b[1].steps - a[1].steps)
      .map(([terrain, t]) => [
        terrain,
        percent(total > 0 ? t.steps / total : 0),
        (t.ticks / t.steps).toFixed(2),
        (t.kcal / t.steps).toFixed(1),
      ]);
    set(
      'walking',
      rows.length > 0
        ? table(['', 'of steps', 'ticks/step', 'kcal/step'], rows)
        : 'No walking yet.',
      el(
        'div',
        'muted small',
        'Ticks per step: 1 is a tile per tick; higher is slower ground or slope.',
      ),
    );
  }

  function sources(msg: StatsMessage): void {
    const box = el('div');
    for (const d of deciders) {
      const mine = msg.sources.filter((r) => r.decider === d.key);
      if (mine.length === 0) continue;
      box.append(deciderTitle(d.key));
      const bySpecies = species
        .map((s) => {
          const rows = mine.filter((r) => r.species === s.key);
          const attempts = rows.reduce((sum, r) => sum + r.attempts, 0);
          const successes = rows.reduce((sum, r) => sum + r.successes, 0);
          const kcal = rows.reduce((sum, r) => sum + r.kcal, 0);
          return { s, attempts, successes, kcal };
        })
        .filter((x) => x.attempts > 0);
      const total = bySpecies.reduce((sum, x) => sum + x.kcal, 0);
      box.append(
        bars(
          bySpecies.map((x) => ({
            label: x.s.name,
            value: x.kcal,
            color: hex(x.s.color),
            note: `${percent(total > 0 ? x.kcal / total : 0)} · ${percent(x.successes / x.attempts)} ok`,
          })),
        ),
      );
      const terrains = [...new Set(mine.map((r) => r.terrain))]
        .map((t) => ({
          label: t,
          value: mine.filter((r) => r.terrain === t).reduce((sum, r) => sum + r.kcal, 0),
          color: terrainColors.get(t) ?? '#888',
        }))
        .sort((a, b) => b.value - a.value);
      box.append(el('div', 'muted small', 'By terrain:'), bars(terrains));
    }
    const eaten = el('div', 'muted small');
    eaten.textContent = `Eaten: ${msg.consumption.map((r) => `${deciderName(r.decider)} ${r.good} ${compact(r.kg)} kg`).join(' · ') || 'nothing yet'}`;
    set('sources', box.childNodes.length > 0 ? box : 'No foraging yet.', eaten);
  }

  return {
    setWorld(newSpecies, terrain, newDeciders) {
      species = newSpecies;
      deciders = newDeciders;
      terrainColors = new Map(terrain.map((t) => [t.key, hex(t.color)]));
    },
    update(msg) {
      perf(msg);
      food(msg);
      set('time', timeByAction(msg));
      walking(msg);
      knowledge(msg);
      set('energy', calories(msg));
      sources(msg);
    },
  };
}
