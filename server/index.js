const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

// --- DATA ---
const rooms = new Map(); // roomCode -> RoomState
const clients = new Map(); // ws -> { roomCode, playerIndex, name }

const UCL_MATCHES = [
  { id: 'm1', home: 'Real Madrid', away: 'Manchester City', league: 'Champions League' },
  { id: 'm2', home: 'Bayern München', away: 'Arsenal', league: 'Champions League' },
  { id: 'm3', home: 'Barcelona', away: 'PSG', league: 'Champions League' },
  { id: 'm4', home: 'Inter Milan', away: 'Atlético Madrid', league: 'Champions League' },
  { id: 'm5', home: 'Borussia Dortmund', away: 'Porto', league: 'Champions League' },
  { id: 'm6', home: 'Juventus', away: 'Benfica', league: 'Champions League' },
  { id: 'm7', home: 'Liverpool', away: 'Man City', league: 'Premier League' },
  { id: 'm8', home: 'Arsenal', away: 'Chelsea', league: 'Premier League' },
  { id: 'm9', home: 'Man United', away: 'Tottenham', league: 'Premier League' },
  { id: 'm10', home: 'Newcastle', away: 'Aston Villa', league: 'Premier League' },
  { id: 'm11', home: 'Real Madrid', away: 'Barcelona', league: 'La Liga' },
  { id: 'm12', home: 'Atletico Madrid', away: 'Sevilla', league: 'La Liga' },
  { id: 'm13', home: 'Bayern München', away: 'Borussia Dortmund', league: 'Bundesliga' },
  { id: 'm14', home: 'Bayer Leverkusen', away: 'RB Leipzig', league: 'Bundesliga' },
];

