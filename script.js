
const $=id=>document.getElementById(id);let token='',user=null,guns=[],settings={},gameSocket=null,gameRunning=false,matchMode='training';
const offlineMode = !['http:','https:'].includes(location.protocol);
const localDBKey = 'rnr_local_accounts_v2';
const sessionKey = 'rnr_battle_saved_session_v1';
function localDB(){try{return JSON.parse(localStorage.getItem(localDBKey)||'{"accounts":{}}')}catch{return {accounts:{}}}}
function saveLocalDB(db){localStorage.setItem(localDBKey,JSON.stringify(db))}
function localCurrent(){const id=localStorage.getItem('rnr_local_session');return id?localDB().accounts[id]:null}
async function localPasswordHash(password,saltBytes){
 const data=new TextEncoder().encode(String(password));
 if(globalThis.crypto?.subtle){
  const key=await crypto.subtle.importKey('raw',data,'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,iterations:120000,hash:'SHA-256'},key,256);
  return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,'0')).join('');
 }
 // Fallback only for local demo on browsers without WebCrypto; not suitable for production accounts.
 let h=2166136261>>>0;
 for(const b of [...saltBytes,...data]){h^=b;h=Math.imul(h,16777619)>>>0}
 return h.toString(16).padStart(8,'0');
}
async function localAPI(path,body){
 const db=localDB();
 if(path==='/api/guns')return {guns:[
 {id:'starter',name:'Starter Rifle',price:0,damage:20,rate:380},
 {id:'ak47',name:'AK-47',price:500,damage:28,rate:300},
 {id:'m416',name:'M416',price:800,damage:24,rate:230},
 {id:'shotgun',name:'Shotgun',price:1000,damage:45,rate:700},
 {id:'scar',name:'SCAR-L',price:1300,damage:27,rate:270},
 {id:'sniper',name:'Sniper Rifle',price:1600,damage:85,rate:1100}]};
 if(path==='/api/register'){
  const username=String(body.username||'').trim(),password=String(body.password||''),displayName=String(body.displayName||username).trim();
  if(!/^[a-zA-Z0-9_]{3,16}$/.test(username))throw Error('Username must be 3–16 letters, numbers or _');
  if(password.length<8)throw Error('Password must be at least 8 characters');
  if(Object.values(db.accounts).some(a=>a.username.toLowerCase()===username.toLowerCase()))throw Error('Username already exists on this device');
  let gameId;do{gameId=String(10000+Math.floor(Math.random()*90000))}while(db.accounts[gameId]);
  const salt=globalThis.crypto?.getRandomValues?crypto.getRandomValues(new Uint8Array(16)):Uint8Array.from({length:16},()=>Math.floor(Math.random()*256));
  const saltHex=[...salt].map(x=>x.toString(16).padStart(2,'0')).join('');
  const passwordHash=await localPasswordHash(password,salt);
  const a={gameId,username,displayName:displayName.slice(0,20),salt:saltHex,passwordHash,avatar:'',kills:0,deaths:0,tokens:0,equipped:'starter',inventory:['starter'],createdAt:new Date().toISOString()};
  db.accounts[gameId]=a;saveLocalDB(db);localStorage.setItem('rnr_local_session',gameId);
  return {token:'local-'+gameId,user:localSafe(a)};
 }
 if(path==='/api/login'){
  const v=String(body.gameId||body.username||'').trim(),a=db.accounts[v]||Object.values(db.accounts).find(x=>x.username.toLowerCase()===v.toLowerCase());
  if(!a)throw Error('ഈ ഫോണിലെ ഈ ബ്രൗസറിൽ അക്കൗണ്ട് കണ്ടെത്തിയില്ല. അക്കൗണ്ട് ആദ്യം രജിസ്റ്റർ ചെയ്ത അതേ ബ്രൗസർ ഉപയോഗിക്കുക.');
  const salt=new Uint8Array((a.salt.match(/.{2}/g)||[]).map(x=>parseInt(x,16)));
  const hash=await localPasswordHash(String(body.password||''),salt);
  if(hash!==a.passwordHash)throw Error('Incorrect username/Game ID or password');
  localStorage.setItem('rnr_local_session',a.gameId);return {token:'local-'+a.gameId,user:localSafe(a)};
 }
 const id=localStorage.getItem('rnr_local_session'),a=id&&db.accounts[id];
 if(path==='/api/logout'){localStorage.removeItem('rnr_local_session');return {ok:true}}
 if(!a)throw Error('Please login again');
 if(path==='/api/me')return {user:localSafe(a)};
 if(path==='/api/profile'){a.displayName=String(body.displayName||a.displayName).slice(0,20);a.avatar=String(body.avatar||'').slice(0,12);saveLocalDB(db);return {user:localSafe(a)}}
 if(path==='/api/buy'){const g=(await localAPI('/api/guns')).guns.find(x=>x.id===body.gunId);if(!g)throw Error('Gun not found');if(a.inventory.includes(g.id))throw Error('Already owned');if(a.tokens<g.price)throw Error('Not enough Eagle Tokens');a.tokens-=g.price;a.inventory.push(g.id);saveLocalDB(db);return {user:localSafe(a)}}
 if(path==='/api/equip'){if(!a.inventory.includes(body.gunId))throw Error('You do not own this gun');a.equipped=body.gunId;saveLocalDB(db);return {user:localSafe(a)}}
 throw Error('Unsupported local action');
}
function localSafe(a){const {passwordHash,salt,...safe}=a;return safe}
const api=async(path,body)=>{
 if(offlineMode)return localAPI(path,body||{});
 let r;try{r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined})}
 catch(e){throw Error('Cannot reach game server. Open the game using http://HOST_IP:8080, not from Downloads.')}
 let d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d
};
function msg(t){$('appMsg').textContent=t;showNotice(t)}function authMsg(t){$('authMsg').textContent=t}
function showNotice(t){const n=$('notice');if(!n)return;n.textContent=t;n.classList.add('show');clearTimeout(window.rnrNoticeTimer);window.rnrNoticeTimer=setTimeout(()=>n.classList.remove('show'),2600);try{let h=JSON.parse(localStorage.getItem('rnr_notice_history')||'[]');h.unshift({text:String(t),at:new Date().toISOString()});localStorage.setItem('rnr_notice_history',JSON.stringify(h.slice(0,30)))}catch{}}
if(offlineMode){const n=document.createElement('div');n.className='muted';n.style.cssText='background:#263d2c;border:1px solid #58765d;padding:10px;border-radius:9px;margin-top:12px';n.textContent='LOCAL DEVICE MODE: Accounts are saved only in this browser on this phone. For shared Game IDs, cross-phone login, saved online kills/tokens and hotspot multiplayer, start server.js and open this page through http://HOST_IP:8080.';$('auth').querySelector('.panel').appendChild(n)}
$('showLogin').onclick=()=>{$('loginBox').classList.remove('hidden');$('registerBox').classList.add('hidden');$('showLogin').classList.add('active');$('showRegister').classList.remove('active');authMsg('')};
$('showRegister').onclick=()=>{$('registerBox').classList.remove('hidden');$('loginBox').classList.add('hidden');$('showRegister').classList.add('active');$('showLogin').classList.remove('active');authMsg('')};
$('copyGameId').onclick=async()=>{
 const id=String(user?.gameId||'');
 if(!/^\\d{5}$/.test(id))return;
 try{await navigator.clipboard.writeText(id);msg('Game ID copied')}
 catch(e){const t=document.createElement('textarea');t.value=id;document.body.append(t);t.select();try{document.execCommand('copy');msg('Game ID copied')}catch(_){msg('Copy not available in this browser')}t.remove()}
};
function enter(d){
 token=d.token||'local-'+(d.user&&d.user.gameId||'');
 user=d.user;
 try{localStorage.setItem(sessionKey,token)}catch(e){}
 $('auth').classList.add('hidden');$('app').classList.remove('hidden');
 refresh();loadSettings()
}
$('registerBtn').onclick=async()=>{try{let d=await api('/api/register',{username:$('regUser').value,displayName:$('regDisplay').value,password:$('regPass').value});enter(d);authMsg('')}catch(e){authMsg(e.message)}};
$('loginBtn').onclick=async()=>{
 const btn=$('loginBtn');btn.disabled=true;btn.textContent='LOGGING IN…';
 try{
  let v=$('loginId').value.trim();
  if(!v||!$('loginPass').value)throw Error('Game ID/Username and password enter ചെയ്യുക');
  let d=await api('/api/login',{gameId:/^\d{5}$/.test(v)?v:'',username:/^\d{5}$/.test(v)?'':v,password:$('loginPass').value});
  enter(d);authMsg('Login successful');
 }catch(e){authMsg(e.message)}
 finally{btn.disabled=false;btn.textContent='LOGIN'}
};
async function refresh(){let d=await api('/api/me');user=d.user;let u=user;$('walletTop').textContent='🦅 '+Number(u.tokens).toFixed(2);$('lobbyName').textContent=u.displayName;$('lobbyId').textContent=u.gameId;$('lobbyTokens').textContent=Number(u.tokens).toFixed(2);$('lobbyKills').textContent=u.kills;$('lobbyGuns').textContent=u.inventory.length;$('profileUser').textContent=u.displayName;$('profileId').textContent=u.gameId;$('profileGameId').textContent=u.gameId;$('displayName').value=u.displayName;$('avatar').value=u.avatar||'🪖';$('profileKills').textContent=u.kills;$('profileDeaths').textContent=u.deaths;$('profileTokens').textContent=Number(u.tokens).toFixed(2);$('storeTokens').textContent=Number(u.tokens).toFixed(2);$('gameKill').textContent='KILLS '+u.kills;await renderGuns()}
async function renderGuns(){let d=await api('/api/guns');guns=d.guns;$('gunList').innerHTML=guns.map(g=>{let own=user.inventory.includes(g.id);return `<div class="gun"><b>${g.name}</b><div class="muted">Damage ${g.damage} · Rate ${g.rate}ms</div><div class="big">${g.price===0?'FREE':'🦅 '+g.price}</div><button data-buy="${g.id}" ${own?'disabled':''}>${own?'OWNED':'PURCHASE'}</button></div>`}).join('');$('inventoryList').innerHTML=user.inventory.map(id=>{let g=guns.find(x=>x.id===id);return `<div class="gun"><b>${g?.name||id}</b><button data-equip="${id}">${user.equipped===id?'EQUIPPED':'EQUIP'}</button></div>`}).join('')}
$('gunList').onclick=async e=>{let id=e.target.dataset.buy;if(!id)return;let g=guns.find(x=>x.id===id);if(user.inventory.includes(id)){showNotice('ALREADY OWNED');return}if(Number(user.tokens)<Number(g?.price||0)){showNotice('LOW BALANCE · You need '+Math.max(0,Number(g.price)-Number(user.tokens)).toFixed(2)+' more Eagle Tokens');return}try{let d=await api('/api/buy',{gunId:id});user=d.user;await refresh();showNotice('PURCHASE SUCCESSFUL · '+g.name+' added to inventory')}catch(e){showNotice((/balance|token/i.test(e.message)?'LOW BALANCE · ':'PURCHASE FAILED · ')+e.message)}};
$('inventoryList').onclick=async e=>{let id=e.target.dataset.equip;if(!id)return;try{let d=await api('/api/equip',{gunId:id});user=d.user;await refresh();if(player)applyEquippedGun();showNotice('EQUIPPED · '+(guns.find(g=>g.id===id)?.name||id))}catch(e){showNotice('EQUIP FAILED · '+e.message)}};
async function loadFeedback(){try{const d=await api('/api/feedback');$('feedbackList').innerHTML=(d.messages||[]).map(m=>`<div class="gun" style="margin:8px 0"><b>${escapeHTML(m.displayName||'Player')} · ${new Date(m.createdAt).toLocaleString()}</b><div style="white-space:pre-wrap;margin-top:5px">${escapeHTML(m.text)}</div></div>`).join('')||'No messages yet.'}catch(e){$('feedbackList').textContent=e.message}}
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('sendFeedback').onclick=async()=>{const text=$('feedbackText').value.trim();if(!text)return $('feedbackStatus').textContent='Write a message first.';try{await api('/api/feedback',{text});$('feedbackText').value='';$('feedbackStatus').textContent='Message sent.';loadFeedback()}catch(e){$('feedbackStatus').textContent=e.message}};
document.querySelector('[data-tab="feedbackPage"]').addEventListener('click',loadFeedback);
setInterval(()=>{if(!$('feedbackPage').classList.contains('hidden')&&user)loadFeedback()},7000);
$('saveProfile').onclick=async()=>{try{let d=await api('/api/profile',{displayName:$('displayName').value,avatar:$('avatar').value});user=d.user;await refresh();msg('Profile saved')}catch(e){msg(e.message)}};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tabPage').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab))});
function loadSettings(){try{settings=JSON.parse(localStorage.getItem('rnrSettings')||'{}')}catch{settings={}};for(let id of ['graphics','sensitivity','aimSensitivity','joySize','fireSize','music','sound','vibration'])if(settings[id]!==undefined){if($(id).type==='checkbox')$(id).checked=settings[id];else $(id).value=settings[id]}applySettings()}
function applySettings(){$('sensVal').textContent=$('sensitivity').value;$('aimVal').textContent=$('aimSensitivity').value;$('stick').style.width=$('stick').style.height=$('joySize').value+'px';$('nub').style.left=$('nub').style.top=(+$('joySize').value/2-23)+'px';$('fire').style.width=$('fire').style.height=$('fireSize').value+'px'}
['sensitivity','aimSensitivity','joySize','fireSize'].forEach(id=>$(id).oninput=applySettings);
$('saveSettings').onclick=()=>{settings={};for(let id of ['graphics','sensitivity','aimSensitivity','joySize','fireSize','music','sound','vibration'])settings[id]=$(id).type==='checkbox'?$(id).checked:$(id).value;localStorage.setItem('rnrSettings',JSON.stringify(settings));applySettings();msg('Settings saved on this device')};
$('resetSettings').onclick=()=>{localStorage.removeItem('rnrSettings');loadSettings();msg('Controls reset')};
$('logout').onclick=async()=>{
 try{await api('/api/logout',{})}catch{}
 token='';user=null;
 try{localStorage.removeItem(sessionKey);localStorage.removeItem('rnr_local_session')}catch(e){}
 $('app').classList.add('hidden');$('auth').classList.remove('hidden')
};
$('exitGame').onclick=()=>{gameRunning=false;fallback2D=false;cancelAnimationFrame(fallbackFrame);if(gameSocket)gameSocket.close();$('gameWrap').classList.add('hidden');$('app').classList.remove('hidden');refresh()};
let THREE,renderer,scene,camera,player,legs=[],remotes=new Map(),bots=[],yaw=0,pitch=.18,move={x:0,y:0},ammo=999999,maxAmmo=999999,hp=100,kills=0,fireWait=0,aiming=false,clock,jumpVelocity=0,onGround=true,fireHeld=false,shots=[],reloadTimer=0,idlePhase=0,jumpHeight=0;

