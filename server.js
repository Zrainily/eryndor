// ============================================================
// ERYNDOR Intelligence Platform — Backend Server v5.0
// Node.js + Express + WebSocket + node-cron
// ============================================================
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const WebSocket= require('ws');
const cron     = require('node-cron');
const axios    = require('axios');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const PORT         = process.env.PORT        || 3001;
const FINNHUB_KEY  = process.env.FINNHUB_KEY;
const NEWSDATA_KEY = process.env.NEWSDATA_KEY;
const CORS_ORIGIN  = process.env.CORS_ORIGIN || '*';

// ── Middleware ────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-Memory Cache ───────────────────────────────────────
// All data lives here; refreshed by cron jobs
const CACHE = {
  markets:     { data: null, updatedAt: null },
  crypto:      { data: null, updatedAt: null },
  news:        { data: null, updatedAt: null },
  conflicts:   { data: null, updatedAt: null },
  commodities: { data: null, updatedAt: null },
  forex:       { data: null, updatedAt: null },
  stocks:      { data: null, updatedAt: null },
  econ:        { data: null, updatedAt: null },
  sentiment:   { data: null, updatedAt: null },
};

// ── WebSocket broadcast ───────────────────────────────────
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  // Send full snapshot on connect
  ws.send(JSON.stringify({ type: 'snapshot', payload: getAllCache(), ts: Date.now() }));
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

function getAllCache() {
  return {
    markets:     CACHE.markets.data,
    crypto:      CACHE.crypto.data,
    news:        CACHE.news.data,
    conflicts:   CACHE.conflicts.data,
    commodities: CACHE.commodities.data,
    forex:       CACHE.forex.data,
    stocks:      CACHE.stocks.data,
    econ:        CACHE.econ.data,
    sentiment:   CACHE.sentiment.data,
  };
}

// ════════════════════════════════════════════════════════════
// DATA FETCHERS
// ════════════════════════════════════════════════════════════

// ── 1. FINNHUB — Stock Indices ────────────────────────────
const INDEX_MAP = [
  { sym: 'S&P 500',    finnhub: '^GSPC'  },
  { sym: 'NASDAQ',     finnhub: '^IXIC'  },
  { sym: 'DOW JONES',  finnhub: '^DJI'   },
  { sym: 'NIFTY 50',   finnhub: '^NSEI'  },
  { sym: 'FTSE 100',   finnhub: '^FTSE'  },
  { sym: 'DAX',        finnhub: '^GDAXI' },
  { sym: 'NIKKEI 225', finnhub: '^N225'  },
  { sym: 'HANG SENG',  finnhub: '^HSI'   },
];

async function fetchFinnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  return data; // { c, d, dp, h, l, o, pc, t }
}

async function fetchMarkets() {
  console.log('[ERYNDOR] Fetching market indices from Finnhub...');
  const results = [];
  for (const entry of INDEX_MAP) {
    try {
      const q = await fetchFinnhubQuote(entry.finnhub);
      if (q && q.c > 0) {
        results.push({
          sym:   entry.sym,
          price: q.c,
          open:  q.o || q.pc,
          high:  q.h,
          low:   q.l,
          prev:  q.pc,
          chg:   q.d  || (q.c - q.pc),
          pct:   q.dp || ((q.c - q.pc) / q.pc * 100),
          ts:    q.t,
        });
      }
    } catch (e) {
      console.warn(`[ERYNDOR] Index ${entry.finnhub} failed:`, e.message);
    }
    await sleep(350); // stay under 60 req/min free tier
  }
  if (results.length > 0) {
    CACHE.markets = { data: results, updatedAt: Date.now() };
    broadcast('markets', results);
    console.log(`[ERYNDOR] Markets updated — ${results.length} indices`);
  }
}

// ── 2. FINNHUB — Company Stocks ──────────────────────────
const COMPANY_SYMBOLS = ['AAPL','TSLA','NVDA','AMZN','MSFT','META','GOOGL','JPM'];