const PLAYERS_BY_MATCH = {
  m1: [
    { n: 'Vinícius Jr.', t: 'Real Madrid' }, { n: 'Kylian Mbappé', t: 'Real Madrid' },
    { n: 'Jude Bellingham', t: 'Real Madrid' }, { n: 'Rodrygo', t: 'Real Madrid' },
    { n: 'Erling Haaland', t: 'Manchester City' }, { n: 'Kevin De Bruyne', t: 'Manchester City' },
    { n: 'Phil Foden', t: 'Manchester City' }, { n: 'Julian Álvarez', t: 'Manchester City' },
  ],
  m2: [
    { n: 'Harry Kane', t: 'Bayern München' }, { n: 'Leroy Sané', t: 'Bayern München' },
    { n: 'Jamal Musiala', t: 'Bayern München' }, { n: 'Thomas Müller', t: 'Bayern München' },
    { n: 'Bukayo Saka', t: 'Arsenal' }, { n: 'Gabriel Martinelli', t: 'Arsenal' },
    { n: 'Martin Ødegaard', t: 'Arsenal' }, { n: 'Gabriel Jesus', t: 'Arsenal' },
  ],
  m3: [
    { n: 'Robert Lewandowski', t: 'Barcelona' }, { n: 'Lamine Yamal', t: 'Barcelona' },
    { n: 'Raphinha', t: 'Barcelona' }, { n: 'Gavi', t: 'Barcelona' },
    { n: 'Ousmane Dembélé', t: 'PSG' }, { n: 'Bradley Barcola', t: 'PSG' },
    { n: 'Randal Kolo Muani', t: 'PSG' }, { n: 'Vitinha', t: 'PSG' },
  ],
  m4: [
    { n: 'Lautaro Martínez', t: 'Inter Milan' }, { n: 'Marcus Thuram', t: 'Inter Milan' },
    { n: 'Nicola Barella', t: 'Inter Milan' }, { n: 'Mehdi Taremi', t: 'Inter Milan' },
    { n: 'Antoine Griezmann', t: 'Atlético Madrid' }, { n: 'Álvaro Morata', t: 'Atlético Madrid' },
    { n: 'Samuel Lino', t: 'Atlético Madrid' }, { n: 'Angel Correa', t: 'Atlético Madrid' },
  ],
  m5: [
    { n: 'Niclas Füllkrug', t: 'Borussia Dortmund' }, { n: 'Karim Adeyemi', t: 'Borussia Dortmund' },
    { n: 'Julian Brandt', t: 'Borussia Dortmund' }, { n: 'Sébastien Haller', t: 'Borussia Dortmund' },
    { n: 'Galeno', t: 'Porto' }, { n: 'Evanilson', t: 'Porto' },
    { n: 'Pepê', t: 'Porto' }, { n: 'Mehdi Taremi', t: 'Porto' },
  ],
  m6: [
    { n: 'Dusan Vlahovic', t: 'Juventus' }, { n: 'Federico Chiesa', t: 'Juventus' },
    { n: 'Arkadiusz Milik', t: 'Juventus' }, { n: 'Kenan Yildiz', t: 'Juventus' },
    { n: 'Arthur Cabral', t: 'Benfica' }, { n: 'Rafa Silva', t: 'Benfica' },
    { n: 'Ángel Di María', t: 'Benfica' }, { n: 'Petar Musa', t: 'Benfica' },
  ],
  m7: [
    { n: 'Mohamed Salah', t: 'Liverpool' }, { n: 'Darwin Núñez', t: 'Liverpool' },
    { n: 'Diogo Jota', t: 'Liverpool' }, { n: 'Luis Díaz', t: 'Liverpool' },
    { n: 'Erling Haaland', t: 'Man City' }, { n: 'Phil Foden', t: 'Man City' },
    { n: 'Kevin De Bruyne', t: 'Man City' }, { n: 'Julian Álvarez', t: 'Man City' },
  ],
  m8: [
    { n: 'Bukayo Saka', t: 'Arsenal' }, { n: 'Gabriel Martinelli', t: 'Arsenal' },
    { n: 'Martin Ødegaard', t: 'Arsenal' }, { n: 'Gabriel Jesus', t: 'Arsenal' },
    { n: 'Cole Palmer', t: 'Chelsea' }, { n: 'Nicolas Jackson', t: 'Chelsea' },
    { n: 'Raheem Sterling', t: 'Chelsea' }, { n: 'Christopher Nkunku', t: 'Chelsea' },
  ],
  m9: [
    { n: 'Marcus Rashford', t: 'Man United' }, { n: 'Rasmus Højlund', t: 'Man United' },
    { n: 'Bruno Fernandes', t: 'Man United' }, { n: 'Antony', t: 'Man United' },
    { n: 'Son Heung-min', t: 'Tottenham' }, { n: 'Richarlison', t: 'Tottenham' },
    { n: 'Brennan Johnson', t: 'Tottenham' }, { n: 'Dejan Kulusevski', t: 'Tottenham' },
  ],
  m10: [
    { n: 'Alexander Isak', t: 'Newcastle' }, { n: 'Anthony Gordon', t: 'Newcastle' },
    { n: 'Callum Wilson', t: 'Newcastle' }, { n: 'Jacob Murphy', t: 'Newcastle' },
    { n: 'Ollie Watkins', t: 'Aston Villa' }, { n: 'Leon Bailey', t: 'Aston Villa' },
    { n: 'Moussa Diaby', t: 'Aston Villa' }, { n: 'John McGinn', t: 'Aston Villa' },
  ],
  m11: [
    { n: 'Vinícius Jr.', t: 'Real Madrid' }, { n: 'Kylian Mbappé', t: 'Real Madrid' },
    { n: 'Jude Bellingham', t: 'Real Madrid' }, { n: 'Rodrygo', t: 'Real Madrid' },
    { n: 'Robert Lewandowski', t: 'Barcelona' }, { n: 'Lamine Yamal', t: 'Barcelona' },
    { n: 'Raphinha', t: 'Barcelona' }, { n: 'Ferran Torres', t: 'Barcelona' },
  ],
  m12: [
    { n: 'Antoine Griezmann', t: 'Atletico Madrid' }, { n: 'Álvaro Morata', t: 'Atletico Madrid' },
    { n: 'Angel Correa', t: 'Atletico Madrid' }, { n: 'Samuel Lino', t: 'Atletico Madrid' },
    { n: 'Youssef En-Nesyri', t: 'Sevilla' }, { n: 'Rafa Mir', t: 'Sevilla' },
    { n: 'Bryan Gil', t: 'Sevilla' }, { n: 'Lucas Ocampos', t: 'Sevilla' },
  ],
  m13: [
    { n: 'Harry Kane', t: 'Bayern München' }, { n: 'Leroy Sané', t: 'Bayern München' },
    { n: 'Jamal Musiala', t: 'Bayern München' }, { n: 'Serge Gnabry', t: 'Bayern München' },
    { n: 'Niclas Füllkrug', t: 'Borussia Dortmund' }, { n: 'Karim Adeyemi', t: 'Borussia Dortmund' },
    { n: 'Julian Brandt', t: 'Borussia Dortmund' }, { n: 'Marco Reus', t: 'Borussia Dortmund' },
  ],
  m14: [
    { n: 'Florian Wirtz', t: 'Bayer Leverkusen' }, { n: 'Granit Xhaka', t: 'Bayer Leverkusen' },
    { n: 'Patrik Schick', t: 'Bayer Leverkusen' }, { n: 'Jonas Hofmann', t: 'Bayer Leverkusen' },
    { n: 'Lois Openda', t: 'RB Leipzig' }, { n: 'Dani Olmo', t: 'RB Leipzig' },
    { n: 'Xavi Simons', t: 'RB Leipzig' }, { n: 'Benjamin Sesko', t: 'RB Leipzig' },
  ],
};

