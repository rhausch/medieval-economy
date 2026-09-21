import {
  connect,
  type DeciderInfo,
  type FolkDetailMessage,
  type SpeciesInfo,
  type TileMessage,
  type WorldData,
} from './net';
import { WorldView } from './renderer';
import { createStatsView } from './stats';

const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '8787';
const SERVER_URL = `ws://${location.hostname}:${SERVER_PORT}`;
const SPEEDS = [1, 2, 5, 10, 20];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $('status');
const tickEl = $('tick');
const toggleEl = $<HTMLButtonElement>('toggle');
const speedsEl = $('speeds');
const generateEl = $<HTMLButtonElement>('generate');
const reseedEl = $<HTMLButtonElement>('reseed');
const paramsEl = $<HTMLFormElement>('params');
const tileEl = $('tile');
const legendEl = $('legend');
const overlayEl = $<HTMLSelectElement>('overlay');
const spritesEl = $<HTMLInputElement>('sprites');
const totalsEl = $('totals');
const decidersEl = $('deciders');
const configEl = $('config');
const statsView = createStatsView($('stats'));
const folkDetailEl = $('folk-detail');

const FIELDS = [
  { key: 'seed', label: 'Seed', step: 1 },
  { key: 'width', label: 'Width', step: 8 },
  { key: 'height', label: 'Height', step: 8 },
  { key: 'noiseScale', label: 'Feature size', step: 4 },
  { key: 'octaves', label: 'Octaves', step: 1 },
  { key: 'waterFraction', label: 'Water', step: 0.05 },
  { key: 'beachFraction', label: 'Beach', step: 0.01 },
  { key: 'hillFraction', label: 'Hills', step: 0.05 },
  { key: 'mountainFraction', label: 'Mountains', step: 0.02 },
  { key: 'forestFraction', label: 'Forest', step: 0.05 },
  { key: 'plantRegrowthScale', label: 'Plant regrowth', step: 0.05 },
  { key: 'coverageScale', label: 'Food coverage', step: 0.25 },
  { key: 'separateAnimalFood', label: 'Animals graze own (0/1)', step: 1 },
] as const;

const inputs = new Map<string, HTMLInputElement>();
for (const f of FIELDS) {
  const label = document.createElement('label');
  label.append(f.label);
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(f.step);
  input.name = f.key;
  inputs.set(f.key, input);
  label.append(input);
  paramsEl.append(label);
}

function readParams(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, input] of inputs) if (input.value !== '') out[key] = Number(input.value);
  return out;
}

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function swatch(color: number): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'swatch';
  el.style.background = hex(color);
  return el;
}

let species: SpeciesInfo[] = [];
let deciders: DeciderInfo[] = [];
const totalValueEls: HTMLElement[] = [];

function showWorld(data: WorldData): void {
  for (const [key, input] of inputs) {
    input.value = String(
      key === 'plantRegrowthScale' || key === 'coverageScale' || key === 'separateAnimalFood'
        ? data.meta.ecology[key]
        : data.meta.params[key as keyof typeof data.meta.params],
    );
  }
  deciders = data.meta.deciders;
  reserveCapacity = data.meta.body.capacity;
  configEl.textContent = `Configuration ${data.meta.settingsHash}`;
  decidersEl.replaceChildren(
    ...deciders.map((d) => {
      const li = document.createElement('li');
      li.style.justifyContent = 'space-between';
      const name = document.createElement('span');
      name.style.display = 'flex';
      name.style.gap = '8px';
      name.style.alignItems = 'center';
      name.append(swatch(d.color), d.name);
      const count = document.createElement('span');
      count.className = 'muted';
      count.dataset.decider = d.key;
      li.append(name, count);
      return li;
    }),
  );
  legendEl.replaceChildren(
    ...data.meta.terrain.map((t) => {
      const li = document.createElement('li');
      li.append(swatch(t.color), t.name);
      return li;
    }),
  );

  species = data.meta.species;
  const previous = overlayEl.value;
  overlayEl.replaceChildren(
    new Option('None', ''),
    ...species.map((s) => new Option(s.name, String(s.id))),
  );
  overlayEl.value = previous;
  view.setOverlaySpecies(overlayEl.value === '' ? null : Number(overlayEl.value));

  totalValueEls.length = 0;
  totalsEl.replaceChildren(
    ...species.map((s) => {
      const li = document.createElement('li');
      const value = document.createElement('span');
      value.className = 'muted';
      totalValueEls.push(value);
      const name = document.createElement('span');
      name.style.display = 'flex';
      name.style.gap = '8px';
      name.style.alignItems = 'center';
      name.append(swatch(s.color), s.name);
      li.append(name, value);
      return li;
    }),
  );

  statsView.setWorld(data.meta.species, data.meta.terrain, data.meta.deciders);
  view.setWorld(data);
  tileEl.textContent = 'Click a tile to inspect it.';
  tileEl.className = 'muted';
}