async function fetchStocks() {
  console.log('[ERYNDOR] Fetching company stocks from Finnhub...');
  const results = [];
  for (const sym of COMPANY_SYMBOLS) {
    try {
      const q = await fetchFinnhubQuote(sym);
      if (q && q.c > 0) {
        results.push({ sym, price: q.c, chg: q.d||0, pct: q.dp||0, high: q.h, low: q.l, prev: q.pc });
      }
    } catch (e) {
      console.warn(`[ERYNDOR] Stock ${sym} failed:`, e.message);
    }
    await sleep(350);
  }
  if (results.length > 0) {
    CACHE.stocks = { data: results, updatedAt: Date.now() };
    broadcast('stocks', results);
    console.log(`[ERYNDOR] Stocks updated — ${results.length} companies`);
  }
}

// ── 3. FINNHUB — Forex ───────────────────────────────────
const FOREX_PAIRS = [
  { label: 'EUR/USD', symbol: 'OANDA:EUR_USD' },
  { label: 'GBP/USD', symbol: 'OANDA:GBP_USD' },
  { label: 'USD/JPY', symbol: 'OANDA:USD_JPY' },
  { label: 'USD/INR', symbol: 'OANDA:USD_INR' },
  { label: 'USD/CNY', symbol: 'OANDA:USD_CNY' },
  { label: 'AUD/USD', symbol: 'OANDA:AUD_USD' },
];

async function fetchForex() {
  console.log('[ERYNDOR] Fetching forex from Finnhub...');
  const results = [];
  for (const pair of FOREX_PAIRS) {
    try {
      const q = await fetchFinnhubQuote(pair.symbol);
      if (q && q.c > 0) {
        results.push({ label: pair.label, price: q.c, chg: q.d||0, pct: q.dp||0, prev: q.pc });
      }
    } catch (e) {
      console.warn(`[ERYNDOR] Forex ${pair.label} failed:`, e.message);
    }
    await sleep(350);
  }
  if (results.length > 0) {
    CACHE.forex = { data: results, updatedAt: Date.now() };
    broadcast('forex', results);
    console.log(`[ERYNDOR] Forex updated — ${results.length} pairs`);
  }
}

// ── 4. FINNHUB — Commodities ─────────────────────────────
const COMMODITIES = [
  { label: 'OIL (Brent)', symbol: 'OANDA:BCO_USD', prefix: '$', dec: 2 },
  { label: 'OIL (WTI)',   symbol: 'OANDA:WTICO_USD',prefix: '$', dec: 2 },
  { label: 'GOLD',        symbol: 'OANDA:XAU_USD',  prefix: '$', dec: 0 },
  { label: 'SILVER',      symbol: 'OANDA:XAG_USD',  prefix: '$', dec: 2 },
  { label: 'NAT GAS',     symbol: 'OANDA:NATGAS_USD',prefix:'$', dec: 3 },
];

async function fetchCommodities() {
  console.log('[ERYNDOR] Fetching commodities from Finnhub...');
  const results = [];
  for (const c of COMMODITIES) {
    try {
      const q = await fetchFinnhubQuote(c.symbol);
      if (q && q.c > 0) {
        results.push({ label: c.label, price: q.c, chg: q.d||0, pct: q.dp||0, prefix: c.prefix, dec: c.dec });
      }
    } catch (e) {
      console.warn(`[ERYNDOR] Commodity ${c.label} failed:`, e.message);
    }
    await sleep(350);
  }
  if (results.length > 0) {
    CACHE.commodities = { data: results, updatedAt: Date.now() };
    broadcast('commodities', results);
    console.log(`[ERYNDOR] Commodities updated — ${results.length}`);
  }
}

// ── 5. COINGECKO — Crypto ────────────────────────────────
const CRYPTO_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,avalanche-2,polkadot';