let fallback2D=false, fallbackFrame=0, fallbackLast=0, fallbackJumpUntil=0, fallbackPlayer={x:0,y:0,angle:0},
    fallbackBots=[], fallbackMove={x:0,y:0}, fallbackFire=false, fallbackAim=false,
    fallbackKeys={}, fallbackCanvas=null, fallbackCtx=null, fallbackKills=0;

const fallbackMapImage = new Image();
fallbackMapImage.src='';
fallbackMapImage.onload=()=>{if(fallback2D&&gameRunning)fallbackFrame=requestAnimationFrame(drawFallback);};

function start2DTraining(mode='training'){
  fallback2D=true; gameRunning=true; fallbackKills=0; hp=100; ammo=999999;
  $('app').classList.add('hidden'); $('gameWrap').classList.remove('hidden');
  const old=$('game'), c=document.createElement('canvas'); c.id='game';
  c.style.cssText='width:100%;height:100%;display:block;touch-action:none;background:#263b2c;background-size:cover;background-position:center';
  old.replaceWith(c); fallbackCanvas=c; fallbackCtx=c.getContext('2d');
  fallbackPlayer={x:0,y:0,angle:-Math.PI/2}; fallbackMove={x:0,y:0}; fallbackFire=false;
  fallbackBots=Array.from({length:10},(_,i)=>({x:((i%5)-2)*95+35,y:-230-Math.floor(i/5)*170,hp:100,alive:true,tx:((i%5)-2)*95+35,ty:-230-Math.floor(i/5)*170,turnAt:0,angle:0}));
  $('netStatus').textContent='TRAINING · 2D COMPATIBILITY MODE';
  $('netPlayers').textContent='Players: 1 + 10 bots';
  const radarInit=$('mini').getContext('2d');radarInit.fillStyle='#6c9b58';radarInit.fillRect(0,0,200,200);
  $('toast').textContent='TRAINING READY · MOVE & SHOOT';
  $('gameHp').textContent='HP 100'; $('gameKill').textContent='KILLS 0';
  $('aliveCount').textContent='ALIVE 11'; $('ammo').textContent='AMMO ∞';
  $('aim').onclick=()=>{fallbackAim=!fallbackAim;$('aim').textContent=fallbackAim?'AIM ON':'AIM'};
  $('fire').onpointerdown=e=>{e.preventDefault();fallbackFire=true;fallbackShoot()};
  $('fire').onpointerup=$('fire').onpointercancel=$('fire').onpointerleave=()=>fallbackFire=false;
  let fallbackRun=false, fallbackForward=false;
  $('jump').onpointerdown=e=>{e.preventDefault();if(!fallbackJumpUntil||performance.now()>fallbackJumpUntil){fallbackJumpUntil=performance.now()+520;showNotice('JUMP!')}};
  $('runBtn').onpointerdown=e=>{e.preventDefault();fallbackRun=true;$('runBtn').textContent='RUN ON';};
  $('runBtn').onpointerup=$('runBtn').onpointercancel=$('runBtn').onpointerleave=()=>{fallbackRun=false;$('runBtn').textContent='RUN';};
  $('forwardBtn').onpointerdown=e=>{e.preventDefault();fallbackForward=true;fallbackMove.y=-1;};
  $('forwardBtn').onpointerup=$('forwardBtn').onpointercancel=$('forwardBtn').onpointerleave=()=>{fallbackForward=false;fallbackMove.y=0;};
  let active=null, ox=0, oy=0;
  c.onpointerdown=e=>{c.setPointerCapture?.(e.pointerId);active=e.pointerId;ox=e.clientX;oy=e.clientY};
  c.onpointermove=e=>{if(active!==e.pointerId)return;let dx=e.clientX-ox,dy=e.clientY-oy;
    if(ox<innerWidth*.5){fallbackMove.x=Math.max(-1,Math.min(1,dx/55));fallbackMove.y=Math.max(-1,Math.min(1,dy/55))}
    else fallbackPlayer.angle+=dx*.008;
    ox=e.clientX;oy=e.clientY;
  };
  const end=()=>{active=null;fallbackMove={x:0,y:0}};
  c.onpointerup=end;c.onpointercancel=end;
  window.addEventListener('keydown',fallbackKeyDown);window.addEventListener('keyup',fallbackKeyUp);
  fitFallbackCanvas();fallbackLast=performance.now();cancelAnimationFrame(fallbackFrame);fallbackFrame=requestAnimationFrame(drawFallback);
  $('appMsg').textContent='3D unavailable; started compatible 2D Training Mode.';
}
function fallbackKeyDown(e){fallbackKeys[e.key.toLowerCase()]=true}
function fallbackKeyUp(e){fallbackKeys[e.key.toLowerCase()]=false}
function fitFallbackCanvas(){if(!fallbackCanvas)return;let d=Math.min(devicePixelRatio||1,2);fallbackCanvas.width=Math.floor(innerWidth*d);fallbackCanvas.height=Math.floor(innerHeight*d);fallbackCtx.setTransform(d,0,0,d,0,0)}
function fallbackShoot(){
  if(!gameRunning||!fallback2D)return;
  let best=null,bd=1e9;
  for(const b of fallbackBots){if(!b.alive)continue;let dx=b.x-fallbackPlayer.x,dy=b.y-fallbackPlayer.y,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),diff=Math.atan2(Math.sin(a-fallbackPlayer.angle),Math.cos(a-fallbackPlayer.angle));
    if(d<460&&Math.abs(diff)<(fallbackAim?.25:.17)&&d<bd){best=b;bd=d}}
  if(best){best.hp-=34;if(best.hp<=0){best.alive=false;fallbackKills++;kills=fallbackKills;$('gameKill').textContent='KILLS '+kills;$('aliveCount').textContent='ALIVE '+(fallbackBots.filter(b=>b.alive).length+1);showNotice('ENEMY ELIMINATED · +1 KILL')}else showNotice('HIT · '+best.hp+' HP LEFT')}
}
function drawFallback(){
  if(!gameRunning||!fallback2D)return;
  fallbackFrame=requestAnimationFrame(drawFallback);
  const now=performance.now(),dt=Math.min((now-fallbackLast)/1000,.05);fallbackLast=now;
  let mx=fallbackMove.x+(fallbackKeys.d?1:0)-(fallbackKeys.a?1:0),my=fallbackMove.y+(fallbackKeys.s?1:0)-(fallbackKeys.w?1:0);
  let ml=Math.hypot(mx,my)||1;let speed=(fallbackRun?310:190);
  if(Math.hypot(mx,my)>.08){fallbackPlayer.x+=mx/ml*speed*dt;fallbackPlayer.y+=my/ml*speed*dt;fallbackPlayer.angle=Math.atan2(my,mx)+Math.PI/2;}
  // Keep the player inside the illustrated battlefield.
  fallbackPlayer.x=Math.max(-720,Math.min(720,fallbackPlayer.x));
  fallbackPlayer.y=Math.max(-395,Math.min(395,fallbackPlayer.y));
  // Bots patrol, turn toward the player, and occasionally change direction.
  for(const b of fallbackBots){
    if(!b.alive)continue;
    if(now>b.turnAt || Math.hypot(b.tx-b.x,b.ty-b.y)<18){
      const toward=Math.hypot(fallbackPlayer.x-b.x,fallbackPlayer.y-b.y)<260;
      if(toward){b.tx=fallbackPlayer.x+(Math.random()-.5)*150;b.ty=fallbackPlayer.y+(Math.random()-.5)*150;}
      else {b.tx=Math.max(-700,Math.min(700,b.x+(Math.random()-.5)*260));b.ty=Math.max(-370,Math.min(370,b.y+(Math.random()-.5)*260));}
      b.turnAt=now+900+Math.random()*1800;
    }
    const dx=b.tx-b.x,dy=b.ty-b.y,d=Math.hypot(dx,dy)||1,step=Math.min(d,52*dt);
    b.x+=dx/d*step;b.y+=dy/d*step;b.angle=Math.atan2(dy,dx);
  }
  const ctx=fallbackCtx,w=innerWidth,h=innerHeight;
  ctx.clearRect(0,0,w,h);
  // Full-colour cartoon battlefield image with a camera following the player.
  const cx=w/2,cy=h*.70,scale=.8;
  const mapW=1600,mapH=900;
  if(false) { /* map artwork removed */ } else {
    // Visible map fallback while the bundled image is decoding.
    ctx.fillStyle='#7ecb65';ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#4b555b';ctx.fillRect(0,h*.42,w,h*.18);
    ctx.fillRect(w*.42,0,w*.16,h);
  }
  // enemies in world coordinates relative to player
  for(const b of fallbackBots){if(!b.alive)continue;let sx=cx+(b.x-fallbackPlayer.x)*scale,sy=cy+(b.y-fallbackPlayer.y)*scale;if(sx<-40||sx>w+40||sy<-40||sy>h+40)continue;
    ctx.save();ctx.translate(sx,sy);ctx.rotate((b.angle||0)+Math.PI/2);
    ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(0,5,12,7,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#8d3e35';ctx.fillRect(-8,-7,16,18);ctx.fillStyle='#d5b18d';ctx.beginPath();ctx.arc(0,-12,6,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#26352a';ctx.fillRect(-6,-17,12,4);ctx.fillStyle='#252525';ctx.fillRect(4,-5,18,4);ctx.restore();
    ctx.fillStyle='#18221b';ctx.fillRect(sx-12,sy-25,24,4);ctx.fillStyle='#74df69';ctx.fillRect(sx-12,sy-25,24*b.hp/100,4)}
  // Player character: bright outline, visible body, head and weapon while moving.
  const jumpLift=fallbackJumpUntil>now?Math.sin((1-(fallbackJumpUntil-now)/520)*Math.PI)*30:0;
  ctx.save();ctx.translate(cx,cy-jumpLift);ctx.rotate(fallbackPlayer.angle);
  ctx.fillStyle='rgba(0,0,0,.30)';ctx.beginPath();ctx.ellipse(0,9,23,13,0,0,Math.PI*2);ctx.fill();
  // legs and boots
  ctx.fillStyle='#26343a';ctx.fillRect(-11,7,9,18);ctx.fillRect(2,7,9,18);
  ctx.fillStyle='#151b20';ctx.fillRect(-13,22,12,6);ctx.fillRect(2,22,12,6);
  // jacket and backpack
  ctx.fillStyle='#b83c32';ctx.fillRect(-15,-12,30,25);
  ctx.fillStyle='#202d34';ctx.fillRect(-11,-10,22,22);
  ctx.fillStyle='#c18b42';ctx.fillRect(-10,-7,20,17);
  ctx.fillStyle='#6b492d';ctx.fillRect(-8,-5,16,13);
  ctx.fillStyle='#d4b36c';ctx.fillRect(-6,-2,12,3);
  // arms, head and cap
  ctx.fillStyle='#b83c32';ctx.fillRect(-20,-9,7,18);ctx.fillRect(13,-9,7,18);
  ctx.fillStyle='#e4b991';ctx.beginPath();ctx.arc(0,-18,8,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#202a30';ctx.beginPath();ctx.arc(0,-21,9,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(-8,-21,16,3);
  // rifle on shoulder
  ctx.fillStyle='#171c20';ctx.save();ctx.rotate(-.20);ctx.fillRect(12,-24,5,39);ctx.fillRect(10,-25,9,5);ctx.restore();
  ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.strokeRect(-15,-12,30,25);
  ctx.restore();
  // Small radar: battlefield thumbnail, player arrow and moving enemy dots.
  const radar=$('mini'),mc=radar.getContext('2d'),rw=radar.width,rh=radar.height;
  mc.clearRect(0,0,rw,rh);mc.fillStyle='#6c9b58';mc.fillRect(0,0,rw,rh);
  
  const rx=x=>rw/2+(x/1600)*rw, ry=y=>rh/2+(y/900)*rh;
  mc.fillStyle='#ff5148';
  for(const b of fallbackBots){if(!b.alive)continue;mc.beginPath();mc.arc(rx(b.x),ry(b.y),4,0,Math.PI*2);mc.fill();}
  mc.save();mc.translate(rx(fallbackPlayer.x),ry(fallbackPlayer.y));mc.rotate(fallbackPlayer.angle);
  mc.fillStyle='#ffffff';mc.beginPath();mc.moveTo(0,-8);mc.lineTo(6,7);mc.lineTo(0,4);mc.lineTo(-6,7);mc.closePath();mc.fill();mc.restore();
  mc.strokeStyle='#ffffff';mc.lineWidth=3;mc.strokeRect(1.5,1.5,rw-3,rh-3);
  if(fallbackAim){ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,34,0,Math.PI*2);ctx.moveTo(cx-12,cy);ctx.lineTo(cx+12,cy);ctx.moveTo(cx,cy-12);ctx.lineTo(cx,cy+12);ctx.stroke()}
  $('gameHp').textContent='HP '+hp;$('ammo').textContent='AMMO ∞';
}
window.addEventListener('resize',()=>{if(fallback2D)fitFallbackCanvas()});

function prepareWebGLCanvas(){
 const old=$('game');
 const fresh=document.createElement('canvas');
 fresh.id='game';
 fresh.style.cssText='width:100%;height:100%;display:block;touch-action:none;background:#83c9e8';
 old.replaceWith(fresh);
 return fresh;
}
async function startGame(mode='training'){
 if(gameRunning)return;
 if(mode==='training'){
   try{
     $('appMsg').textContent='Loading 3D Training Map…';
     if(!THREE){
       // Use the classic browser build: it also works when the HTML is opened
       // directly from Android Downloads (content://), where ES module imports
       // can be blocked by the browser origin policy.
       const loadThreeClassic=()=>new Promise((resolve,reject)=>{
         if(window.THREE){THREE=window.THREE;resolve();return;}
         const s=document.createElement('script');
         s.src='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
         s.onload=()=>{if(window.THREE){THREE=window.THREE;resolve();}else reject(new Error('Three.js loaded but was not available.'));};
         s.onerror=()=>reject(new Error('Could not load 3D engine. Check internet connection and reopen the game.'));
         document.head.appendChild(s);
       });
       await loadThreeClassic();
     }
     const probe=document.createElement('canvas');
     if(!(probe.getContext('webgl2')||probe.getContext('webgl')))throw new Error('WebGL is unavailable on this browser.');
     $('app').classList.add('hidden');$('gameWrap').classList.remove('hidden');
     ammo=999999;maxAmmo=999999;hp=100;fireHeld=false;shots=[];yaw=0;pitch=.18;
     prepareWebGLCanvas();
     $('netStatus').textContent='TRAINING READY';
     $('netPlayers').textContent='Players: 1 + 10 bots';
     $('toast').textContent='';$('toast').style.display='none';
     init3D();
     if(!renderer||!scene||!camera||!player)throw new Error('3D graphics could not initialize.');
     applyEquippedGun();updateAmmo();connectGame('training');
     $('toast').style.display='none';
     gameRunning=true;
     requestAnimationFrame(()=>{if(gameRunning)animate()});
     $('appMsg').textContent='3D Training is ready.';
   }catch(err){
     console.warn('3D Training start failed:',err);
     gameRunning=false;
     $('gameWrap').classList.add('hidden');
     $('app').classList.remove('hidden');
     $('appMsg').textContent='Training could not start: '+(err?.message||'Unknown error');$('appMsg').classList.remove('hidden');
   }
   return;
 }
 $('appMsg').textContent='Connecting to Hotspot Match…';
 try{
   if(!THREE){
     let lastError=null;
     for(const url of [
       'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
       'https://unpkg.com/three@0.160.0/build/three.module.js'
     ]){
       try{THREE=await import(url);break}catch(err){lastError=err}
     }
     if(!THREE)throw new Error('3D engine load failed. Open this game from an HTTPS website or local web server with internet access. '+(lastError?.message||''));
   }
   const probe=document.createElement('canvas');
   const gl=probe.getContext('webgl2')||probe.getContext('webgl')||probe.getContext('experimental-webgl');
   if(!gl)throw new Error('ഈ ഫോണിൽ WebGL ലഭ്യമല്ല. Chrome update ചെയ്യുക.');
   $('app').classList.add('hidden');$('gameWrap').classList.remove('hidden');
   ammo=999999;maxAmmo=999999;hp=100;fireHeld=false;shots=[];yaw=0;pitch=.18;
   prepareWebGLCanvas();
   $('netStatus').textContent='HOTSPOT · CONNECTING';
   $('netPlayers').textContent='Players: waiting for server';
   $('toast').textContent='HOTSPOT MATCH · CONNECTING';
   init3D();
   if(!renderer||!scene||!camera||!player)throw new Error('3D graphics could not initialize.');
   applyEquippedGun();updateAmmo();connectGame(mode);
   gameRunning=true;
   requestAnimationFrame(()=>{if(gameRunning)animate()});
 }catch(e){
   console.warn('Hotspot start failed:',e);
   gameRunning=false;
   $('gameWrap').classList.add('hidden');
   $('app').classList.remove('hidden');
   openPage('hotspotPage');
   $('hotspotStatus').textContent='Unable to start match';
   $('hostRole').textContent='Check the online lobby connection';
   $('appMsg').textContent='Hotspot match could not start: '+(e?.message||'Unknown error');
 }
}
function init3D(){let c=$('game');const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);renderer=new THREE.WebGLRenderer({canvas:c,antialias:!isMobile,powerPreference:'high-performance'});let quality=settings.graphics||'Medium';renderer.setPixelRatio(Math.min(devicePixelRatio||1,isMobile?(quality==='Low'?0.8:1):(quality==='High'?2:1.6)));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=!isMobile&&quality!=='Low';renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;renderer.setClearColor(0x8fcff0,1);scene=new THREE.Scene();scene.background=new THREE.Color(0x8fcff0);scene.fog=new THREE.Fog(0x8fcff0,85,210);camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.1,200);scene.add(new THREE.HemisphereLight(0xe4edff,0x34432b,2.25));let sun=new THREE.DirectionalLight(0xffe8c9,3.0);sun.position.set(-30,45,20);sun.castShadow=true;scene.add(sun);
let ground=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.MeshStandardMaterial({color:0x77a85b,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
// LOW-POLY CARTOON OUTDOOR TRAINING MAP.
const grassMat=new THREE.MeshStandardMaterial({color:0x667b50,roughness:1});
const roadMat=new THREE.MeshStandardMaterial({color:0x343a36,roughness:1});
const roadEdgeMat=new THREE.MeshStandardMaterial({color:0x9a9b7a,roughness:1});
const treeTrunkMat=new THREE.MeshStandardMaterial({color:0x65462f,roughness:1});
const treeLeafMats=[0x174b2c,0x1d5b34,0x28663a].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:1}));
const darkStructureMat=new THREE.MeshStandardMaterial({color:0x454a45,roughness:1});
// Existing green ground plane is reused for this map.

