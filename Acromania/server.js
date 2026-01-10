import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.redirect("/tv.html"));
app.get("/tv", (req, res) => res.redirect("/tv.html"));
app.get("/phone", (req, res) => res.redirect("/phone.html"));

const server = http.createServer(app);

// Keep a simple lobby state in memory
const clients = new Map(); // ws -> { username, role }
const usernames = new Set();

function broadcastLobby() {
  const list = [...usernames].sort((a, b) => a.localeCompare(b));
  const payload = JSON.stringify({ type: "lobby", users: list, count: list.length });

  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  clients.set(ws, { username: null, role: "unknown" });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Bad JSON" }));
      return;
    }

    // TV registers so it can receive lobby updates immediately
    if (msg.type === "hello" && msg.role === "tv") {
      clients.set(ws, { username: null, role: "tv" });
      ws.send(JSON.stringify({ type: "ok", role: "tv" }));
      broadcastLobby();
      return;
    }

    // Phone tries to join with a username
    if (msg.type === "join" && typeof msg.username === "string") {
      const desired = msg.username.trim();

      if (!desired) {
        ws.send(JSON.stringify({ type: "join_denied", reason: "Empty name" }));
        return;
      }

      // Simple rules so it behaves nicely on a couch party setup
      if (desired.length > 16) {
        ws.send(JSON.stringify({ type: "join_denied", reason: "Name too long (max 16)" }));
        return;
      }

      const normalized = desired.toLowerCase();

      // Enforce uniqueness case-insensitively
      for (const u of usernames) {
        if (u.toLowerCase() === normalized) {
          ws.send(JSON.stringify({ type: "join_denied", reason: "Name already taken" }));
          return;
        }
      }

      // If this socket already had a name, remove it
      const prev = clients.get(ws)?.username;
      if (prev) usernames.delete(prev);

      clients.set(ws, { username: desired, role: "phone" });
      usernames.add(desired);

      ws.send(JSON.stringify({ type: "join_ok", username: desired }));
      broadcastLobby();
      return;
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    if (info?.username) usernames.delete(info.username);
    clients.delete(ws);
    broadcastLobby();
  });

  ws.on("error", () => {
    // Ignore; close handler will clean up
  });
});

// Railway assigns the port dynamically
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
