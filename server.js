// RNR Battle Arena - free local hotspot server
// Run on the phone that enables the Android hotspot.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const lobbyClients = new Map();
const gameClients = new Map();
let matchStarted = false;
let nextId = 1;

function identity(req) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = u.searchParams.get('token') || '';
  const gameId = u.searchParams.get('gameId') || token.replace(/^local-/, '');
  const displayName = (u.searchParams.get('displayName') || 'Player').slice(0, 20);
  if (!/^\d{5}$/.test(gameId) || (token && token !== `local-${gameId}`)) return null;
  return { gameId, displayName };
}
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function lobbyState() {
  const players = [...lobbyClients.values()].map(p => ({
    gameId: p.gameId, displayName: p.displayName, username: p.displayName, online: true
  }));
  for (const p of lobbyClients.values()) {
    send(p.ws, { type: 'lobby_state', players, isHost: p.isHost, matchStarted });
  }
}
function gameState() {
  const players = [...gameClients.values()].map(p => ({
    id: p.id, gameId: p.gameId, displayName: p.displayName,
    x: p.x || 0, z: p.z || 0, hp: p.hp, kills: p.kills, team: p.team
  }));
  for (const p of gameClients.values()) send(p.ws, { type: 'state', players });
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/health') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ok:true, service:'RNR Hotspot Server', lobby:lobbyClients.size, game:gameClients.size}));
  }
  let file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(ROOT, file);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(full);
  const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  res.writeHead(200, {'content-type':types[ext] || 'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(full).pipe(res);
});
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname !== '/lobby' && pathname !== '/game') { socket.destroy(); return; }
  const ident = identity(req);
  if (!ident) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  req.rnrIdentity = ident; req.rnrPath = pathname;
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  const ident = req.rnrIdentity;
  if (req.rnrPath === '/lobby') {
    const isHost = lobbyClients.size === 0; // First player is host; server runs on hotspot owner's phone.
    const client = {...ident, ws, isHost};
    lobbyClients.set(ws, client);
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'lobby_join') lobbyState();
      if (msg.type === 'start_match' && client.isHost) {
        matchStarted = true;
        for (const p of lobbyClients.values()) send(p.ws, {type:'match_started'});
      }
    });
    ws.on('close', () => { lobbyClients.delete(ws); if (client.isHost && lobbyClients.size) {
      const next = lobbyClients.values().next().value; next.isHost = true;
    } lobbyState(); });
    lobbyState();
    return;
  }

  const id = String(nextId++);
  const team = gameClients.size % 2 ? 'RED' : 'BLUE';
  const player = {...ident, ws, id, team, x:0, z:0, hp:100, kills:0};
  gameClients.set(ws, player);
  send(ws, {type:'welcome', x:0, z:0, team});
  gameState();
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'move') {
      player.x = Number(msg.x) || 0; player.z = Number(msg.z) || 0;
      player.hp = Math.max(0, Math.min(100, Number(msg.hp) || 100));
      gameState();
    }
    if (msg.type === 'shoot') {
      // Simple server-side hit registration: nearest opponent within a short radius.
      const enemies = [...gameClients.values()].filter(p => p !== player && p.team !== player.team && p.hp > 0);
      if (enemies.length) {
        const target = enemies.sort((a,b) => Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z))[0];
        if (Math.hypot(target.x-player.x,target.z-player.z) < 12) {
          target.hp = Math.max(0, target.hp - 34);
          if (target.hp === 0) { player.kills++; send(ws,{type:'kill',killer:player.gameId}); }
        }
      }
      gameState();
    }
  });
  ws.on('close', () => { gameClients.delete(ws); gameState(); });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`RNR Hotspot Server running on http://0.0.0.0:${PORT}`);
  console.log('On this phone open http://127.0.0.1:' + PORT);
  console.log('Friends on the same hotspot open http://HOTSPOT_PHONE_IP:' + PORT);
});
