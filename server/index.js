require('dotenv').config();

const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { getUpcomingMatches, getMatchPlayers: getApiMatchPlayers } = require('./api');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

// --- DATA ---
const rooms = new Map(); // roomCode -> RoomState
const clients = new Map(); // ws -> { roomCode, playerIndex, name }

// --- HELPERS ---
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function getMatchName(matchId, customMatches = [], apiMatches = []) {
  if (matchId.startsWith('c')) {
    const m = customMatches[parseInt(matchId.slice(1))];
    return m ? `${m.home} vs ${m.away}` : 'Custom';
  }
  const m = apiMatches.find(x => x.id === matchId);
  return m ? `${m.home} vs ${m.away}` : matchId;
}

function getMatchPlayersForRoom(matchId, customMatches = []) {
  if (matchId.startsWith('c')) {
    const m = customMatches[parseInt(matchId.slice(1))];
    return m ? m.players : [];
  }
  return getApiMatchPlayers(matchId);
}

function buildDraftOrder(type, picks) {
  const order = [];
  for (let r = 0; r < picks; r++) {
    if (type === 'snake') {
      if (r % 2 === 0) { order.push(0); order.push(1); }
      else { order.push(1); order.push(0); }
    } else {
      order.push(r % 2 === 0 ? 0 : 1);
    }
  }
  return order;
}

function broadcast(roomCode, msg, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) {
      const info = clients.get(ws);
      if (info && info.roomCode === roomCode && ws !== excludeWs) {
        ws.send(data);
      }
    }
  });
}

function sendToClient(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getPublicState(room, apiMatches) {
  return {
    roomCode: room.roomCode,
    screen: room.screen,
    players: room.players,
    settings: room.settings,
    customMatches: room.customMatches,
    allPlayers: room.allPlayers,
    drafted: room.drafted,
    rosters: room.rosters,
    goals: room.goals,
    draftOrder: room.draftOrder,
    draftPos: room.draftPos,
    matches: apiMatches || [],
  };
}

// --- WS HANDLERS ---
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });
  ws.on('close', async () => {
    const info = clients.get(ws);
    if (info) {
      const room = rooms.get(info.roomCode);
      if (room) {
        room.players[info.playerIndex] = { name: room.players[info.playerIndex]?.name || '', online: false };
        const apiMatches = await getUpcomingMatches();
        broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
      }
      clients.delete(ws);
    }
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create_room': return handleCreateRoom(ws, msg);
    case 'join_room': return handleJoinRoom(ws, msg);
    case 'select_match': return handleSelectMatch(ws, msg);
    case 'add_custom_match': return handleAddCustomMatch(ws, msg);
    case 'start_game': return handleStartGame(ws, msg);
    case 'draft_pick': return handleDraftPick(ws, msg);
    case 'add_goal': return handleAddGoal(ws, msg);
    case 'add_assist': return handleAddAssist(ws, msg);
    case 'undo_goal': return handleUndoGoal(ws, msg);
    case 'ping': sendToClient(ws, { type: 'pong' }); break;
  }
}

