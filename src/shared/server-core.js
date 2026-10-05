// Ядро сервера: лобби (комнаты), подключения, переподключение, маршрутизация.
// Используется Node-сервером (WebSocket) и, в режиме разработчика, прямо в браузере.
import { Game, PROTOCOL_VERSION } from './game.js';
import { STAFF, MATCH_LENGTHS, ROLES } from './content.js';
import { randomSeed } from './rng.js';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;
const RECONNECT_WINDOW = 90;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeToken() {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export class Room {
  constructor(core, { code, isPublic, dev }) {
    this.core = core;
    this.code = code;
    this.isPublic = !!isPublic;
    this.dev = !!dev;
    this.members = [];
    this.hostId = null;
    this.state = 'lobby';
    this.game = null;
    this.settings = { maxPlayers: 8, length: 'standard', bots: 7 };
    this.chat = [];
    this.createdAt = Date.now();
    this.resultAt = 0;
  }

  get humanCount() { return this.members.length; }

  summary() {
    return {
      code: this.code, host: this.members.find((m) => m.id === this.hostId)?.name || '—',
      count: this.members.length, max: this.settings.maxPlayers, length: this.settings.length,
      state: this.state, isPublic: this.isPublic,
    };
  }

  lobbyState() {
    return {
      t: 'lobby', code: this.code, isPublic: this.isPublic, dev: this.dev, hostId: this.hostId, state: this.state,
      settings: this.settings, minPlayers: this.dev ? 1 : MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      members: this.members.map((m) => ({
        id: m.id, name: m.name, staff: m.staff, ready: m.ready, connected: m.connected, ping: m.ping ?? null,
        rolePref: this.dev ? m.rolePref : undefined,
      })),
      chat: this.chat.slice(-30),
      lengths: Object.fromEntries(Object.entries(MATCH_LENGTHS).filter(([, v]) => this.dev || !v.devOnly).map(([k, v]) => [k, v.name])),
    };
  }

  broadcastLobby() {
    const st = this.lobbyState();
    for (const m of this.members) if (m.connected) this.core.sendTo(m.id, st);
  }

  freeStaff() {
    const used = new Set(this.members.map((m) => m.staff));
    return STAFF.map((_, i) => i).filter((i) => !used.has(i));
  }

  addMember(client) {
    if (this.state !== 'lobby') return 'Матч уже идёт';
    if (this.members.length >= this.settings.maxPlayers) return 'Лобби заполнено';
    const free = this.freeStaff();
    const staff = free.length ? free[Math.floor(Math.random() * free.length)] : 0;
    const m = { id: client.id, name: client.name, token: client.token, staff, ready: false, connected: true, ping: null, rolePref: null };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    client.room = this;
    this.addChat(null, `${m.name} вошёл в лобби`);
    this.broadcastLobby();
    return null;
  }

  removeMember(id, reason = 'вышел') {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    if (this.game && this.state !== 'lobby') this.game.playerLeft(id);
    this.members = this.members.filter((x) => x !== m);
    if (this.hostId === id) this.hostId = this.members[0]?.id || null;
    this.addChat(null, `${m.name} ${reason}`);
    const c = this.core.clients.get(id);
    if (c && c.room === this) c.room = null;
    this.broadcastLobby();
    if (!this.members.length) this.core.removeRoom(this);
  }

  addChat(from, text) {
    this.chat.push({ from, text, at: Date.now() });
    if (this.chat.length > 60) this.chat.shift();
  }

  handle(client, msg) {
    const m = this.members.find((x) => x.id === client.id);
    if (!m) return;
    const isHost = this.hostId === m.id;
    if (this.state === 'game') {
      if (msg.t === 'to_lobby') return;
      this.game.handle(m.id, msg);
      return;
    }
    if (this.state === 'result') {
      if (msg.t === 'to_lobby') this.returnToLobby();
      return;
    }
    switch (msg.t) {
      case 'lobby_ready':
        m.ready = !!msg.ready;
        this.broadcastLobby();
        break;
      case 'lobby_staff': {
        const s = Number(msg.staff);
        if (Number.isInteger(s) && s >= 0 && s < STAFF.length && !this.members.some((x) => x !== m && x.staff === s)) {
          m.staff = s;
          this.broadcastLobby();
        }
        break;
      }
      case 'lobby_settings':
        if (!isHost) return;
        if (msg.settings) {
          const s = msg.settings;
          if (Number.isInteger(s.maxPlayers)) this.settings.maxPlayers = Math.max(Math.max(MIN_PLAYERS, this.members.length), Math.min(MAX_PLAYERS, s.maxPlayers));
          if (MATCH_LENGTHS[s.length] && (this.dev || !MATCH_LENGTHS[s.length].devOnly)) this.settings.length = s.length;
          if (this.dev && Number.isInteger(s.bots)) this.settings.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, s.bots));
          if (typeof s.isPublic === 'boolean') this.isPublic = s.isPublic;
          for (const x of this.members) if (x !== m) x.ready = false;
          this.broadcastLobby();
        }
        break;
      case 'lobby_role':
        if (!this.dev) return;
        m.rolePref = ROLES[msg.role] ? msg.role : null;
        this.broadcastLobby();
        break;
      case 'lobby_kick':
        if (!isHost || msg.id === m.id) return;
        this.core.sendTo(msg.id, { t: 'kicked' });
        this.removeMember(msg.id, 'исключён хостом');
        break;
      case 'lobby_chat': {
        const text = String(msg.text || '').trim().slice(0, 200);
        if (!text) return;
        this.addChat(m.name, text);
        this.broadcastLobby();
        break;
      }
      case 'lobby_start':
        if (!isHost) return;
        this.tryStart(m);
        break;
      default:
    }
  }

  tryStart(host) {
    const humans = this.members.filter((x) => x.connected);
    const minPlayers = this.dev ? 1 : MIN_PLAYERS;
    if (humans.length < minPlayers) {
      this.core.sendTo(host.id, { t: 'error', text: `Нужно минимум ${MIN_PLAYERS} игроков (сейчас ${humans.length})` });
      return;
    }
    const notReady = humans.filter((x) => !x.ready && x.id !== host.id);
    if (notReady.length) {
      this.core.sendTo(host.id, { t: 'error', text: `Не готовы: ${notReady.map((x) => x.name).join(', ')}` });
      return;
    }
    const members = humans.map((x) => ({ id: x.id, name: x.name, staff: x.staff, isBot: false, rolePref: this.dev ? x.rolePref : null }));
    if (this.dev) {
      const total = Math.min(MAX_PLAYERS, members.length + this.settings.bots);
      const used = new Set(members.map((x) => x.staff));
      const free = STAFF.map((_, i) => i).filter((i) => !used.has(i));
      for (let i = members.length; i < total; i++) {
        const staff = free.shift() ?? i % STAFF.length;
        members.push({ id: `bot${i}`, name: STAFF[staff].name, staff, isBot: true });
      }
    }
    this.state = 'game';
    const seed = randomSeed();
    this.game = new Game({
      members, seed,
      settings: { length: this.settings.length, dev: this.dev },
      send: (id, msg) => this.core.sendTo(id, msg),
      onEnd: () => { this.state = 'result'; this.resultAt = Date.now(); },
      log: (e) => this.core.log(this.code, e),
    });
    this.core.log(this.code, { kind: 'room_start', seed, members: members.length });
    for (const x of this.members) x.ready = false;
    this.game.start();
  }

  returnToLobby() {
    if (this.state === 'lobby') return;
    this.state = 'lobby';
    this.game = null;
    // Отключившиеся за время матча покидают лобби
    for (const m of this.members.slice()) if (!m.connected) this.removeMember(m.id, 'отключился');
    this.broadcastLobby();
  }

  tick(dt) {
    if (this.state === 'game' || this.state === 'result') {
      if (this.game) this.game.tick(dt);
      if (this.state === 'result' && Date.now() - this.resultAt > 120000) this.returnToLobby();
    }
    // Удаляем из лобби давно отключившихся
    if (this.state === 'lobby') {
      for (const m of this.members.slice()) {
        if (!m.connected && Date.now() - (m.disconnectedAt || 0) > RECONNECT_WINDOW * 1000) this.removeMember(m.id, 'отключился');
      }
    }
  }

  onDisconnect(id) {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    m.connected = false;
    m.disconnectedAt = Date.now();
    if (this.state === 'game' && this.game) this.game.setConnected(id, false);
    if (this.state === 'lobby') {
      // В лобби ждём недолго, затем удаляем (см. tick)
      this.broadcastLobby();
    }
  }

  onReconnect(client) {
    const m = this.members.find((x) => x.token === client.token);
    if (!m) return false;
    const oldId = m.id;
    // Сохраняем идентификатор игрока: клиент получает прежний id
    client.id = oldId;
    m.connected = true;
    m.disconnectedAt = null;
    client.room = this;
    if ((this.state === 'game' || this.state === 'result') && this.game) this.game.setConnected(oldId, true);
    this.broadcastLobby();
    return true;
  }
}

