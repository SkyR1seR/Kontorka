// Подключение игрового сервера к HTTP-серверу: WebSocket на /ws и тик 30 Гц.
// Используется выделенным сервером (server/index.js) и dev-сервером Vite.
import { WebSocketServer } from 'ws';

const TICK = 1 / 30;

export function attachGameServer(httpServer, core, { path = '/ws' } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const onUpgrade = (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== path) return; // остальные апгрейды (например, HMR Vite) не трогаем
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  httpServer.on('upgrade', onUpgrade);

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

  // Тик 30 Гц с накоплением времени
  let last = process.hrtime.bigint();
  let acc = 0;
  const timer = setInterval(() => {
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

  return {
    close() {
      clearInterval(timer);
      httpServer.off('upgrade', onUpgrade);
      wss.close();
    },
  };
}
