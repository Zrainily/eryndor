# ERYNDOR Intelligence Platform v5.0
### Global Decision Intelligence Dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  ERYNDOR Backend                     │
│                 (Node.js server)                     │
│                                                      │
│  Cron Jobs → Fetch APIs → Cache → WebSocket/REST    │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐  │
│  │Finnhub   │ │NewsData  │ │CoinGecko │ │ GDELT │  │
│  │Stocks    │ │Live News │ │Crypto    │ │Conflict│  │
│  │Forex     │ │          │ │          │ │Events  │  │
│  │Commodit. │ │          │ │          │ │        │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────┘  │
└────────────────────┬────────────────────────────────┘
                     │ WebSocket (ws://localhost:3001)
                     │ REST API  (http://localhost:3001)
┌────────────────────▼────────────────────────────────┐
│              ERYNDOR Frontend                        │
│           (intelligence-dashboard.html)              │
│                                                      │
│  • Connects via WebSocket for real-time push         │
│  • Falls back to direct API calls if no backend      │
│  • GBM simulation between real data fetches          │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start (Local)

### 1. Install dependencies
```bash
cd eryndor-server
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Keys are already filled in .env
```

### 3. Start the backend
```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 4. Open the dashboard
```
Open intelligence-dashboard.html in your browser
OR visit http://localhost:3001 (serves the frontend too)
```

The dashboard will show `🟢 BACKEND LIVE` in the top bar when connected.

---

## Data Refresh Schedule

| Source       | Data                        | Refresh     |
|--------------|-----------------------------|-------------|
| CoinGecko    | Crypto prices + sparklines  | Every 60s   |
| NewsData.io  | World news headlines        | Every 10min |
| Finnhub      | Stock indices               | Every 5min  |
| Finnhub      | Company stocks (AAPL etc)   | Every 5min  |
| Finnhub      | Forex pairs                 | Every 5min  |
| Finnhub      | Commodities (Oil, Gold)     | Every 5min  |
| GDELT        | Conflict/war events         | Every 15min |

---

## API Endpoints

| Endpoint              | Description                        |
|-----------------------|------------------------------------|
| `GET /api/health`     | Server status + cache info         |
| `GET /api/snapshot`   | Full data snapshot (all sources)   |
| `GET /api/markets`    | Stock indices                      |
| `GET /api/crypto`     | Crypto prices                      |
| `GET /api/news`       | Latest news articles               |
| `GET /api/conflicts`  | Conflict zones + GDELT events      |
| `GET /api/commodities`| Oil, Gold, Silver, Gas             |
| `GET /api/forex`      | Currency pairs                     |
| `GET /api/stocks`     | Company stocks                     |
| `GET /api/econ`       | Macro indicators                   |
| `GET /api/sentiment`  | News sentiment scores              |
| `POST /api/refresh/all`| Trigger immediate full refresh    |
| `WS  ws://host:3001`  | Real-time push stream              |

---

## Deploy to Railway (Free Hosting)

1. Go to https://railway.app and create a free account
2. Click **New Project → Deploy from GitHub**
3. Push the `eryndor-server` folder to a GitHub repo
4. Railway auto-detects Node.js and deploys
5. Set environment variables in Railway dashboard:
   - `FINNHUB_KEY`
   - `NEWSDATA_KEY`
   - `CORS_ORIGIN` → your frontend URL
6. Update `BACKEND_URL` and `WS_URL` in the HTML file to your Railway URL

## Deploy to Render (Free Hosting)

1. Go to https://render.com
2. New → Web Service → connect your repo
3. Build Command: `npm install`
4. Start Command: `node src/server.js`
5. Add environment variables
6. Done — free tier available

---

## WebSocket Message Types

The backend pushes these message types to connected clients:

```json
{ "type": "snapshot", "payload": { ...all data... }, "ts": 1234567890 }
{ "type": "markets",     "payload": [...] }
{ "type": "crypto",      "payload": [...] }
{ "type": "news",        "payload": [...] }
{ "type": "conflicts",   "payload": { conflicts: [...], gdeltNews: [...] } }
{ "type": "commodities", "payload": [...] }
{ "type": "forex",       "payload": [...] }
{ "type": "stocks",      "payload": [...] }
{ "type": "econ",        "payload": [...] }
{ "type": "sentiment",   "payload": { positive, negative, neutral, score } }
```

---

## API Keys

| Service      | Key                                        | Plan  |
|--------------|--------------------------------------------|-------|
| Finnhub      | `d6pspm1r01qk0cf1q1c0d6pspm1r01qk0cf1q1cg`| Free  |
| NewsData.io  | `pub_194ef19773c8449580735adf9282ab70`     | Free  |
| CoinGecko    | No key required                            | Free  |
| GDELT        | No key required                            | Free  |

---

ERYNDOR Intelligence Platform v5.0 — Classification: UNCLASSIFIED