function showTile(t: TileMessage): void {
  const rows: [string, string][] = [
    ['Position', `${t.x}, ${t.y}`],
    ['Terrain', t.terrain],
    ['Category', t.category],
    ['Walkable', t.walkable ? 'yes' : 'no'],
    ['Elevation', t.elevation.toFixed(2)],
    ['Moisture', t.moisture.toFixed(2)],
  ];
  const dl = document.createElement('dl');
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  tileEl.className = '';
  tileEl.replaceChildren(dl);

  if (t.resources.length > 0) {
    const heading = document.createElement('h2');
    heading.textContent = 'Resources here';
    tileEl.append(heading);
    for (const r of t.resources) {
      const info = species.find((s) => s.key === r.key);
      const line = document.createElement('div');
      line.textContent = `${r.name}: ${r.stock.toFixed(1)} / ${r.capacity.toFixed(1)}${
        r.kind === 'animal' ? ' head' : ''
      }`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.min(100, (100 * r.stock) / (r.capacity || 1))}%`;
      fill.style.background = info ? hex(info.color) : '#888';
      bar.append(fill);
      tileEl.append(line, bar);
    }
  }
  view.select(t.x, t.y);
}

let selectedFolk: number | null = null;
/** Calorie reserve capacity of this run, from the server. */
let reserveCapacity = 15000;

/** A labelled bar filled to `fraction` (0 to 1), with `text` beside it. */
function bar(label: string, fraction: number, color: string, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'bar-row';
  const name = document.createElement('span');
  name.className = 'muted';
  name.textContent = label;
  const track = document.createElement('div');
  track.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.max(0, Math.min(100, 100 * fraction))}%`;
  fill.style.background = color;
  track.append(fill);
  const number = document.createElement('span');
  number.textContent = text;
  row.append(name, track, number);
  return row;
}

function describeEvent(e: FolkDetailMessage['events'][number]): string {
  const at = `tick ${e.tick}:`;
  switch (e.type) {
    case 'eat':
      return `${at} ate ${e.kg.toFixed(2)} kg (${e.kcal.toFixed(0)} kcal)`;
    case 'gather':
      return `${at} gathered ${e.kg.toFixed(2)} kg ${e.species}`;
    case 'hunt':
      return e.success
        ? `${at} killed ${e.species}, +${e.kg.toFixed(1)} kg meat`
        : `${at} missed a ${e.species}`;
    case 'injure':
      return `${at} ${e.severity} injury while trying to ${e.action}`;
    case 'heal':
      return `${at} healed to ${e.severity === 'none' ? 'no injury' : 'a minor injury'}`;
    case 'spawn':
      return `${at} appeared (${e.reason}, ${e.decider})`;
    case 'die':
      return `${at} died of ${e.cause}`;
    case 'move':
      return `${at} moved to ${e.x}, ${e.y}`;
    case 'goal':
      return `${at} set out to ${e.option} at ${e.targetX}, ${e.targetY} (about ${e.ticks.toFixed(0)} ticks away)`;
    case 'interrupt':
      return `${at} stopped ${e.option === 'wander' ? 'strolling' : `on the way to ${e.option}`}: ${e.reason === 'hungry' ? 'time to eat' : 'the place ran out'}`;
  }
}

function showFolk(msg: FolkDetailMessage): void {
  if (!msg.found || !msg.folk) {
    folkDetailEl.className = 'muted';
    folkDetailEl.textContent = `Folk #${msg.id} is gone.`;
    if (selectedFolk === msg.id) {
      selectedFolk = null;
      view.setSelectedFolk(null);
      view.setGoal(null);
    }
    return;
  }
  const f = msg.folk;
  view.setGoal(f.goal);
  const goalLine = document.createElement('div');
  goalLine.className = 'muted';
  goalLine.style.margin = '4px 0';
  goalLine.textContent = f.goal
    ? `Goal: ${f.goal.option} at ${f.goal.targetX}, ${f.goal.targetY}, ${f.goal.stepsLeft} steps left (set ${f.goal.age} ticks ago)`
    : 'No goal';
  const dl = document.createElement('dl');
  const rows: [string, string][] = [
    ['Position', `${f.x}, ${f.y}`],
    ['Action', f.action],
    ['Age', `${f.age} ticks`],
    ['Foraging', f.foraging.toFixed(2)],
    ['Hunting', f.hunting.toFixed(2)],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const title = document.createElement('div');
  title.textContent = `Folk #${f.id}`;
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';

  const inventory = document.createElement('div');
  inventory.className = 'muted';
  const held = f.inventory.filter((item) => item.kg > 0.001);
  inventory.textContent =
    held.length > 0
      ? `Carrying ${f.carriedKg.toFixed(1)} / ${f.capacityKg} kg: ${held.map((i) => `${i.name} ${i.kg.toFixed(1)} kg (${i.kcal.toFixed(0)} kcal)`).join(', ')}`
      : `Carrying nothing (capacity ${f.capacityKg} kg)`;
  inventory.style.margin = '6px 0';

  const energyLine = document.createElement('div');
  energyLine.className = 'muted';
  energyLine.textContent = `${f.reserve.toFixed(0)} kcal in reserve. Burning ${f.burnNow.toFixed(1)} kcal per tick. Lifetime: ate ${f.kcalEaten.toFixed(0)} kcal in ${f.meals} meals, burned ${f.kcalSpent.toFixed(0)} kcal.`;
  energyLine.style.margin = '4px 0';

  const decider = deciders.find((d) => d.key === f.decider);
  const deciderLine = document.createElement('div');
  deciderLine.style.display = 'flex';
  deciderLine.style.gap = '8px';
  deciderLine.style.alignItems = 'center';
  deciderLine.append(swatch(decider?.color ?? 0x888888), `${decider?.name ?? f.decider} decider`);
  const injuryLine = document.createElement('div');
  injuryLine.className = 'muted';
  injuryLine.textContent =
    f.injuryName === 'none'
      ? 'Not injured'
      : `${f.injuryName} injury (heals a level in ${Math.ceil(f.injuryRemaining)} ticks)`;

  const paramTitle = document.createElement('h2');
  paramTitle.textContent = 'Parameters';
  const paramList = document.createElement('div');
  for (const p of f.params) {
    const row = document.createElement('div');
    row.className = 'param-row';
    const name = document.createElement('span');
    name.className = 'muted';
    name.textContent = p.label;
    const track = document.createElement('div');
    track.className = 'bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(0, Math.min(100, (100 * (p.value - p.min)) / (p.max - p.min || 1)))}%`;
    fill.style.background = '#8b98a8';
    track.append(fill);
    const value = document.createElement('span');
    value.textContent = p.value.toFixed(2);
    row.append(name, track, value);
    paramList.append(row);
  }

  const chosenTitle = document.createElement('h2');
  chosenTitle.textContent = `Last decision: ${f.chosen}`;
  const scoreList = document.createElement('div');
  const ranked = [...f.scores].sort((a, b) => b.score - a.score);
  const top = Math.max(0.01, ...ranked.map((s) => Math.abs(s.score)));
  for (const s of ranked) {
    if (f.decider !== 'utility') break;
    const row = document.createElement('div');
    row.className = 'bar-row';
    const name = document.createElement('span');
    name.className = 'muted';
    name.textContent = s.option;
    const track = document.createElement('div');
    track.className = 'bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(0, Math.min(100, (100 * s.score) / top))}%`;
    fill.style.background = s.option === f.chosen ? '#5b9bd5' : '#556070';
    track.append(fill);
    const value = document.createElement('span');
    value.textContent = s.score.toFixed(2);
    row.append(name, track, value);
    scoreList.append(row);
  }

  const events = document.createElement('div');
  events.className = 'events';
  events.append(
    ...[...msg.events].reverse().map((e) => {
      const line = document.createElement('div');
      line.textContent = describeEvent(e);
      return line;
    }),
  );

  folkDetailEl.className = '';
  folkDetailEl.replaceChildren(
    title,
    deciderLine,
    bar(
      'Calories',
      f.reserve / reserveCapacity,
      '#e0a030',
      `${((100 * f.reserve) / reserveCapacity).toFixed(0)}%`,
    ),
    energyLine,
    injuryLine,
    goalLine,
    dl,
    inventory,
    chosenTitle,
    scoreList,
    paramTitle,
    paramList,
    events,
  );
}

const view = new WorldView();
await view.init($('view'));

let paused = false;
const speedButtons = new Map<number, HTMLButtonElement>();

const conn = connect(SERVER_URL, {
  onOpen() {
    statusEl.textContent = 'connected';
    toggleEl.disabled = generateEl.disabled = reseedEl.disabled = false;
    conn.send({ type: 'subscribe', resources: true });
  },
  onClose() {
    statusEl.textContent = 'disconnected';
    toggleEl.disabled = generateEl.disabled = reseedEl.disabled = true;
  },
  onWorld(data) {
    selectedFolk = null;
    view.setSelectedFolk(null);
    view.setGoal(null);
    folkDetailEl.className = 'muted';
    folkDetailEl.textContent = 'Click a Folk to inspect it.';
    showWorld(data);
  },
  onResources(data) {
    view.setResources(data);
    data.meta.totals.forEach((total, i) => {
      const el = totalValueEls[i];
      if (el) el.textContent = Math.round(total).toLocaleString();
    });
  },
  onMessage(msg) {
    if (msg.type === 'tick') {
      tickEl.textContent = String(msg.tick);
      paused = msg.paused;
      toggleEl.textContent = paused ? 'Resume' : 'Pause';
      for (const [speed, button] of speedButtons) {
        button.classList.toggle('active', speed === msg.speed);
      }
    } else if (msg.type === 'tile') {
      showTile(msg);
    } else if (msg.type === 'folk') {
      view.setFolk(msg.folk);
      for (const el of decidersEl.querySelectorAll<HTMLElement>('[data-decider]')) {
        const n = msg.folk.filter((f) => f.decider === el.dataset.decider).length;
        el.textContent = `${n} alive`;
      }
      if (selectedFolk !== null) conn.send({ type: 'inspectFolk', id: selectedFolk });
    } else if (msg.type === 'stats') {
      statsView.update(msg);
    } else if (msg.type === 'folkDetail') {
      showFolk(msg);
    }
  },
});

for (const speed of SPEEDS) {
  const button = document.createElement('button');
  button.textContent = `${speed}x`;
  button.addEventListener('click', () => conn.send({ type: 'speed', speed }));
  speedButtons.set(speed, button);
  speedsEl.append(button);
}

view.onTileClick = (x, y) => conn.send({ type: 'inspect', x, y });
view.onFolkClick = (id) => {
  selectedFolk = id;
  view.setSelectedFolk(id);
  conn.send({ type: 'inspectFolk', id });
};
toggleEl.addEventListener('click', () => conn.send({ type: paused ? 'resume' : 'pause' }));
generateEl.addEventListener('click', () => conn.send({ type: 'generate', params: readParams() }));
reseedEl.addEventListener('click', () => {
  const seedInput = inputs.get('seed');
  if (seedInput) seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  conn.send({ type: 'generate', params: readParams() });
});
overlayEl.addEventListener('change', () => {
  view.setOverlaySpecies(overlayEl.value === '' ? null : Number(overlayEl.value));
});
spritesEl.addEventListener('change', () => view.setShowSprites(spritesEl.checked));