export class ServerCore {
  constructor({ dev = false, region = 'EU-Центр', serverName = 'Конторка-1', log, iceServers = null } = {}) {
    this.dev = dev;
    this.iceServers = iceServers;
    this.region = region;
    this.serverName = serverName;
    this.clients = new Map(); // id -> client
    this.conns = new Map(); // connId -> client
    this.rooms = new Map();
    this.logFn = log || (() => {});
    this._nextId = 1;
  }

  log(code, e) { this.logFn(code, e); }

  // transport: { send(msg), close() }
  connect(transport) {
    const connId = `c${this._nextId++}`;
    const client = { connId, id: null, name: null, token: null, transport, room: null, version: null };
    this.conns.set(connId, client);
    return connId;
  }

  disconnect(connId) {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    if (c.id && this.clients.get(c.id) === c) {
      this.clients.delete(c.id);
      if (c.room) c.room.onDisconnect(c.id);
    }
  }

  sendTo(id, msg) {
    const c = this.clients.get(id);
    if (c) c.transport.send(msg);
  }

  newCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  removeRoom(room) { this.rooms.delete(room.code); }

  findRoomByToken(token) {
    if (!token) return null;
    for (const r of this.rooms.values()) if (r.members.some((m) => m.token === token)) return r;
    return null;
  }

