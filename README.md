# GoalBet 🏆

Fotbalová draft sázková hra pro 2 hráče. Real-time přes WebSocket.

## Funkce
- Room kód — jeden vytvoří, druhý se připojí
- Manuální draft (střídavý výběr) nebo Snake draft (1-2-2-1)
- 14 zápasů: Champions League, Premier League, La Liga, Bundesliga
- Vlastní zápasy (ruční zadání)
- Real-time synchronizace přes WebSocket
- Gól logging s undo
- Automatický výpočet dluhu

## Lokální spuštění

```bash
npm install
npm start
# → http://localhost:3000
```

Pro vývoj s auto-restartem:
```bash
npm run dev
```

## Deploy na Railway

1. Vytvoř účet na [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Nahraj tento projekt na GitHub
4. Railway automaticky detekuje Node.js a nasadí
5. Dostaneš URL jako `goalbet-production.up.railway.app`

### Nebo přes Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Struktura
```
goalbet/
├── server/
│   └── index.js      # Express + WebSocket server
├── client/
│   └── index.html    # Frontend (single file)
├── package.json
└── railway.toml
```
