const https = require('https');

const API_BASE = 'https://api.football-data.org/v4';
const API_KEY = process.env.FOOTBALL_DATA_API_KEY || 'c34f6ccc805c4307b019547b648f9072';

// Cache
let cachedMatches = [];
let cachedSquads = {}; // teamId -> { teamName, players[] }
let lastFetchTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function apiRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'X-Auth-Token': API_KEY,
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchTeamSquad(teamId) {
  if (cachedSquads[teamId]) return cachedSquads[teamId];

  try {
    // Rate limit: wait a bit between calls
    await new Promise(r => setTimeout(r, 6500)); // ~9 req/min to stay under 10/min
    const data = await apiRequest(`/teams/${teamId}`);
    const squad = (data.squad || [])
      .filter(p => p.name)
      .map(p => ({ name: p.name, position: p.position || 'N/A' }));

    const result = { teamName: data.name || `Team ${teamId}`, players: squad };
    cachedSquads[teamId] = result;
    return result;
  } catch (err) {
    console.error(`Failed to fetch squad for team ${teamId}:`, err.message);
    return { teamName: `Team ${teamId}`, players: [] };
  }
}

async function fetchAllData() {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_TTL && cachedMatches.length > 0) {
    console.log('[API] Using cached data');
    return;
  }

  console.log('[API] Fetching matches from Football-Data.org...');

  try {
    const today = new Date();
    const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dateFrom = formatDate(today);
    const dateTo = formatDate(weekLater);

    const data = await apiRequest(`/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    const matches = (data.matches || [])
      .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
      .map(m => ({
        id: 'api_' + m.id,
        apiId: m.id,
        home: m.homeTeam.name,
        away: m.awayTeam.name,
        league: m.competition.name,
        date: m.utcDate,
        homeTeamId: m.homeTeam.id,
        awayTeamId: m.awayTeam.id,
      }));

    cachedMatches = matches;
    lastFetchTime = now;
    console.log(`[API] Found ${matches.length} upcoming matches`);

    // Fetch squads for all unique teams (with rate limiting)
    const teamIds = new Set();
    matches.forEach(m => {
      teamIds.add(m.homeTeamId);
      teamIds.add(m.awayTeamId);
    });

    // Filter out already cached teams
    const toFetch = [...teamIds].filter(id => !cachedSquads[id]);
    console.log(`[API] Need to fetch ${toFetch.length} team squads (${Object.keys(cachedSquads).length} already cached)`);

    for (const teamId of toFetch) {
      await fetchTeamSquad(teamId);
    }

    console.log('[API] All data fetched and cached');
  } catch (err) {
    console.error('[API] Failed to fetch matches:', err.message);
    // Keep old cached data if available
  }
}

async function getUpcomingMatches() {
  await fetchAllData();
  return cachedMatches;
}

function getMatchPlayers(matchId) {
  const match = cachedMatches.find(m => m.id === matchId);
  if (!match) return [];

  const homePlayers = cachedSquads[match.homeTeamId];
  const awayPlayers = cachedSquads[match.awayTeamId];

  const players = [];
  if (homePlayers) {
    homePlayers.players.forEach(p => {
      players.push({ n: p.name, t: match.home, matchId, position: p.position });
    });
  }
  if (awayPlayers) {
    awayPlayers.players.forEach(p => {
      players.push({ n: p.name, t: match.away, matchId, position: p.position });
    });
  }

  return players;
}

// Start initial fetch in background
fetchAllData().catch(err => console.error('[API] Initial fetch error:', err.message));

module.exports = { getUpcomingMatches, getMatchPlayers };
