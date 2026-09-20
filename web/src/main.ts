import { connect, type TileMessage, type WorldData } from './net';
import { WorldView } from './renderer';

const SERVER_URL = `ws://${location.hostname}:8787`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $('status');
const tickEl = $('tick');
const toggleEl = $<HTMLButtonElement>('toggle');
const generateEl = $<HTMLButtonElement>('generate');
const reseedEl = $<HTMLButtonElement>('reseed');
const paramsEl = $<HTMLFormElement>('params');
const tileEl = $('tile');
const legendEl = $('legend');

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

function showWorld(data: WorldData): void {
  for (const [key, input] of inputs) {
    input.value = String(data.meta.params[key as keyof typeof data.meta.params]);
  }
  legendEl.replaceChildren(
    ...data.meta.terrain.map((t) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = `#${t.color.toString(16).padStart(6, '0')}`;
      li.append(swatch, t.name);
      return li;
    }),
  );
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
  view.select(t.x, t.y);
}

const view = new WorldView();
await view.init($('view'));

let paused = false;
const conn = connect(SERVER_URL, {
  onOpen() {
    statusEl.textContent = 'connected';
    toggleEl.disabled = generateEl.disabled = reseedEl.disabled = false;
  },
  onClose() {
    statusEl.textContent = 'disconnected';
    toggleEl.disabled = generateEl.disabled = reseedEl.disabled = true;
  },
  onWorld: showWorld,
  onMessage(msg) {
    if (msg.type === 'tick') {
      tickEl.textContent = String(msg.tick);
      paused = msg.paused;
      toggleEl.textContent = paused ? 'Resume' : 'Pause';
    } else if (msg.type === 'tile') {
      showTile(msg);
    }
  },
});

view.onTileClick = (x, y) => conn.send({ type: 'inspect', x, y });
toggleEl.addEventListener('click', () => conn.send({ type: paused ? 'resume' : 'pause' }));
generateEl.addEventListener('click', () => conn.send({ type: 'generate', params: readParams() }));
reseedEl.addEventListener('click', () => {
  const seedInput = inputs.get('seed');
  if (seedInput) seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  conn.send({ type: 'generate', params: readParams() });
});
