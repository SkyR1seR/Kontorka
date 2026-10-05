// Выделенный сервер «ООО «Конторка»: Проверка»: раздаёт собранный клиент (dist/)
// и держит WebSocket /ws. Сервер-авторитетная симуляция с тиком 30 Гц (TZ 4).
//
// Переменные окружения:
//   PORT=8080             порт HTTP/WebSocket
//   KONTORKA_DEV=1        разрешить тестовые лобби с ботами (режим разработчика)
//   KONTORKA_REGION=...   название региона в лобби
//   KONTORKA_NAME=...     имя сервера
//   KONTORKA_ICE='[...]'  ICE-серверы WebRTC (JSON), например со своим TURN
//   KONTORKA_LOGS=logs    каталог журналов матчей
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ServerCore } from '../src/shared/server-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8080);
const DEV = process.env.KONTORKA_DEV === '1';
const LOG_DIR = path.resolve(ROOT, process.env.KONTORKA_LOGS || 'logs');
const TICK = 1 / 30;

let iceServers = null;
if (process.env.KONTORKA_ICE) {
  try { iceServers = JSON.parse(process.env.KONTORKA_ICE); } catch { console.warn('KONTORKA_ICE: не удалось разобрать JSON'); }
}

fs.mkdirSync(LOG_DIR, { recursive: true });
const CRITICAL = new Set(['room_created', 'room_start', 'match_start', 'shift_start', 'shift_end', 'sabotage', 'incident_discovered',
  'incident_resolved', 'meeting_start', 'decision', 'order', 'match_end', 'player_left', 'task_done', 'task_fail', 'work_cancel',
  'trick_plant', 'trick_fake_task', 'accel_explode', 'debiki_crisis']);
const logStreams = new Map();
function logEvent(code, e) {
  if (!CRITICAL.has(e.kind)) return;
  let s = logStreams.get(code);
  if (!s) {
    const day = new Date().toISOString().slice(0, 10);
    s = fs.createWriteStream(path.join(LOG_DIR, `${day}-${encodeURIComponent(code)}.jsonl`), { flags: 'a' });
    logStreams.set(code, s);
  }
  s.write(`${JSON.stringify({ at: new Date().toISOString(), room: code, ...e })}\n`);
  if (e.kind === 'match_end' || e.kind === 'room_start') console.log(`[${code}] ${e.kind}`, e.outcome || e.seed || '');
}

const core = new ServerCore({
  dev: DEV, iceServers,
  region: process.env.KONTORKA_REGION || 'EU-Центр',
  serverName: process.env.KONTORKA_NAME || 'Конторка-1',
  log: logEvent,
});

// ---------------------------------------------------------------- static
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: core.rooms.size, clients: core.clients.size, dev: DEV }));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(DIST, 'index.html');
    fs.readFile(target, (e2, data) => {
      if (e2) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Клиент не собран. Выполните: npm run build');
        return;
      }
      const ext = path.extname(target);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      res.end(data);
    });
  });
});

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  let alive = true;
  const connId = core.connect({
    send: (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    close: () => ws.close(),
  });
  // Ограничение частоты сообщений от клиента
  let budget = 60;
  const refill = setInterval(() => { budget = Math.min(90, budget + 45); }, 1000);
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { core.message(connId, msg); } catch (e) { console.error('message error', e); }
  });
  ws.on('pong', () => { alive = true; });
  const hb = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }, 15000);
  ws.on('close', () => {
    clearInterval(refill);
    clearInterval(hb);
    core.disconnect(connId);
  });
});

// ---------------------------------------------------------------- tick 30 Гц
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  let steps = 0;
  while (acc >= TICK && steps < 5) {
    try { core.tick(TICK); } catch (e) { console.error('tick error', e); }
    acc -= TICK;
    steps++;
  }
  if (acc > 0.5) acc = 0;
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`ООО «Конторка»: Проверка — сервер на http://localhost:${PORT} (WebSocket /ws)${DEV ? ' [режим разработчика: боты разрешены]' : ''}`);
});
