// Сетевое соединение: WebSocket к выделенному серверу (основной режим)
// или локальный сервер в браузере (только режим разработчика с ботами).
import { PROTOCOL_VERSION } from '../shared/game.js';
import { settings, storageGet, storageSet } from './settings.js';

const TOKEN_KEY = 'kontorka.token';

class Emitter {
  constructor() { this.handlers = new Set(); this.status = new Set(); }
  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onStatus(fn) { this.status.add(fn); return () => this.status.delete(fn); }
  emit(msg) { for (const fn of this.handlers) { try { fn(msg); } catch (e) { console.error(e); } } }
  emitStatus(s) { for (const fn of this.status) fn(s); }
}

export function wsUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export class WsConnection extends Emitter {
  constructor(url) {
    super();
    this.url = url;
    this.queue = [];
    this.retry = 0;
    this.closedByUser = false;
    this.rtt = null;
    this.open = false;
    this._connect();
    this._ping = setInterval(() => this.send({ t: 'ping', ts: performance.now(), rtt: this.rtt }), 2000);
  }

  _connect() {
    this.emitStatus(this.retry ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.retry = 0;
      this.emitStatus('open');
      ws.send(JSON.stringify(helloMsg()));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'pong') { this.rtt = performance.now() - msg.ts; return; }
      if (msg.t === 'welcome') storageSet(TOKEN_KEY, msg.token);
      this.emit(msg);
    };
    ws.onclose = () => {
      this.open = false;
      if (this.closedByUser) return;
      this.emitStatus('closed');
      this._scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  _scheduleReconnect() {
    this.retry++;
    const delay = Math.min(8000, 500 * 2 ** Math.min(4, this.retry));
    setTimeout(() => { if (!this.closedByUser) this._connect(); }, delay);
  }

  send(msg) {
    if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping' && msg.t !== 'mv') this.queue.push(msg);
  }

  close() {
    this.closedByUser = true;
    clearInterval(this._ping);
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

// Локальный сервер в браузере — для тестов с ботами (?dev=1)
export class LocalConnection extends Emitter {
  constructor() {
    super();
    this.rtt = 0;
    this.ready = import('../shared/server-core.js').then(({ ServerCore }) => {
      this.core = new ServerCore({ dev: true, region: 'Локально', serverName: 'Браузер', log: (code, e) => { if (e.kind === 'match_end' || e.kind === 'room_start') console.info('[local]', code, e); } });
      this.connId = this.core.connect({
        send: (msg) => {
          const copy = structuredClone(msg);
          queueMicrotask(() => this.emit(copy));
        },
        close: () => {},
      });
      let last = performance.now();
      this._tick = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.core.tick(dt);
      }, 1000 / 30);
      this.emitStatus('open');
      this.send(helloMsg());
    });
  }

  send(msg) {
    if (!this.core) { this.ready.then(() => this.send(msg)); return; }
    if (msg.t === 'ping') return;
    this.core.message(this.connId, structuredClone(msg));
  }

  close() { clearInterval(this._tick); }
}

function helloMsg() {
  return { t: 'hello', name: settings.name || 'Батракан', token: storageGet(TOKEN_KEY), version: PROTOCOL_VERSION };
}
