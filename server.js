
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');

const guns = [
  { id: 'starter', name: 'Starter Rifle', price: 0, damage: 20, rate: 380 },
  { id: 'ak47', name: 'AK-47', price: 500, damage: 28, rate: 300 },
  { id: 'm416', name: 'M416', price: 800, damage: 24, rate: 230 },
  { id: 'shotgun', name: 'Shotgun', price: 1000, damage: 45, rate: 700 },
  { id: 'scar', name: 'SCAR-L', price: 1300, damage: 27, rate: 270 },
  { id: 'sniper', name: 'Sniper Rifle', price: 1600, damage: 85, rate: 1100 }
];

function readDB() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!d.accounts) d.accounts = {};
    if (!Array.isArray(d.feedback)) d.feedback = [];
    return d;
  } catch {
    return { accounts: {}, feedback: [] };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function safeUser(a) {
  const { passwordHash, salt, ...safe } = a;
  return safe;
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function makeToken(gameId) {
  return 'local-' + gameId;
}

function authUser(req, db) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token.startsWith('local-')) return null;
  const id = token.slice(6);
  return db.accounts[id] || null;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;

  if (route.startsWith('/api/')) {
    try {
      const db = readDB();
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readBody(req) : {};

      if (route === '/api/register' && req.method === 'POST') {
        const username = String(body.username || '').trim();
        const displayName = String(body.displayName || username).trim().slice(0, 20);
        const password = String(body.password || '');

        if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
          return json(res, 400, { error: 'Username must be 3–16 letters, numbers or _' });

        if (password.length < 8)
          return json(res, 400, { error: 'Password must be at least 8 characters' });

        if (Object.values(db.accounts).some(a =>
          a.username.toLowerCase() === username.toLowerCase()))
          return json(res, 409, { error: 'Username already exists' });

        let gameId;
        do {
          gameId = String(10000 + crypto.randomInt(0, 90000));
        } while (db.accounts[gameId]);

        const salt = crypto.randomBytes(16).toString('hex');

        const a = {
          gameId,
          username,
          displayName: displayName || username,
          salt,
          passwordHash: hashPassword(password, salt),
          avatar: '',
          kills: 0,
          deaths: 0,
          tokens: 0,
          equipped: 'starter',
          inventory: ['starter'],
          createdAt: new Date().toISOString()
        };

        db.accounts[gameId] = a;
        writeDB(db);

        return json(res, 201, {
          token: makeToken(gameId),
          user: safeUser(a)
        });
      }

      if (route === '/api/login' && req.method === 'POST') {
        const value = String(body.gameId || body.username || '').trim();

        const a = db.accounts[value] ||
          Object.values(db.accounts).find(x =>
            x.username.toLowerCase() === value.toLowerCase());

        if (!a || hashPassword(String(body.password || ''), a.salt) !== a.passwordHash)
          return json(res, 401, {
            error: 'Incorrect Game ID/username or password'
          });

        return json(res, 200, {
          token: makeToken(a.gameId),
          user: safeUser(a)
        });
      }

      if (route === '/api/guns' && req.method === 'GET')
        return json(res, 200, { guns });

      if (route === '/api/logout' && req.method === 'POST')
        return json(res, 200, { ok: true });

      const a = authUser(req, db);

      if (route === '/api/feedback' && req.method === 'GET') {
        if (!a) return json(res, 401, { error: 'Please login' });
        return json(res, 200, {
          messages: (db.feedback || []).slice(-100).reverse()
        });
      }

      if (route === '/api/feedback' && req.method === 'POST') {
        if (!a) return json(res, 401, { error: 'Please login' });

        const text = String(body.text || '').trim();
        if (!text || text.length > 500)
          return json(res, 400, { error: 'Message must be 1–500 characters' });

        const m = {
          id: crypto.randomUUID(),
          gameId: a.gameId,
          displayName: a.displayName,
          text,
          createdAt: new Date().toISOString()
        };

        db.feedback = db.feedback || [];
        db.feedback.push(m);
        db.feedback = db.feedback.slice(-500);
        writeDB(db);

        return json(res, 201, { message: m });
      }

      if (!a) return json(res, 401, { error: 'Please login again' });

      if (route === '/api/me' && req.method === 'GET')
        return json(res, 200, { user: safeUser(a) });

      if (route === '/api/profile' && req.method === 'POST') {
        a.displayName = String(body.displayName || a.displayName).slice(0, 20);
        a.avatar = String(body.avatar || a.avatar || '').slice(0, 12);
        writeDB(db);
        return json(res, 200, { user: safeUser(a) });
      }

      if (route === '/api/buy' && req.method === 'POST') {
        const g = guns.find(x => x.id === body.gunId);
        if (!g) return json(res, 404, { error: 'Gun not found' });
        if (a.inventory.includes(g.id))
          return json(res, 400, { error: 'Already owned' });
        if (a.tokens < g.price)
          return json(res, 400, { error: 'Not enough Eagle Tokens' });

        a.tokens -= g.price;
        a.inventory.push(g.id);
        writeDB(db);
        return json(res, 200, { user: safeUser(a) });
      }

      if (route === '/api/equip' && req.method === 'POST') {
        if (!a.inventory.includes(body.gunId))
          return json(res, 400, { error: 'You do not own this gun' });

        a.equipped = body.gunId;
        writeDB(db);
        return json(res, 200, { user: safeUser(a) });
      }

      return json(res, 404, { error: 'API route not found' });

    } catch (e) {
      return json(res, 400, { error: e.message || 'Bad request' });
    }
  }

  if (route === '/' || route === '/index.html') {
    const file = path.join(__dirname, 'index.html');

    if (!fs.existsSync(file))
      return json(res, 500, { error: 'index.html is missing' });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(file).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const wss = new WebSocket.Server({ noServer: true });
const lobby = new Map();
const game = new Map();

let hostId = null;
let matchStarted = false;

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(data));
}