// Rolling low hills around the outer edge.
for(let i=0;i<12;i++){
 const hill=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshStandardMaterial({color:i%2?0x657a50:0x78865a,roughness:1}));
 hill.scale.set(13+(i%4)*4,2.5+(i%3),9+(i%5)*2);
 const a=i/12*Math.PI*2;hill.position.set(Math.cos(a)*78,1,Math.sin(a)*78);scene.add(hill);
}
// Wide intersecting asphalt roads with pale shoulders.
function road(x,z,w,d,rot=0){
 const edge=new THREE.Mesh(new THREE.BoxGeometry(w+1,.10,d+1),roadEdgeMat);edge.position.set(x,.02,z);edge.rotation.y=rot;scene.add(edge);
 const m=new THREE.Mesh(new THREE.BoxGeometry(w,.12,d),roadMat);m.position.set(x,.09,z);m.rotation.y=rot;m.receiveShadow=true;scene.add(m);
}
road(0,-12,18,190);road(-8,22,145,13,-.12);road(26,54,85,12,.28);
const dashMat=new THREE.MeshBasicMaterial({color:0xd7d0a0});
for(let z=-95;z<90;z+=13){const d=new THREE.Mesh(new THREE.BoxGeometry(.22,.14,5),dashMat);d.position.set(0,.17,z);scene.add(d)}
for(let x=-70;x<70;x+=14){const d=new THREE.Mesh(new THREE.BoxGeometry(5,.14,.22),dashMat);d.position.set(x,.17,22);d.rotation.y=-.12;scene.add(d)}