  message(connId, msg) {
    const c = this.conns.get(connId);
    if (!c || !msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') { c.transport.send({ t: 'pong', ts: msg.ts }); if (c.room && c.id) { const m = c.room.members.find((x) => x.id === c.id); if (m && Number.isFinite(msg.rtt)) m.ping = Math.round(msg.rtt); } return; }
    if (msg.t === 'hello') return this._hello(c, msg);
    if (!c.id) return c.transport.send({ t: 'error', text: 'Сначала представьтесь' });
    switch (msg.t) {
      case 'list_lobbies':
        c.transport.send({ t: 'lobbies', list: [...this.rooms.values()].filter((r) => r.isPublic).map((r) => r.summary()) });
        return;
      case 'create_lobby': {
        if (c.room) c.room.removeMember(c.id);
        const dev = this.dev && !!msg.dev;
        const room = new Room(this, { code: this.newCode(), isPublic: !!msg.isPublic, dev });
        if (msg.settings) {
          if (MATCH_LENGTHS[msg.settings.length] && (dev || !MATCH_LENGTHS[msg.settings.length].devOnly)) room.settings.length = msg.settings.length;
          if (Number.isInteger(msg.settings.maxPlayers)) room.settings.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, msg.settings.maxPlayers));
        }
        this.rooms.set(room.code, room);
        room.addMember(c);
        this.log(room.code, { kind: 'room_created', by: c.name, dev });
        return;
      }
      case 'join_lobby': {
        const code = normalizeCode(msg.code);
        const room = this.rooms.get(code);
        if (!room) return c.transport.send({ t: 'error', text: `Лобби «${code}» не найдено` });
        if (c.room === room) return room.broadcastLobby();
        if (c.room) c.room.removeMember(c.id);
        const err = room.addMember(c);
        if (err) c.transport.send({ t: 'error', text: err });
        return;
      }
      case 'leave_lobby':
        if (c.room) c.room.removeMember(c.id);
        c.transport.send({ t: 'left' });
        return;
      // Сигнализация WebRTC для голосового чата: пересылка внутри комнаты
      case 'rtc': {
        if (!c.room || typeof msg.to !== 'string') return;
        if (!c.room.members.some((m) => m.id === msg.to)) return;
        const size = JSON.stringify(msg.data || {}).length;
        if (size > 20000) return;
        this.sendTo(msg.to, { t: 'rtc', from: c.id, data: msg.data });
        return;
      }
      case 'ptt': {
        if (!c.room) return;
        for (const m of c.room.members) if (m.id !== c.id && m.connected) this.sendTo(m.id, { t: 'ptt', from: c.id, on: !!msg.on });
        return;
      }
      case 'rename': {
        const name = sanitizeName(msg.name);
        if (!name) return;
        c.name = name;
        if (c.room && c.room.state === 'lobby') {
          const m = c.room.members.find((x) => x.id === c.id);
          if (m) { m.name = name; c.room.broadcastLobby(); }
        }
        return;
      }
      default:
        if (c.room) c.room.handle(c, msg);
    }
  }

  _hello(c, msg) {
    if (msg.version !== PROTOCOL_VERSION) {
      c.transport.send({ t: 'error', fatal: true, text: `Версия клиента устарела (клиент ${msg.version}, сервер ${PROTOCOL_VERSION}). Обновите страницу.` });
      return;
    }
    c.name = sanitizeName(msg.name) || 'Батракан';
    c.version = msg.version;
    // Переподключение по токену (90 секунд сохраняется роль и состояние)
    const room = this.findRoomByToken(msg.token);
    if (room) {
      const m = room.members.find((x) => x.token === msg.token);
      const prev = this.clients.get(m.id);
      if (prev && prev !== c) {
        prev.transport.send({ t: 'error', fatal: true, text: 'Вы подключились из другой вкладки' });
        prev.transport.close();
        this.conns.delete(prev.connId);
      }
      // Сначала регистрируем клиента и шлём welcome, затем — состояние матча
      c.token = msg.token;
      c.id = m.id;
      this.clients.set(c.id, c);
      c.transport.send({ t: 'welcome', id: c.id, token: c.token, region: this.region, server: this.serverName, dev: this.dev, version: PROTOCOL_VERSION, rejoined: room.code, iceServers: this.iceServers });
      room.onReconnect(c);
      return;
    }
    c.id = `p${this._nextId++}`;
    c.token = makeToken();
    this.clients.set(c.id, c);
    c.transport.send({ t: 'welcome', id: c.id, token: c.token, region: this.region, server: this.serverName, dev: this.dev, version: PROTOCOL_VERSION, iceServers: this.iceServers });
  }

  tick(dt) {
    for (const r of this.rooms.values()) r.tick(dt);
  }
}

// Код лобби: латиница и цифры; кириллические двойники переводим в латиницу
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };
function normalizeCode(c) {
  return String(c || '').toUpperCase().trim().replace(/[АВЕКМНОРСТХУ]/g, (ch) => LOOKALIKE[ch] || ch).replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function sanitizeName(n) {
  return String(n || '').replace(/[<>\n\r\t]/g, '').trim().slice(0, 18);
}