async function fetchCrypto() {
  console.log('[ERYNDOR] Fetching crypto from CoinGecko...');
  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${CRYPTO_IDS}&order=market_cap_desc&per_page=8&sparkline=true&price_change_percentage=1h,24h,7d`,
      { timeout: 10000, headers: { 'Accept': 'application/json' } }
    );
    const results = data.map(c => ({
      id:       c.id,
      sym:      c.symbol.toUpperCase(),
      name:     c.name,
      price:    c.current_price,
      chg1h:    c.price_change_percentage_1h_in_currency || 0,
      chg24h:   c.price_change_percentage_24h || 0,
      chg7d:    c.price_change_percentage_7d_in_currency || 0,
      cap:      c.market_cap,
      vol:      c.total_volume,
      high24h:  c.high_24h,
      low24h:   c.low_24h,
      rank:     c.market_cap_rank,
      sparkline: c.sparkline_in_7d?.price || [],
    }));
    CACHE.crypto = { data: results, updatedAt: Date.now() };
    broadcast('crypto', results);
    console.log(`[ERYNDOR] Crypto updated — ${results.length} assets`);
  } catch (e) {
    console.warn('[ERYNDOR] CoinGecko failed:', e.message);
  }
}

// ── 6. NEWSDATA.IO — Live News ────────────────────────────
function classifyCategory(text) {
  if (/war|attack|strike|missile|military|troops|conflict|bomb|kill|soldier|nato|offensive|ceasefire|weapon|frontline|artillery/i.test(text)) return 'WAR';
  if (/economy|inflation|gdp|fed|rate|market|stock|trade|tariff|recession|bank|finance|dollar|debt|fiscal|earnings/i.test(text)) return 'ECONOMY';
  if (/ai|tech|cyber|hack|quantum|semiconductor|robot|space|satellite|software|digital|chip|compute/i.test(text)) return 'TECH';
  if (/sanction|election|president|government|parliament|diplomat|summit|treaty|congress|senate|policy|minister/i.test(text)) return 'POLITICS';
  if (/earthquake|flood|hurricane|disaster|crisis|famine|drought|climate|pandemic|outbreak|tsunami/i.test(text)) return 'CRISIS';
  return 'WORLD';
}

function scoreSentiment(text) {
  const neg = (text.match(/war|attack|crisis|crash|fall|drop|decline|risk|threat|kill|conflict|bomb|sanction|recession|violence|escalat/gi)||[]).length;
  const pos = (text.match(/rally|growth|rise|gain|improve|peace|deal|agreement|recovery|strong|boost|surge|advance/gi)||[]).length;
  if (neg > pos + 1) return 'neg';
  if (pos > neg + 1) return 'pos';
  return 'neu';
}

async function fetchNews() {
  console.log('[ERYNDOR] Fetching news from NewsData.io...');
  const queries = [
    `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&language=en&size=10`,
    `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&language=en&q=war+military+conflict&size=8`,
    `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&language=en&category=business,politics&size=8`,
    `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&language=en&category=technology&size=5`,
  ];

  const collected = [];
  const seenTitles = new Set();

  for (const url of queries) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      if (data.status !== 'success' || !data.results) throw new Error(data.message || 'no results');
      data.results.forEach(art => {
        const title = (art.title || art.description || '').trim();
        if (!title || seenTitles.has(title)) return;
        seenTitles.add(title);
        const fullText = title + ' ' + (art.description || '');
        const ts = art.pubDate ? new Date(art.pubDate).getTime() : Date.now() - Math.random()*1800000;
        collected.push({
          cat:       classifyCategory(fullText),
          source:    (art.source_id || art.source_name || 'Newswire').substring(0,30),
          headline:  title.length > 120 ? title.substring(0,117) + '...' : title,
          description: (art.description||'').substring(0,200),
          url:       art.link || '',
          sentiment: scoreSentiment(fullText),
          country:   (art.country||[])[0] || '',
          rel:       60 + Math.floor(Math.random()*35),
          tsMs:      ts,
        });
      });
      await sleep(500); // be nice to the API
    } catch (e) {
      console.warn('[ERYNDOR] NewsData query failed:', e.message);
    }
  }

  if (collected.length > 0) {
    collected.sort((a,b) => b.tsMs - a.tsMs);
    const final = collected.slice(0, 20);
    CACHE.news = { data: final, updatedAt: Date.now() };
    broadcast('news', final);
    // Also update sentiment score
    updateSentimentFromNews(final);
    console.log(`[ERYNDOR] News updated — ${final.length} articles`);
  }
}

function updateSentimentFromNews(articles) {
  const pos = articles.filter(a=>a.sentiment==='pos').length;
  const neg = articles.filter(a=>a.sentiment==='neg').length;
  const neu = articles.filter(a=>a.sentiment==='neu').length;
  const total = articles.length || 1;
  const sentiment = {
    positive: Math.round(pos/total*100),
    negative: Math.round(neg/total*100),
    neutral:  Math.round(neu/total*100),
    score:    Math.round((pos-neg)/total*100),
  };
  CACHE.sentiment = { data: sentiment, updatedAt: Date.now() };
  broadcast('sentiment', sentiment);
}

// ── 7. GDELT — Conflict Events ───────────────────────────
const CONFLICT_BASE = [
  { name:'Russia-Ukraine', pos:{x:57,y:22}, type:'red',    risk:'CRITICAL', keywords:['ukraine','russia','kyiv','kherson','zaporizhzhia'] },
  { name:'Gaza / Israel',  pos:{x:57,y:34}, type:'red',    risk:'CRITICAL', keywords:['gaza','israel','hamas','tel aviv','west bank'] },
  { name:'Red Sea',        pos:{x:60,y:38}, type:'orange', risk:'HIGH',     keywords:['houthi','red sea','yemen','shipping'] },
  { name:'Myanmar',        pos:{x:78,y:38}, type:'orange', risk:'HIGH',     keywords:['myanmar','burma','junta'] },
  { name:'Sudan',          pos:{x:55,y:42}, type:'orange', risk:'HIGH',     keywords:['sudan','rsf','khartoum','darfur'] },
  { name:'Taiwan Strait',  pos:{x:82,y:32}, type:'yellow', risk:'MODERATE', keywords:['taiwan','strait','pla','china sea'] },
  { name:'S. China Sea',   pos:{x:80,y:39}, type:'yellow', risk:'MODERATE', keywords:['south china sea','spratly','philippines'] },
];

async function fetchConflicts() {
  console.log('[ERYNDOR] Fetching conflict data from GDELT...');
  try {
    const query = encodeURIComponent('war OR military attack OR conflict OR ceasefire OR troops OR airstrike');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=25&format=json&sort=DateDesc&timespan=24h&sourcelang=english`;
    const { data } = await axios.get(url, { timeout: 12000 });

    if (!data.articles?.length) throw new Error('no articles');

    // Count mentions per conflict zone
    const mentions = {};
    CONFLICT_BASE.forEach(c => { mentions[c.name] = 0; });

    const gdeltNews = [];
    const seenTitles = new Set();

    data.articles.forEach(art => {
      const title = (art.title||'').trim();
      const text  = (title + ' ' + (art.sourcecountry||'')).toLowerCase();
      if (!title || seenTitles.has(title)) return;
      seenTitles.add(title);

      // Count conflict zone mentions
      CONFLICT_BASE.forEach(c => {
        if (c.keywords.some(k => text.includes(k))) mentions[c.name]++;
      });

      const ts = art.seendate ? parseGDELTDate(art.seendate) : Date.now() - Math.random()*3600000;
      gdeltNews.push({
        cat:       'WAR',
        source:    art.domain || 'GDELT',
        headline:  title.length > 120 ? title.substring(0,117)+'...' : title,
        sentiment: scoreSentiment(title),
        rel:       65 + Math.floor(Math.random()*30),
        tsMs:      ts,
        url:       art.url || '',
        country:   art.sourcecountry || '',
      });
    });

    // Dynamically adjust conflict risk levels
    const conflicts = CONFLICT_BASE.map(c => {
      const m = mentions[c.name] || 0;
      let type = c.type;
      if (m >= 8 && type === 'yellow') type = 'orange';
      if (m >= 12 && type === 'orange') type = 'red';
      let risk = c.risk;
      if (m >= 15) risk = 'CRITICAL';
      else if (m >= 8) risk = 'HIGH';
      const latestNews = gdeltNews.filter(n => c.keywords.some(k => n.headline.toLowerCase().includes(k))).slice(0,1);
      return {
        ...c, type, risk,
        mentions: m,
        latestEvent: latestNews[0]?.headline || `${c.name}: ongoing monitoring`,
        level: type==='red'?'WAR':type==='orange'?'CONFLICT':'TENSION',
      };
    });

    CACHE.conflicts = { data: { conflicts, gdeltNews: gdeltNews.slice(0,10) }, updatedAt: Date.now() };
    broadcast('conflicts', CACHE.conflicts.data);
    console.log(`[ERYNDOR] Conflicts updated — ${gdeltNews.length} events, ${conflicts.length} zones`);
  } catch (e) {
    console.warn('[ERYNDOR] GDELT failed:', e.message);
    // Use base conflict data as fallback
    if (!CACHE.conflicts.data) {
      CACHE.conflicts = {
        data: { conflicts: CONFLICT_BASE.map(c=>({...c,level:c.type==='red'?'WAR':c.type==='orange'?'CONFLICT':'TENSION',mentions:0,latestEvent:'Monitoring active'})), gdeltNews: [] },
        updatedAt: Date.now()
      };
    }
  }
}