// Large cylindrical industrial tanks, matching the simple chunky reference geometry.
function tank(x,z,r=7,h=19){
 const g=new THREE.Group();
 const body=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,12,1),darkStructureMat);body.position.y=h/2;body.castShadow=true;body.receiveShadow=true;g.add(body);
 const rim=new THREE.Mesh(new THREE.CylinderGeometry(r+.25,r+.25,.5,12),new THREE.MeshStandardMaterial({color:0x555b54,roughness:1}));rim.position.y=h+.15;g.add(rim);
 g.position.set(x,0,z);scene.add(g);
}
tank(-34,-35,8,20);tank(43,-55,7,18);tank(52,20,6,16);

// Stylized conifer trees: brown trunks and layered low-poly green cones.
function pine(x,z,s=1,variant=0){
 const g=new THREE.Group();
 const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.45*s,.65*s,3.2*s,7),treeTrunkMat);trunk.position.y=1.6*s;trunk.castShadow=true;g.add(trunk);
 for(let k=0;k<3;k++){
  const cone=new THREE.Mesh(new THREE.ConeGeometry((3.4-k*.55)*s,(5.2-k*.35)*s,7),treeLeafMats[(variant+k)%treeLeafMats.length]);
  cone.position.y=(4.1+k*2.5)*s;cone.castShadow=true;g.add(cone);
 }
 g.position.set(x,0,z);scene.add(g);
}
for(const [x,z,s] of [[-52,-18,1.25],[-18,-48,1],[18,-65,1.2],[58,-30,1.3],[-58,24,1.1],[42,45,1.25],[5,60,.95],[-34,66,1.1],[70,5,.9],[-5,-85,.9],[28,5,1]])pine(x,z,s,Math.abs(Math.round(x+z))%3);

