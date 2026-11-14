
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, "index.html");

  if (req.url === "/" && fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("RNR Battle Arena Server is running");
});

const wss = new WebSocket.Server({ noServer: true });

const lobbyPlayers = new Map();
const gamePlayers = new Map();

let hostId = null;
let matchStarted = false;

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastLobby() {
  const players = Array.from(lobbyPlayers.values()).map(p => ({
    gameId: p.gameId,
    displayName: p.displayName,
    isHost: p.gameId === hostId
  }));

  for (const player of lobbyPlayers.values()) {
    send(player.ws, {
      type: "lobby_state",
      players,
      isHost: player.gameId === hostId,
      matchStarted
    });
  }
}

function broadcastGame() {
  const players = Array.from(gamePlayers.values()).map(p => ({
    id: p.gameId,
    gameId: p.gameId,
    displayName: p.displayName,
    x: p.x,
    z: p.z,
    hp: p.hp,
    kills: p.kills,
    team: p.team
  }));

  for (const player of gamePlayers.values()) {
    send(player.ws, { type: "state", players });
  }
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;

  if (route !== "/lobby" && route !== "/game") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.route = route;
    ws.gameId = url.searchParams.get("gameId") || "";
    ws.displayName = url.searchParams.get("displayName") || "Player";
    ws.token = url.searchParams.get("token") || "";
    wss.emit("connection", ws);
  });
});

wss.on("connection", ws => {
  const gameId = ws.gameId;

  if (!/^\d{5}$/.test(gameId) || ws.token !== `local-${gameId}`) {
    send(ws, { type: "error", message: "Invalid player login" });
    ws.close();
    return;
  }

  if (ws.route === "/lobby") {
    if (lobbyPlayers.has(gameId)) {
      send(ws, { type: "error", message: "This Game ID is already connected" });
      ws.close();
      return;
    }

    if (!hostId) hostId = gameId;

    lobbyPlayers.set(gameId, {
      ws,
      gameId,
      displayName: ws.displayName
    });

    broadcastLobby();

    ws.on("message", raw => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "start_match" && gameId === hostId) {
        matchStarted = true;

        for (const player of lobbyPlayers.values()) {
          send(player.ws, { type: "match_started" });
        }
      }
    });

    ws.on("close", () => {
      lobbyPlayers.delete(gameId);

      if (hostId === gameId) {
        hostId = lobbyPlayers.keys().next().value || null;
      }

      if (lobbyPlayers.size === 0) {
        hostId = null;
        matchStarted = false;
      }

      broadcastLobby();
    });

    return;
  }

  if (ws.route === "/game") {
    if (gamePlayers.has(gameId)) {
      send(ws, { type: "error", message: "This player is already in the game" });
      ws.close();
      return;
    }

    const player = {
      ws,
      gameId,
      displayName: ws.displayName,
      x: Math.random() * 20 - 10,
      z: Math.random() * 20 - 10,
      hp: 100,
      kills: 0,
      team: 1
    };

    gamePlayers.set(gameId, player);

    send(ws, { type: "welcome", gameId });
    broadcastGame();

    ws.on("message", raw => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "move") {
        player.x = Number(data.x) || player.x;
        player.z = Number(data.z) || player.z;
        broadcastGame();
      }

      if (data.type === "shoot") {
        const target = gamePlayers.get(String(data.targetId || ""));

        if (target && target.gameId !== gameId) {
          target.hp = Math.max(0, target.hp - 25);

          if (target.hp === 0) {
            player.kills++;
            target.hp = 100;
          }

          broadcastGame();
          send(target.ws, { type: "hit", hp: target.hp });
          send(ws, { type: "kill", kills: player.kills });
        }
      }
    });

    ws.on("close", () => {
      gamePlayers.delete(gameId);
      broadcastGame();
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RNR Battle Arena server running on port ${PORT}`);
});
    