function parseGDELTDate(s) {
  try {
    return new Date(`${s.substring(0,4)}-${s.substring(4,6)}-${s.substring(6,8)}T${s.substring(8,10)}:${s.substring(10,12)}:${s.substring(12,14)}Z`).getTime();
  } catch(e) { return Date.now(); }
}

// ── 8. Macro Economic Snapshot ───────────────────────────
// These are slow-moving official stats — updated weekly
function buildEconSnapshot() {
  const econ = [
    { label:'US CPI',       val:'3.2%',   color:'#ff8800', type:'stat' },
    { label:'FED RATE',     val:'4.50%',  color:'#00c8ff', type:'stat' },
    { label:'US GDP',       val:'2.8%',   color:'#00ff88', type:'stat' },
    { label:'UNEMPLOYMENT', val:'4.1%',   color:'#00ff88', type:'stat' },
  ];
  // Merge with live commodities and forex
  const c = CACHE.commodities.data || [];
  const f = CACHE.forex.data || [];
  const oil   = c.find(x=>x.label.includes('WTI'));
  const gold  = c.find(x=>x.label==='GOLD');
  const eurusd= f.find(x=>x.label==='EUR/USD');
  if (oil)    econ.push({ label:'OIL (WTI)',  val:'$'+oil.price.toFixed(2),  chg: oil.pct, color:'#ffdd00', type:'live' });
  if (gold)   econ.push({ label:'GOLD',       val:'$'+Math.round(gold.price).toLocaleString(), chg:gold.pct, color:'#ffdd00', type:'live' });
  if (eurusd) econ.push({ label:'EUR/USD',    val:eurusd.price.toFixed(4),   chg:eurusd.pct, color:'#00c8ff', type:'live' });
  econ.push({ label:'VIX', val: (15 + Math.random()*8).toFixed(2), color:'#9945ff', type:'sim' });
  CACHE.econ = { data: econ, updatedAt: Date.now() };
  broadcast('econ', econ);
}