// Small low-poly huts and cover blocks around the training grounds.
const hutColors=[0xb9a17a,0x9b8062,0x8c9a83,0xb78c64];
for(let i=0;i<9;i++){
 const x=-60+(i%3)*58,z=-72+Math.floor(i/3)*65;
 if(Math.abs(x)<18&&Math.abs(z)<18)continue;
 const g=new THREE.Group(),w=7+(i%2)*2,d=6;
 const wall=new THREE.Mesh(new THREE.BoxGeometry(w,4,d),new THREE.MeshStandardMaterial({color:hutColors[i%hutColors.length],roughness:1}));wall.position.y=2;g.add(wall);
 const roof=new THREE.Mesh(new THREE.ConeGeometry(6,3,4),new THREE.MeshStandardMaterial({color:i%2?0x6b5140:0x7b5742,roughness:1}));roof.position.y=5.3;roof.rotation.y=Math.PI/4;g.add(roof);
 g.position.set(x,0,z);scene.add(g);
}
const concreteMat=new THREE.MeshStandardMaterial({color:0x777e73,roughness:1});
for(const [x,z] of [[-13,-5],[14,-28],[-48,14],[38,5],[0,48]]){
 const box=new THREE.Mesh(new THREE.BoxGeometry(4,1.2,1.1),concreteMat);box.position.set(x,.6,z);box.castShadow=true;scene.add(box);
}
function soldier(color){let root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.62,.8,.34),new THREE.MeshStandardMaterial({color}));body.position.y=1.5;body.castShadow=true;root.add(body);let head=new THREE.Mesh(new THREE.SphereGeometry(.22,12,10),new THREE.MeshStandardMaterial({color:0xb58d70}));head.position.y=2.1;root.add(head);let helmet=new THREE.Mesh(new THREE.SphereGeometry(.25,12,8),new THREE.MeshStandardMaterial({color:0x394b3a}));helmet.position.y=2.27;root.add(helmet);let ls=[];for(let s of [-1,1]){let leg=new THREE.Group();leg.position.set(s*.18,1.12,0);let m=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.55,4,8),new THREE.MeshStandardMaterial({color}));m.position.y=-.32;leg.add(m);let boot=new THREE.Mesh(new THREE.BoxGeometry(.23,.14,.38),new THREE.MeshStandardMaterial({color:0x20231e}));boot.position.set(0,-.65,-.06);leg.add(boot);root.add(leg);ls.push(leg)}let armMat=new THREE.MeshStandardMaterial({color});let arms=[];for(let side of [-1,1]){let arm=new THREE.Group();arm.position.set(side*.39,1.72,-.03);let fore=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.48,4,8),armMat);fore.rotation.x=-.55;fore.position.set(0,-.25,-.12);arm.add(fore);root.add(arm);arms.push(arm)}let gun=new THREE.Mesh(new THREE.BoxGeometry(.14,.14,.92),new THREE.MeshStandardMaterial({color:0x141916,metalness:.65,roughness:.3}));gun.position.set(.3,1.55,-.53);root.add(gun);let muzzle=new THREE.PointLight(0xffb34d,0,3);muzzle.position.set(.3,1.55,-1.05);root.add(muzzle);scene.add(root);return {root,legs:ls,arms,gun,muzzle,body}}
player=soldier(0x405d43);player.root.position.set(0,0,18);
let driving=false;
const jeep=new THREE.Group();
const jeepBody=new THREE.Mesh(new THREE.BoxGeometry(2.05,.72,3.1),new THREE.MeshStandardMaterial({color:0x526b3d,metalness:.18,roughness:.72}));
jeepBody.position.y=.85;jeep.add(jeepBody);
const jeepCab=new THREE.Mesh(new THREE.BoxGeometry(1.65,.85,1.55),new THREE.MeshStandardMaterial({color:0x344b38,roughness:.6}));
jeepCab.position.set(0,1.55,-.15);jeep.add(jeepCab);
const glass=new THREE.Mesh(new THREE.BoxGeometry(1.5,.55,.06),new THREE.MeshStandardMaterial({color:0x8ba7a0,transparent:true,opacity:.65,metalness:.2}));
glass.position.set(0,1.62,-.94);jeep.add(glass);
const tireMat=new THREE.MeshStandardMaterial({color:0x171a18,roughness:1});
for(const x of [-1.05,1.05])for(const z of [-.98,.98]){let w=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.28,12),tireMat);w.rotation.z=Math.PI/2;w.position.set(x,.48,z);jeep.add(w)}
jeep.visible=false;scene.add(jeep);
$('vehicleBtn').onclick=()=>{driving=!driving;player.root.visible=!driving;jeep.visible=driving;$('vehicleBtn').textContent=driving?'EXIT':'DRIVE';if(driving){jeep.position.copy(player.root.position);jeep.rotation.y=player.root.rotation.y;showNotice('MINI JEEP · DRIVE')}else{player.root.position.x+=1.8;showNotice('ON FOOT')}};
clock=new THREE.Clock();bots=[];for(let i=0;i<10;i++){let b=soldier(0x83463c);b.root.position.set((Math.random()-.5)*110,0,-28-Math.random()*115);b.hp=100;b.alive=true;b.respawnAt=0;bots.push(b)}
}
function connectGame(mode='training'){
 if(mode==='training'){if(gameSocket){gameSocket.close();gameSocket=null}
 $('netStatus').textContent='TRAINING READY';$('netPlayers').textContent='Players: 1 + '+bots.length+' bots';$('toast').textContent='';$('toast').style.display='none';return}
 if(offlineMode){$('netStatus').textContent='SERVER REQUIRED';$('netPlayers').textContent='Players: not detected';$('toast').textContent='HOTSPOT MATCH NEEDS HOST SERVER';return}let scheme=location.protocol==='https:'?'wss':'ws',url=`${scheme}://${location.host}/game?token=${encodeURIComponent(token)}&gameId=${encodeURIComponent(user?.gameId||'')}&displayName=${encodeURIComponent(user?.displayName||'Player')}`;gameSocket=new WebSocket(url);$('toast').textContent='Connecting to match…';gameSocket.onopen=()=>{$('toast').textContent='HOTSPOT MATCH CONNECTED';$('netStatus').textContent='CONNECTED';};gameSocket.onmessage=e=>{let d=JSON.parse(e.data);if(d.type==='welcome'){player.root.position.set(d.x,0,d.z);$('toast').textContent=d.team+' TEAM'}if(d.type==='state'){let ids=new Set(),blue=0,red=0;d.players.forEach(p=>{if(p.team==='BLUE')blue++;else red++;if(p.gameId===user.gameId){hp=p.hp;kills=p.kills}else{ids.add(p.id);let r=remotes.get(p.id);if(!r){r={...makeRemote(p),id:p.id};remotes.set(p.id,r)}r.x=p.x;r.z=p.z;r.team=p.team}});for(let id of remotes.keys())if(!ids.has(id)){scene.remove(remotes.get(id).root);remotes.delete(id)}$('teamBlue').textContent='BLUE '+blue;$('teamRed').textContent='RED '+red;$('aliveCount').textContent='ALIVE '+d.players.length;$('netPlayers').textContent='Players connected: '+d.players.length;$('netStatus').textContent='HOTSPOT SERVER ONLINE';$('gameHp').textContent='HP '+hp;$('gameKill').textContent='KILLS '+kills};if(d.type==='kill'&&d.killer){$('toast').textContent=d.killer===user.gameId?'ELIMINATION +0.50 TOKEN':'PLAYER ELIMINATED';refresh()}};gameSocket.onclose=()=>{$('netStatus').textContent='DISCONNECTED';$('netPlayers').textContent='Players: 0';$('toast').textContent='Disconnected from host'};
}
function makeRemote(p){let r=soldier(p.team==='BLUE'?0x427bb0:0x9a4940);r.x=p.x;r.z=p.z;return r}
function sendMove(){if(gameSocket?.readyState===1)gameSocket.send(JSON.stringify({type:'move',x:player.root.position.x,z:player.root.position.z,hp}))}
function updateAmmo(){$('ammo').textContent='AMMO ∞'}
function applyEquippedGun(){if(!player?.gun)return;let colors={starter:0x202522,ak47:0x7c5737,m416:0x333c3d,shotgun:0x54463b,scar:0x343d36,sniper:0x343a43};player.gun.material.color.setHex(colors[user?.equipped]||0x202522);player.gun.scale.set(user?.equipped==='shotgun'?1.35:1,user?.equipped==='sniper'?1.12:1,user?.equipped==='sniper'?1.35:1)}
function makeShot(){if(!player||!scene)return;let dir=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));dir.applyAxisAngle(new THREE.Vector3(0,1,0),0).normalize();let start=player.root.position.clone().add(new THREE.Vector3(0,1.58,0)).add(dir.clone().multiplyScalar(.8));let end=start.clone().add(dir.clone().multiplyScalar(42));let geo=new THREE.BufferGeometry().setFromPoints([start,end]);let line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffd78a,transparent:true,opacity:.9}));scene.add(line);shots.push({line,life:.09});player.muzzle.intensity=3.8;setTimeout(()=>{if(player?.muzzle)player.muzzle.intensity=0},65);if(navigator.vibrate&&settings.vibration)navigator.vibrate(18);
// Local training bots use hit points; each confirmed elimination increments the kill counter.
if(offlineMode){let hit=bots.find(b=>b.alive&&(()=>{let to=b.root.position.clone().sub(start);let dist=to.length();to.y=0;return dist<48&&to.normalize().dot(dir)>.975})());if(hit){hit.hp-=34;if(hit.hp<=0){hit.alive=false;hit.root.visible=false;hit.respawnAt=performance.now()+6500;kills++;$('gameKill').textContent='KILLS '+kills;showNotice('ENEMY ELIMINATED · +1 KILL');$('aliveCount').textContent='ALIVE '+(bots.filter(b=>b.alive).length+1)}else{showNotice('HIT · '+hit.hp+' HP LEFT')}}}}
function shoot(){if(!gameRunning||fireWait>0||reloadTimer>0)return;fireWait=.18;updateAmmo();makeShot();if(gameSocket?.readyState===1)gameSocket.send(JSON.stringify({type:'shoot',yaw,gunId:user?.equipped||'starter'}))}
$('fire').onpointerdown=e=>{e.preventDefault();fireHeld=true;shoot()};$('fire').onpointerup=$('fire').onpointercancel=$('fire').onpointerleave=()=>{fireHeld=false};