// --- HELPERS ---
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function getMatchName(matchId, customMatches = []) {
  if (matchId.startsWith('c')) {
    const m = customMatches[parseInt(matchId.slice(1))];
    return m ? `${m.home} vs ${m.away}` : 'Custom';
  }
  const m = UCL_MATCHES.find(x => x.id === matchId);
  return m ? `${m.home} vs ${m.away}` : matchId;
}

function getMatchPlayers(matchId, customMatches = []) {
  if (matchId.startsWith('c')) {
    const m = customMatches[parseInt(matchId.slice(1))];
    return m ? m.players : [];
  }
  return (PLAYERS_BY_MATCH[matchId] || []).map(p => ({ ...p, matchId }));
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

function getPublicState(room) {
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
    matches: UCL_MATCHES,
    playersDb: PLAYERS_BY_MATCH,
  };
}

// --- WS HANDLERS ---
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });
  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      const room = rooms.get(info.roomCode);
      if (room) {
        room.players[info.playerIndex] = { name: room.players[info.playerIndex]?.name || '', online: false };
        broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
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
    case 'undo_goal': return handleUndoGoal(ws, msg);
    case 'ping': sendToClient(ws, { type: 'pong' }); break;
  }
}

function handleCreateRoom(ws, msg) {
  const { name, bet, draftType, picks } = msg;
  if (!name) return sendToClient(ws, { type: 'error', text: 'Chybí přezdívka' });
  const code = generateRoomCode();
  const room = {
    roomCode: code,
    screen: 'lobby',
    players: [{ name, online: true }, null],
    settings: { bet: bet || 100, draftType: draftType || 'manual', picks: picks || 8, selectedMatches: [] },
    customMatches: [],
    allPlayers: [],
    drafted: [],
    rosters: [[], []],
    goals: [],
    draftOrder: [],
    draftPos: 0,
  };
  rooms.set(code, room);
  clients.set(ws, { roomCode: code, playerIndex: 0, name });
  sendToClient(ws, { type: 'joined', playerIndex: 0, roomCode: code, state: getPublicState(room), matches: UCL_MATCHES });
}

function handleJoinRoom(ws, msg) {
  const { name, code } = msg;
  const room = rooms.get(code?.toUpperCase());
  if (!room) return sendToClient(ws, { type: 'error', text: 'Místnost nenalezena' });
  if (room.players[1] && room.players[1].online) return sendToClient(ws, { type: 'error', text: 'Místnost je plná' });
  room.players[1] = { name, online: true };
  clients.set(ws, { roomCode: code.toUpperCase(), playerIndex: 1, name });
  sendToClient(ws, { type: 'joined', playerIndex: 1, roomCode: code.toUpperCase(), state: getPublicState(room), matches: UCL_MATCHES });
  broadcast(code.toUpperCase(), { type: 'state', state: getPublicState(room) }, ws);
}

function handleSelectMatch(ws, msg) {
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
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
}

function handleAddCustomMatch(ws, msg) {
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
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
}

function handleStartGame(ws, msg) {
  const info = clients.get(ws);
  if (!info || info.playerIndex !== 0) return sendToClient(ws, { type: 'error', text: 'Jen hostitel může spustit hru' });
  const room = rooms.get(info.roomCode);
  if (!room) return;
  if (!room.players[1]) return sendToClient(ws, { type: 'error', text: 'Čeká se na druhého hráče' });
  if (!room.settings.selectedMatches.length) return sendToClient(ws, { type: 'error', text: 'Vyber alespoň 1 zápas' });

  const allPlayers = [];
  room.settings.selectedMatches.forEach(mid => {
    getMatchPlayers(mid, room.customMatches).forEach(p => allPlayers.push({ ...p, matchId: mid }));
  });
  room.allPlayers = allPlayers;
  room.drafted = new Array(allPlayers.length).fill(false);
  room.rosters = [[], []];
  room.goals = [];
  room.draftOrder = buildDraftOrder(room.settings.draftType, room.settings.picks);
  room.draftPos = 0;
  room.screen = 'draft';

  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
}

function handleDraftPick(ws, msg) {
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
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
}

function handleAddGoal(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || room.screen !== 'game') return;
  const { owner, playerName } = msg;
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  room.goals.push({ owner, playerName, time, id: uuidv4() });
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
}

function handleUndoGoal(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room || !room.goals.length) return;
  room.goals.pop();
  broadcast(info.roomCode, { type: 'state', state: getPublicState(room) });
  sendToClient(ws, { type: 'state', state: getPublicState(room) });
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