// ════════════════════════════════════════════════════════════
// CRON JOBS — Scheduled refreshes
// ════════════════════════════════════════════════════════════
async function initialFetch() {
  console.log('\n[ERYNDOR] ═══ INITIAL DATA FETCH ═══');
  await fetchCrypto();                    await sleep(1000);
  await fetchNews();                      await sleep(1000);
  await fetchConflicts();                 await sleep(1000);
  await fetchMarkets();                   await sleep(1000);
  await fetchStocks();                    await sleep(1000);
  await fetchForex();                     await sleep(1000);
  await fetchCommodities();               await sleep(500);
  buildEconSnapshot();
  console.log('[ERYNDOR] ═══ INITIAL FETCH COMPLETE ═══\n');
}

// Crypto: every 60 seconds
cron.schedule('* * * * *', async () => {
  await fetchCrypto();
  buildEconSnapshot();
});

// News: every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  await fetchNews();
});

// Markets + Stocks: every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  await fetchMarkets();
  await sleep(3000);
  await fetchStocks();
  buildEconSnapshot();
});

// Forex + Commodities: every 5 minutes (offset by 2.5min)
cron.schedule('2,7,12,17,22,27,32,37,42,47,52,57 * * * *', async () => {
  await fetchForex();
  await sleep(3000);
  await fetchCommodities();
  buildEconSnapshot();
});