$('aim').onpointerdown=e=>{e.preventDefault();aiming=!aiming;camera.fov=aiming?48:65;camera.updateProjectionMatrix()};
$('jump').onpointerdown=e=>{e.preventDefault();if(gameRunning&&onGround){jumpVelocity=7.2;jumpHeight=0;onGround=false;player.root.userData.jumpStarted=performance.now();showNotice('JUMP!')}};
let sprintHeld=false,forwardHeld=false;
$('runBtn').onpointerdown=e=>{e.preventDefault();sprintHeld=true;$('runBtn').textContent='RUN ON'};
$('runBtn').onpointerup=$('runBtn').onpointercancel=$('runBtn').onpointerleave=()=>{sprintHeld=false;$('runBtn').textContent='RUN'};
$('forwardBtn').onpointerdown=e=>{e.preventDefault();forwardHeld=true;move.y=-1};
$('forwardBtn').onpointerup=$('forwardBtn').onpointercancel=$('forwardBtn').onpointerleave=()=>{forwardHeld=false;if(move.y===-1)move.y=0};

let stickOn=false,stickPointer=null,stickOrigin={x:0,y:0};const stick=$('stick'),nub=$('nub');
function stickMove(e){
 const dx=e.clientX-stickOrigin.x,dy=e.clientY-stickOrigin.y,l=Math.hypot(dx,dy),radius=Math.max(24,stick.clientWidth/2-22),k=Math.min(radius,l)/(l||1);
 const nx=dx*k,ny=dy*k;
 move={x:nx/radius,y:ny/radius};
 const center=stick.clientWidth/2;nub.style.left=(center+nx-nub.offsetWidth/2)+'px';nub.style.top=(center+ny-nub.offsetHeight/2)+'px';
}
function stickEnd(){
 stickOn=false;stickPointer=null;move={x:0,y:0};
 nub.style.left=((stick.clientWidth-nub.offsetWidth)/2)+'px';nub.style.top=((stick.clientHeight-nub.offsetHeight)/2)+'px';
}
stick.addEventListener('pointerdown',e=>{
 e.preventDefault();e.stopPropagation();stickOn=true;stickPointer=e.pointerId;
 const r=stick.getBoundingClientRect();stickOrigin={x:r.left+r.width/2,y:r.top+r.height/2};
 try{stick.setPointerCapture(e.pointerId)}catch{}
 stickMove(e);
});
stick.addEventListener('pointermove',e=>{if(stickOn&&e.pointerId===stickPointer){e.preventDefault();stickMove(e)}});
stick.addEventListener('pointerup',e=>{if(e.pointerId===stickPointer)stickEnd()});
stick.addEventListener('pointercancel',stickEnd);
let look=false,lx=0,ly=0;
$('gameWrap').addEventListener('pointerdown',e=>{
 if(e.target!==$('game')||e.clientX<innerWidth*.48)return;
 look=true;lx=e.clientX;ly=e.clientY;
});
$('gameWrap').addEventListener('pointermove',e=>{
 if(!look)return;let dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;
 let sens=(Number(settings.sensitivity)||50)/50;yaw-=dx*.006*sens;pitch=Math.max(-.1,Math.min(.6,pitch+dy*.003*sens));
});
$('gameWrap').addEventListener('pointerup',()=>look=false);
$('gameWrap').addEventListener('pointercancel',()=>look=false);
function animate(){if(!gameRunning)return;requestAnimationFrame(animate);let dt=Math.min(clock.getDelta(),.04),now=performance.now();if(!onGround){jumpVelocity-=18*dt;jumpHeight+=jumpVelocity*dt;if(jumpHeight<=0){jumpHeight=0;jumpVelocity=0;onGround=true}}fireWait=Math.max(0,fireWait-dt);if(fireHeld&&fireWait<=0)shoot();let forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));let v=new THREE.Vector3().addScaledVector(forward,-move.y).addScaledVector(right,move.x);if(v.length()>1)v.normalize();player.root.position.addScaledVector(v,(driving?11:(sprintHeld?9:5))*dt);let moving=v.lengthSq()>.01;
if(driving){jeep.position.copy(player.root.position);jeep.position.y=.03;jeep.rotation.y=moving?Math.atan2(-v.x,-v.z):player.root.rotation.y;}
bots.forEach((b,i)=>{if(!b.alive){if(performance.now()>=b.respawnAt){b.alive=true;b.hp=100;b.root.visible=true;b.root.position.set((Math.random()-.5)*76,0,(Math.random()-.5)*110)}return}
let dx=player.root.position.x-b.root.position.x,dz=player.root.position.z-b.root.position.z,dist=Math.hypot(dx,dz);
if(dist>5&&dist<58){b.root.position.x+=(dx/(dist||1))*dt*(.65+(i%3)*.15);b.root.position.z+=(dz/(dist||1))*dt*(.65+(i%3)*.15);b.root.rotation.y=Math.atan2(-dx,-dz)}
});$('aliveCount').textContent='ALIVE '+(bots.filter(b=>b.alive).length+1);if(moving)player.root.rotation.y=Math.atan2(-v.x,-v.z);idlePhase+=dt;let swing=moving?Math.sin(now*.012)*.72:Math.sin(idlePhase*2.2)*.025;player.legs[0].rotation.x=swing;player.legs[1].rotation.x=-swing;player.arms[0].rotation.x=moving?-.12+Math.sin(now*.012)*.13:-.10;player.arms[1].rotation.x=moving?-.18-Math.sin(now*.012)*.13:-.16;player.root.position.y=jumpHeight+(moving?Math.abs(Math.sin(now*.012))*.025:Math.sin(idlePhase*2)*.012);player.root.scale.y=1+Math.sin(idlePhase*2)*.003;
shots=shots.filter(s=>{s.life-=dt;if(s.life<=0){scene.remove(s.line);s.line.geometry.dispose();s.line.material.dispose();return false}s.line.material.opacity=Math.max(0,s.life/.09);return true});remotes.forEach(p=>{p.root.position.lerp(new THREE.Vector3(p.x,0,p.z),.3)});
// Camera follows the same forward/right axes as the joystick, preventing mirrored steering.
let back=forward.clone().multiplyScalar(-4.8),off=back.add(new THREE.Vector3(0,2.8+pitch*2,0));camera.position.lerp(player.root.position.clone().add(new THREE.Vector3(0,1.3,0)).add(off),.18);camera.lookAt(player.root.position.clone().add(forward.clone().multiplyScalar(8)).add(new THREE.Vector3(0,1.4-pitch*3,0)));if(gameSocket?.readyState===1)sendMove();let mc=$('mini').getContext('2d');mc.clearRect(0,0,200,200);mc.fillStyle='#233c2b';mc.fillRect(0,0,200,200);mc.strokeStyle='#657d5d';for(let n=0;n<=200;n+=25){mc.beginPath();mc.moveTo(n,0);mc.lineTo(n,200);mc.stroke();mc.beginPath();mc.moveTo(0,n);mc.lineTo(200,n);mc.stroke()}const dot=(x,z,col)=>{mc.fillStyle=col;mc.beginPath();mc.arc(100+(x-player.root.position.x)*1.2,100+(z-player.root.position.z)*1.2,4,0,Math.PI*2);mc.fill()};remotes.forEach(p=>dot(p.x,p.z,p.team==='BLUE'?'#62baff':'#ff665d'));bots.forEach(b=>dot(b.root.position.x,b.root.position.z,'#ff6258'));dot(player.root.position.x,player.root.position.z,'#fff');renderer.render(scene,camera)}
function stopGame(){gameRunning=false;fallback2D=false;cancelAnimationFrame(fallbackFrame);window.removeEventListener('keydown',fallbackKeyDown);window.removeEventListener('keyup',fallbackKeyUp);if(gameSocket)gameSocket.close();$('gameWrap').classList.add('hidden');$('app').classList.remove('hidden');refresh()}
$('exitGame').onclick=stopGame;
async function launchMode(mode){
 matchMode=mode;
 $('trainingBtn').disabled=true;$('hotspotBtn').disabled=true;
 try{await startGame(mode)}finally{$('trainingBtn').disabled=false;$('hotspotBtn').disabled=false}
}

