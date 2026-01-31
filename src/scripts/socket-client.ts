/**
 * Dev script: connect to the common WebSocket gateway.
 *
 * Usage:
 *   npm run socket:client
 *   BASE_URL=http://localhost:3000 GAME_MODE=sugar-daddy OPERATOR_ID=op1 AUTH_TOKEN=<jwt> npm run socket:client
 *
 * Get a JWT first via POST /api/auth (auth_token can be a generic JWT; the API returns a game-scoped token).
 * Games are registered on app startup (e.g. sugar-daddy, diver, chicken-road-two).
 */

import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const GAME_MODE = process.env.GAME_MODE || 'sugar-daddy';
const OPERATOR_ID = process.env.OPERATOR_ID || 'dev-operator';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

const url = new URL(BASE_URL);
const wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;

function main() {
  if (!AUTH_TOKEN) {
    console.error('Set AUTH_TOKEN (e.g. from POST /api/auth). Example:');
    console.error('  AUTH_TOKEN=your-jwt npm run socket:client');
    process.exit(1);
  }

  const socket = io(wsUrl, {
    path: '/io',
    query: {
      gameMode: GAME_MODE,
      operatorId: OPERATOR_ID,
      Authorization: AUTH_TOKEN,
    },
    transports: ['websocket'],
    reconnection: false,
  });

  socket.on('connect', () => {
    console.log('Connected to', wsUrl, 'gameMode=', GAME_MODE);
  });

  socket.on('connection-error', (data: { error?: string; code?: string }) => {
    console.error('Connection error:', data);
    process.exit(1);
  });

  socket.on('connect_error', (err: Error) => {
    console.error('Connect error:', err.message);
    process.exit(1);
  });

  socket.on('disconnect', (reason: string) => {
    console.log('Disconnected:', reason);
  });
}

main();
