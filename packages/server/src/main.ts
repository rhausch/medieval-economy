import { WebSocketServer, type WebSocket } from 'ws';
import { createSim } from '@folk/sim';
import type { ClientMessage, ServerMessage } from './protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 100;

const sim = createSim({ seed: Number(process.env.SEED ?? 1) });
let paused = false;

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

function snapshot(): ServerMessage {
  return { type: 'tick', tick: sim.tick, paused };
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) client.send(data);
}

wss.on('connection', (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(snapshot()));
  socket.on('close', () => clients.delete(socket));
  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'pause') paused = true;
    else if (msg.type === 'resume') paused = false;
    broadcast(snapshot());
  });
});

setInterval(() => {
  if (paused) return;
  sim.step();
  broadcast(snapshot());
}, TICK_MS);

console.log(`sim server listening on ws://localhost:${PORT}`);