$('startModeBtn').addEventListener('click',()=>{$('modePicker').classList.remove('hidden')});
$('closeModePicker').addEventListener('click',()=>{$('modePicker').classList.add('hidden')});
$('modePicker').addEventListener('click',e=>{if(e.target===$('modePicker'))$('modePicker').classList.add('hidden')});

$('trainingBtn').onclick=async()=>{
 $('modePicker').classList.add('hidden');
 $('trainingBtn').disabled=true;
 $('appMsg').textContent='Starting Training…';
 try{await launchMode('training')}
 catch(e){$('appMsg').textContent='Could not start Training: '+(e?.message||e)}
 finally{$('trainingBtn').disabled=false}
};
function openPage(id){document.querySelectorAll('.tabPage').forEach(x=>x.classList.toggle('hidden',x.id!==id));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===id))}
$('hotspotBtn').onclick=()=>{$('modePicker').classList.add('hidden');openPage('hotspotPage');beginHotspotLobby()};
$('musicOpen').onclick=()=>openPage('musicPage');
window.addEventListener('resize',()=>{if(renderer&&camera){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}});


let lobbySocket=null,hotspotIsHost=false,hotspotPlayers=[];
function beginHotspotLobby(){
 $('hotspotStatus').textContent='Connecting…';$('hotspotCount').textContent='0';
 $('hotspotPlayers').textContent='Waiting for server confirmation…';
 $('hostRole').textContent='Host permission: checking with server';
 $('hostStartMatch').disabled=true;
 if(offlineMode){$('hotspotStatus').textContent='NOT CONNECTED';$('hotspotCount').textContent='0';$('hostRole').textContent='Host permission: not verified';$('hotspotPlayers').textContent='No RNR Host Server detected. The hotspot owner must run the Node.js host server; all players then open the same local game URL.';return}
 try{
  if(lobbySocket)lobbySocket.close();
  const scheme=location.protocol==='https:'?'wss':'ws';
  lobbySocket=new WebSocket(`${scheme}://${location.host}/lobby?token=${encodeURIComponent(token)}&gameId=${encodeURIComponent(user?.gameId||'')}&displayName=${encodeURIComponent(user?.displayName||'Player')}`);
  lobbySocket.onopen=()=>{$('hotspotStatus').textContent='Connected to lobby server';lobbySocket.send(JSON.stringify({type:'lobby_join'}))};
  lobbySocket.onmessage=e=>{
   let d;try{d=JSON.parse(e.data)}catch{return}
   if(d.type==='match_started'){
    if(lobbySocket){lobbySocket.close();lobbySocket=null;}
    launchMode('hotspot');
    return;
   }
   if(d.type==='lobby_state'||d.type==='players'){
    hotspotPlayers=Array.isArray(d.players)?d.players:[];
    hotspotIsHost=!!d.isHost;
    $('hotspotCount').textContent=String(hotspotPlayers.length);
    $('hotspotStatus').textContent='HOTSPOT LOBBY ONLINE';
    $('hostRole').textContent=hotspotIsHost?'Host permission: YOU CAN START':'Host permission: waiting for hotspot host';
    $('hostStartMatch').disabled=!hotspotIsHost;
    $('hotspotPlayers').innerHTML='';
    if(!hotspotPlayers.length)$('hotspotPlayers').textContent='No players connected yet.';
    hotspotPlayers.forEach(p=>{
      const row=document.createElement('div');row.className='row';
      const name=document.createElement('span');name.textContent=(p.displayName||p.username||'Player')+' · '+(p.gameId||'-----');
      const status=document.createElement('span');status.textContent=p.online?'CONNECTED':'WAITING';
      row.append(name,status);$('hotspotPlayers').append(row);
    });
   }
  };
  lobbySocket.onerror=()=>{$('hotspotStatus').textContent='Server not available';$('hostRole').textContent='Host permission: not confirmed'};
  lobbySocket.onclose=()=>{if($('hotspotStatus').textContent!=='HOTSPOT LOBBY ONLINE')$('hotspotStatus').textContent='Disconnected'};
 }catch(e){$('hotspotStatus').textContent='Unable to connect'}
}
$('hostStartMatch').onclick=()=>{
 if(!hotspotIsHost||!lobbySocket||lobbySocket.readyState!==1)return;
 lobbySocket.send(JSON.stringify({type:'start_match'}));
 lobbySocket.close();lobbySocket=null;
 launchMode('hotspot');
};

