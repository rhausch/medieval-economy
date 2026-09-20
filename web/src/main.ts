const SERVER_URL = `ws://${location.hostname}:8787`;

const statusEl = document.getElementById('status') as HTMLElement;
const tickEl = document.getElementById('tick') as HTMLElement;
const toggleEl = document.getElementById('toggle') as HTMLButtonElement;

let paused = false;
const socket = new WebSocket(SERVER_URL);

socket.addEventListener('open', () => {
  statusEl.textContent = 'connected';
  toggleEl.disabled = false;
});
socket.addEventListener('close', () => {
  statusEl.textContent = 'disconnected';
  toggleEl.disabled = true;
});
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data as string) as { type: string; tick: number; paused: boolean };
  if (msg.type !== 'tick') return;
  tickEl.textContent = String(msg.tick);
  paused = msg.paused;
  toggleEl.textContent = paused ? 'Resume' : 'Pause';
});
toggleEl.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: paused ? 'resume' : 'pause' }));
});