function broadcastLobby() {
  const players = [...lobby.values()].map(p => ({
    gameId: p.gameId,
    displayName: p.displayName,
    isHost: p.gameId === hostId
  }));

  for (const p of lobby.values()) {
    send(p.ws, {
      type: 'lobby_state',
      players,
      isHost: p.gameId === hostId,
      matchStarted
    });
  }
}

function broadcastGame() {
  const players = [...game.values()].map(p => ({
    id: p.gameId,
    gameId: p.gameId,
    displayName: p.displayName,
    x: p.x,
    z: p.z,
    hp: p.hp,
    kills: p.kills,
    team: p.team
  }));

  for (const p of game.values())
    send(p.ws, { type: 'state', players });
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!['/lobby', '/game'].includes(url.pathname))
    return socket.destroy();

  wss.handleUpgrade(req, socket, head, ws => {
    ws.route = url.pathname;
    ws.gameId = url.searchParams.get('gameId') || '';
    ws.displayName = url.searchParams.get('displayName') || 'Player';
    ws.token = url.searchParams.get('token') || '';
    wss.emit('connection', ws);
  });
});

wss.on('connection', ws => {
  const id = ws.gameId;
  const db = readDB();

  if (!/^\d{5}$/.test(id) ||
      ws.token !== makeToken(id) ||
      !db.accounts[id]) {
    send(ws, { type: 'error', message: 'Invalid player login' });
    return ws.close();
  }

  if (ws.route === '/lobby') {
    if (lobby.has(id)) {
      send(ws, { type: 'error', message: 'Game ID already connected' });
      return ws.close();
    }

    if (!hostId) hostId = id;

    lobby.set(id, {
      ws,
      gameId: id,
      displayName: ws.displayName
    });

    broadcastLobby();

    ws.on('message', raw => {
      let d;
      try {
        d = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (d.type === 'start_match' && id === hostId) {
        matchStarted = true;
        for (const p of lobby.values())
          send(p.ws, { type: 'match_started' });
      }
    });

    ws.on('close', () => {
      lobby.delete(id);

      if (hostId === id)
        hostId = lobby.keys().next().value || null;

      if (!lobby.size) {
        hostId = null;
        matchStarted = false;
      }

      broadcastLobby();
    });

    return;
  }

  if (game.has(id)) {
    send(ws, { type: 'error', message: 'Game ID already in game' });
    return ws.close();
  }

  const p = {
    ws,
    gameId: id,
    displayName: ws.displayName,
    x: Math.random() * 20 - 10,
    z: Math.random() * 20 - 10,
    hp: 100,
    kills: 0,
    team: 1
  };

  game.set(id, p);
  send(ws, { type: 'welcome', gameId: id });
  broadcastGame();

  ws.on('message', raw => {
    let d;
    try {
      d = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (d.type === 'move') {
      if (Number.isFinite(Number(d.x))) p.x = Number(d.x);
      if (Number.isFinite(Number(d.z))) p.z = Number(d.z);
      broadcastGame();
    }

    if (d.type === 'shoot') {
      const target = game.get(String(d.targetId || ''));

      if (target && target !== p) {
        target.hp = Math.max(0, target.hp - 25);

        if (!target.hp) {
          p.kills++;
          target.hp = 100;
        }

        broadcastGame();
        send(target.ws, { type: 'hit', hp: target.hp });
        send(ws, { type: 'kill', kills: p.kills });
      }
    }
  });

  ws.on('close', () => {
    game.delete(id);
    broadcastGame();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RNR Battle Arena listening on ${PORT}`);
});
