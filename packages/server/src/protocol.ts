/** Messages the server sends to clients. */
export type ServerMessage = { type: 'tick'; tick: number; paused: boolean };

/** Messages clients send to the server. */
export type ClientMessage = { type: 'pause' } | { type: 'resume' };