async function handleCreateRoom(ws, msg) {
  const { name, bet, draftType, picks } = msg;
  if (!name) return sendToClient(ws, { type: 'error', text: 'Chybí přezdívka' });
  const code = generateRoomCode();
  const room = {
    roomCode: code,
    screen: 'lobby',
    players: [{ name, online: true }, null],
    settings: { bet: bet || 100, assistBet: msg.assistBet || 50, draftType: draftType || 'manual', picks: picks || 8, selectedMatches: [] },
    customMatches: [],
    allPlayers: [],
    drafted: [],
    rosters: [[], []],
    goals: [],
    draftOrder: [],
    draftPos: 0,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  clients.set(ws, { roomCode: code, playerIndex: 0, name });
  const apiMatches = await getUpcomingMatches();
  sendToClient(ws, { type: 'joined', playerIndex: 0, roomCode: code, state: getPublicState(room, apiMatches), matches: apiMatches });
}

async function handleJoinRoom(ws, msg) {
  const { name, code } = msg;
  const room = rooms.get(code?.toUpperCase());
  if (!room) return sendToClient(ws, { type: 'error', text: 'Místnost nenalezena' });
  if (room.players[1] && room.players[1].online) return sendToClient(ws, { type: 'error', text: 'Místnost je plná' });
  room.players[1] = { name, online: true };
  clients.set(ws, { roomCode: code.toUpperCase(), playerIndex: 1, name });
  const apiMatches = await getUpcomingMatches();
  sendToClient(ws, { type: 'joined', playerIndex: 1, roomCode: code.toUpperCase(), state: getPublicState(room, apiMatches), matches: apiMatches });
  broadcast(code.toUpperCase(), { type: 'state', state: getPublicState(room, apiMatches) }, ws);
}

async function handleSelectMatch(ws, msg) {
  const info = clients.get(ws);
  if (!info || info.playerIndex !== 0) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'lobby') return;
  const { matchId, selected } = msg;
  const sel = room.settings.selectedMatches;
  if (selected) {
    if (sel.length >= 4) return sendToClient(ws, { type: 'error', text: 'Max 4 zápasy' });
    if (!sel.includes(matchId)) sel.push(matchId);
  } else {
    const i = sel.indexOf(matchId);
    if (i > -1) sel.splice(i, 1);
  }
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleAddCustomMatch(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'lobby') return;
  const { home, away } = msg;
  if (!home || !away) return sendToClient(ws, { type: 'error', text: 'Chybí název týmů' });
  const idx = room.customMatches.length;
  const matchId = 'c' + idx;
  const players = [
    ...['Útočník 1', 'Útočník 2', 'Záložník 1', 'Záložník 2'].map(n => ({ n, t: home, matchId })),
    ...['Útočník 1', 'Útočník 2', 'Záložník 1', 'Záložník 2'].map(n => ({ n, t: away, matchId })),
  ];
  room.customMatches.push({ id: matchId, home, away, players });
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleStartGame(ws, msg) {
  const info = clients.get(ws);
  if (!info || info.playerIndex !== 0) return sendToClient(ws, { type: 'error', text: 'Jen hostitel může spustit hru' });
  const room = rooms.get(info.roomCode);
  if (!room) return;
  if (!room.players[1]) return sendToClient(ws, { type: 'error', text: 'Čeká se na druhého hráče' });
  if (!room.settings.selectedMatches.length) return sendToClient(ws, { type: 'error', text: 'Vyber alespoň 1 zápas' });

  const allPlayers = [];
  room.settings.selectedMatches.forEach(mid => {
    getMatchPlayersForRoom(mid, room.customMatches).forEach(p => allPlayers.push({ ...p, matchId: mid }));
  });
  room.allPlayers = allPlayers;
  room.drafted = new Array(allPlayers.length).fill(false);
  room.rosters = [[], []];
  room.goals = [];
  room.draftOrder = buildDraftOrder(room.settings.draftType, room.settings.picks);
  room.draftPos = 0;
  room.screen = 'draft';

  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleDraftPick(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'draft') return;
  const expectedTurn = room.draftOrder[room.draftPos];
  if (expectedTurn !== info.playerIndex) return sendToClient(ws, { type: 'error', text: 'Nejsi na tahu!' });
  const { playerIdx } = msg;
  if (room.drafted[playerIdx]) return sendToClient(ws, { type: 'error', text: 'Hráč již byl draftován' });
  room.drafted[playerIdx] = true;
  room.rosters[info.playerIndex].push({ ...room.allPlayers[playerIdx], goals: 0 });
  room.draftPos++;
  const picks = room.settings.picks;
  if (room.rosters[0].length >= picks && room.rosters[1].length >= picks) {
    room.screen = 'game';
  }
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleAddGoal(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'game') return;
  const { owner, playerName } = msg;
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  room.goals.push({ owner, playerName, time, id: uuidv4(), eventType: 'goal' });
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleAddAssist(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'game') return;
  const { owner, playerName } = msg;
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  room.goals.push({ owner, playerName, time, id: uuidv4(), eventType: 'assist' });
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

async function handleUndoGoal(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || !room.goals.length) return;
  room.goals.pop();
  const apiMatches = await getUpcomingMatches();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room, apiMatches) });
  sendToClient(ws, { type: 'state', state: getPublicState(room, apiMatches) });
}

// --- CLEANUP old rooms every hour ---
setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  rooms.forEach((room, code) => {
    if (room.createdAt < cutoff) rooms.delete(code);
  });
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`GoalBet running on port ${PORT}`));
