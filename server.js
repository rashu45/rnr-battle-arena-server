// RNR Battle Arena - free local hotspot server
// Run on the phone that enables the Android hotspot.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'rnr_database.json');
const sessions = new Map();
const guns = [
 {id:'starter',name:'Starter Rifle',price:0,damage:20,rate:380},
 {id:'ak47',name:'AK-47',price:500,damage:28,rate:300},
 {id:'m416',name:'M416',price:800,damage:24,rate:230},
 {id:'shotgun',name:'Shotgun',price:1000,damage:45,rate:700},
 {id:'scar',name:'SCAR-L',price:1300,damage:27,rate:270},
 {id:'sniper',name:'Sniper Rifle',price:1600,damage:85,rate:1100}
];
function readDB(){try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch{return {accounts:{},feedback:[]}}}
function writeDB(db){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}
function safeUser(a){const {salt,passwordHash,...safe}=a;return safe}
function authUser(req){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');return sessions.get(token)||null}
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
function bodyJSON(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function hashPass(pass,salt){return crypto.pbkdf2Sync(String(pass),salt,120000,32,'sha256').toString('hex')}
function newToken(){return crypto.randomBytes(24).toString('hex')}
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
  if (pathname.startsWith('/api/')) {
    (async()=>{
      const method=req.method||'GET';
      const body=(method==='POST'||method==='PUT')?await bodyJSON(req):{};
      const db=readDB();
      if(pathname==='/api/guns' && method==='GET')return json(res,200,{guns});
      if(pathname==='/api/register' && method==='POST'){
        const username=String(body.username||'').trim(),password=String(body.password||''),displayName=String(body.displayName||username).trim();
        if(!/^[a-zA-Z0-9_]{3,16}$/.test(username))return json(res,400,{error:'Username must be 3–16 letters, numbers or _'});
        if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters'});
        if(Object.values(db.accounts).some(a=>a.username.toLowerCase()===username.toLowerCase()))return json(res,409,{error:'Username already exists'});
        let gameId;do{gameId=String(10000+Math.floor(Math.random()*90000))}while(db.accounts[gameId]);
        const salt=crypto.randomBytes(16).toString('hex');
        const a={gameId,username,displayName:displayName.slice(0,20),salt,passwordHash:hashPass(password,salt),avatar:'🪖',kills:0,deaths:0,tokens:0,equipped:'starter',inventory:['starter'],createdAt:new Date().toISOString()};
        db.accounts[gameId]=a;writeDB(db);const token=newToken();sessions.set(token,gameId);
        return json(res,201,{token,user:safeUser(a)});
      }
      if(pathname==='/api/login' && method==='POST'){
        const v=String(body.gameId||body.username||'').trim();
        const a=db.accounts[v]||Object.values(db.accounts).find(x=>x.username.toLowerCase()===v.toLowerCase());
        if(!a)return json(res,401,{error:'Username or Game ID not found'});
        if(hashPass(body.password||'',a.salt)!==a.passwordHash)return json(res,401,{error:'Incorrect username/Game ID or password'});
        const token=newToken();sessions.set(token,a.gameId);return json(res,200,{token,user:safeUser(a)});
      }
      const gameId=authUser(req);
      const a=gameId&&db.accounts[gameId];
      if(pathname==='/api/logout' && method==='POST'){const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');sessions.delete(t);return json(res,200,{ok:true})}
      if(!a)return json(res,401,{error:'Please login again'});
      if(pathname==='/api/me' && method==='GET')return json(res,200,{user:safeUser(a)});
      if(pathname==='/api/profile' && method==='POST'){a.displayName=String(body.displayName||a.displayName).slice(0,20);a.avatar=String(body.avatar||a.avatar||'🪖').slice(0,12);writeDB(db);return json(res,200,{user:safeUser(a)})}
      if(pathname==='/api/buy' && method==='POST'){const g=guns.find(x=>x.id===body.gunId);if(!g)return json(res,404,{error:'Gun not found'});if(a.inventory.includes(g.id))return json(res,400,{error:'Already owned'});if(a.tokens<g.price)return json(res,400,{error:'Not enough Eagle Tokens'});a.tokens-=g.price;a.inventory.push(g.id);writeDB(db);return json(res,200,{user:safeUser(a)})}
      if(pathname==='/api/equip' && method==='POST'){if(!a.inventory.includes(body.gunId))return json(res,400,{error:'You do not own this gun'});a.equipped=body.gunId;writeDB(db);return json(res,200,{user:safeUser(a)})}
      if(pathname==='/api/feedback' && method==='GET')return json(res,200,{messages:db.feedback||[]});
      if(pathname==='/api/feedback' && method==='POST'){const txt=String(body.text||'').trim();if(!txt)return json(res,400,{error:'Write a message first'});db.feedback=db.feedback||[];db.feedback.unshift({displayName:a.displayName,text:txt.slice(0,1000),createdAt:new Date().toISOString()});writeDB(db);return json(res,200,{ok:true})}
      return json(res,404,{error:'API endpoint not found'});
    })().catch(err=>{console.error('API error',err);json(res,500,{error:'Server error'})});
    return;
  }
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