// Conflicts (GDELT): every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await fetchConflicts();
});

// ════════════════════════════════════════════════════════════
// REST API ROUTES
// ════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    version: '5.0.0',
    platform: 'ERYNDOR Intelligence Platform',
    uptime: process.uptime(),
    cache: Object.fromEntries(
      Object.entries(CACHE).map(([k,v]) => [k, { hasData: !!v.data, updatedAt: v.updatedAt }])
    ),
    wsClients: wss.clients.size,
  });
});

app.get('/api/snapshot', (req, res) => {
  res.json({ ...getAllCache(), serverTs: Date.now() });
});

app.get('/api/markets',     (req, res) => res.json(CACHE.markets.data     || []));
app.get('/api/crypto',      (req, res) => res.json(CACHE.crypto.data      || []));
app.get('/api/news',        (req, res) => res.json(CACHE.news.data        || []));
app.get('/api/conflicts',   (req, res) => res.json(CACHE.conflicts.data   || {}));
app.get('/api/commodities', (req, res) => res.json(CACHE.commodities.data || []));
app.get('/api/forex',       (req, res) => res.json(CACHE.forex.data       || []));
app.get('/api/stocks',      (req, res) => res.json(CACHE.stocks.data      || []));
app.get('/api/econ',        (req, res) => res.json(CACHE.econ.data        || []));
app.get('/api/sentiment',   (req, res) => res.json(CACHE.sentiment.data   || {}));

// Manual refresh triggers (useful for testing)
app.post('/api/refresh/news',    async (req, res) => { await fetchNews();       res.json({ ok: true, count: CACHE.news.data?.length }); });
app.post('/api/refresh/markets', async (req, res) => { await fetchMarkets();    res.json({ ok: true, count: CACHE.markets.data?.length }); });
app.post('/api/refresh/crypto',  async (req, res) => { await fetchCrypto();     res.json({ ok: true, count: CACHE.crypto.data?.length }); });
app.post('/api/refresh/all',     async (req, res) => { initialFetch(); res.json({ ok: true, message: 'Full refresh triggered' }); });

// Serve dashboard if frontend in /public
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

server.listen(PORT, async () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║  ERYNDOR Intelligence Platform v5.0       ║`);
  console.log(`║  Server running on http://localhost:${PORT}  ║`);
  console.log(`║  WebSocket: ws://localhost:${PORT}           ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
  // Kick off initial data fetch
  await initialFetch();
});