// Restore the previous signed-in session automatically on the same device/browser.
(async function restoreSavedLogin(){
 let saved='';
 try{saved=localStorage.getItem(sessionKey)||''}catch(e){}
 if(saved){$('authMsg').textContent='Restoring your saved login…'}
 if(saved && offlineMode && saved.startsWith('local-')){
   try{localStorage.setItem('rnr_local_session',saved.slice(6))}catch(e){}
 }
 if(!saved && offlineMode){
   const existing=localCurrent();
   if(existing) saved='local-'+existing.gameId;
 }
 if(!saved)return;
 token=saved;
 try{
   const data=await api('/api/me');
   enter({token,user:data.user});
  }catch(e){
   token='';user=null;
   try{localStorage.removeItem(sessionKey)}catch(_){}
   // If the server session expired, ask the player to log in again.
 }
})();


let selectedMusic=[],musicIndex=0;
$('musicFiles').addEventListener('change',()=>{
 selectedMusic=Array.from($('musicFiles').files||[]).filter(f=>f.type.startsWith('audio/'));musicIndex=0;
 $('musicName').textContent=selectedMusic.length?selectedMusic.map(f=>f.name).join(' · '):'No music selected';
 if(selectedMusic.length)playSelectedMusic();
});
let currentMusicUrl='';
async function playSelectedMusic(){
 if(!selectedMusic.length)return;
 const a=$('gameAudio');
 if(currentMusicUrl)URL.revokeObjectURL(currentMusicUrl);
 currentMusicUrl=URL.createObjectURL(selectedMusic[musicIndex]);
 a.src=currentMusicUrl;a.volume=Number($('musicVolume').value);a.loop=false;
 try{await a.play();$('musicName').textContent='▶ Playing in background: '+selectedMusic[musicIndex].name}
 catch(e){$('musicName').textContent='Song added: '+selectedMusic[musicIndex].name+' · Tap PLAY to start'}
}
$('musicPlay').onclick=async()=>{
 if(!selectedMusic.length){$('musicFiles').click();return}
 if(!$('gameAudio').src)await playSelectedMusic();
 else {try{await $('gameAudio').play();$('musicName').textContent='▶ Playing in background'}catch(e){$('musicName').textContent='Tap PLAY again to allow audio'}}
};
$('musicPause').onclick=()=>$('gameAudio').pause();
$('musicStop').onclick=()=>{$('gameAudio').pause();$('gameAudio').currentTime=0};
$('musicVolume').oninput=()=>{$('gameAudio').volume=Number($('musicVolume').value)};
$('gameAudio').addEventListener('ended',()=>{if(selectedMusic.length){musicIndex=(musicIndex+1)%selectedMusic.length;playSelectedMusic()}});

// Block casual text copying and context menu; Game ID has its own explicit copy button.
document.addEventListener('contextmenu',e=>{if(!e.target.closest('input,textarea,select'))e.preventDefault()});
document.addEventListener('copy',e=>{if(!e.target.closest('#copyGameId,input,textarea'))e.preventDefault()});
document.addEventListener('cut',e=>{if(!e.target.closest('input,textarea'))e.preventDefault()});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['c','x','a','s','u'].includes(e.key.toLowerCase())&&!e.target.closest('input,textarea'))e.preventDefault()});
// Prevent accidental browser zooming (pinch, double-tap, Ctrl+wheel) during gameplay.
// Browser/OS accessibility overrides may still permit zoom on some devices.
(function lockPageZoom(){
  const stop=e=>e.preventDefault();
  ['gesturestart','gesturechange','gestureend'].forEach(type=>document.addEventListener(type,stop,{passive:false}));
  document.addEventListener('touchmove',e=>{if(e.touches && e.touches.length>1) e.preventDefault();},{passive:false});
  let lastTouchEnd=0;
  document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<=300)e.preventDefault();lastTouchEnd=now;},{passive:false});
  document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{passive:false});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['+','-','=','0'].includes(e.key))e.preventDefault();});
})();
