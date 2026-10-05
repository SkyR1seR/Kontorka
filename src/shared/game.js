// Серверная (авторитетная) логика матча «ООО «Конторка»: Проверка».
// Клиенты присылают намерения, сервер валидирует действия, прогресс задач,
// саботаж, планёрки и вычисляет победные условия (TZ 4).
import { makeRng } from './rng.js';
import {
  MapRuntime, STATIONS, STATION_BY_ID, ZONES, ZONE_BY_ID, DOORS, DOOR_BY_ID, MEETING_SEATS, SPAWN_POINTS,
  zoneAt, USE_RADIUS, nearestDoor, FURN_BY_ID,
} from './map.js';
import {
  ROLES, COMPOSITION, MATCH_LENGTHS, BALANCE, TASKS, TASK_BY_ID, buildTaskSteps, stepMinigame,
  SABOTAGES, SABOTAGE_BY_ID, SOCIAL_TRICKS, ORDERS, FORGED_ORDERS, ALL_ORDER_BY_ID, STAFF,
  OWNER_STAMP, FORGED_STAMPS,
} from './content.js';
import { fmtClock, nameVars, declineName } from './text.js';
import { BotBrain } from './bots.js';

export const PROTOCOL_VERSION = 3;
const OFFICE_SPANS = [[9 * 60, 12 * 60], [13 * 60, 16 * 60], [16 * 60 + 15, 18 * 60]];
const SNAP_RATE = 15;
const CART_HOME = { x: 41, z: 34.8 };
const ANIM_CODES = { idle: 0, walk: 1, work: 2, sit: 3, carry: 4, wave: 5, panic: 6, fired: 7, drink: 8 };
export { ANIM_CODES };

let uidCounter = 1;
const uid = (p) => `${p}${(uidCounter++).toString(36)}`;

export class Game {
  constructor({ members, settings, seed, send, onEnd, log }) {
    this.settings = { length: 'standard', dev: false, ...settings };
    this.len = MATCH_LENGTHS[this.settings.length] || MATCH_LENGTHS.standard;
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.send = send || (() => {});
    this.onEnd = onEnd || (() => {});
    this.logFn = log || (() => {});
    this.map = new MapRuntime();
    this.t = 0;
    this.players = new Map();
    this.order = null;
    this.originalOrder = null;
    this.incidents = [];
    this.items = [];
    this.matchLog = [];
    this.publicLog = [];
    this.kassaLog = [];
    this.decisions = [];
    this.dark = {};
    this.dim = {};
    this.broken = {};
    this.sealed = new Set();
    this.stationSeen = {};
    this.debiki = 10;
    this.krediki = 10;
    this.plan = { points: 0, target: 1 };
    this.costs = { stolen: 0, wrongFire: 0, explosions: 0 };
    this.sanctionsLeft = BALANCE.directorSanctions;
    this.worldVersion = 1;
    this.shift = 0;
    this.shiftClock = 0;
    this.shiftDur = 1;
    this.phase = { name: 'intro', sub: 'role', end: BALANCE.introRole };
    this.meeting = null;
    this.accel = null;
    this.ended = false;
    this.result = null;
    this._snapAcc = 0;
    this._visAcc = 0;
    this._seenAcc = 0;
    this._histAcc = 0;
    this._econAcc = 0;
    this.vis = new Map();
    this.audible = new Map();
    this.smoke = {};
    this.items.push({ id: 'cart', kind: 'cart', x: CART_HOME.x, z: CART_HOME.z, carriedBy: null, home: true });
    this._setupPlayers(members);
    this._assignRoles();
    this._computePlanTarget();
    this.logEvent('match_start', { seed: this.seed, players: [...this.players.values()].map((p) => ({ id: p.id, role: p.role, bot: p.isBot })) });
  }

  // ------------------------------------------------------------------ setup
  _setupPlayers(members) {
    const used = new Set(members.filter((m) => m.staff != null).map((m) => m.staff));
    const free = STAFF.map((_, i) => i).filter((i) => !used.has(i));
    members.forEach((m, i) => {
      let staff = m.staff;
      if (staff == null || staff < 0 || staff >= STAFF.length) staff = free.shift() ?? i % STAFF.length;
      const st = STAFF[staff];
      const sp = SPAWN_POINTS[i % SPAWN_POINTS.length];
      const p = {
        id: m.id, name: m.name || st.name, staff, gender: st.g, isBot: !!m.isBot,
        connected: !m.isBot, disconnectedAt: null,
        role: null, team: null, x: sp.x, z: sp.z, rot: sp.rot, anim: 'idle', moving: false,
        lastMoveT: 0, lastInputT: 0, idleSince: 0, alive: true, left: false, firedAt: null,
        tasks: [], work: null, carry: null, kukishi: 0, promises: 0, tasksDone: 0, shiftTasksDone: 0,
        repairs: 0, sabotagesDone: 0, failedTasks: 0, sab: null, checks: 0, calls: 0, bellUsed: false,
        restricted: null, greeted: false, ate: false, coffeeAt: -999, afk: false, hist: [],
        lastChatT: -9, rolePref: m.rolePref || null, checksDone: [], pendingCheck: null,
        speech: null, seat: 0, penalty: 0, frozenUntil: 0,
      };
      if (p.isBot) p.brain = new BotBrain(this, p, makeRng(this.seed ^ ((i + 1) * 7919)));
      this.players.set(p.id, p);
    });
  }

  _assignRoles() {
    const list = [...this.players.values()];
    const n = list.length;
    const comp = COMPOSITION[Math.max(6, Math.min(12, n))] || [1, 1, 1, Math.max(0, n - 3)];
    let [dir, vred, spec] = comp;
    if (n < 6) { dir = 1; vred = 1; spec = n >= 4 ? 1 : 0; }
    const roles = [];
    roles.push('director');
    for (let i = 0; i < vred; i++) roles.push('vreditel');
    const specials = this.rng.shuffle(['alesya', 'dusya']);
    for (let i = 0; i < spec; i++) roles.push(specials[i % 2]);
    while (roles.length < n) roles.push('batrakan');
    roles.length = n;
    // В режиме разработчика можно задать роль заранее
    const pool = this.rng.shuffle(roles);
    const assigned = new Map();
    for (const p of list) {
      if (p.rolePref && pool.includes(p.rolePref)) {
        pool.splice(pool.indexOf(p.rolePref), 1);
        assigned.set(p.id, p.rolePref);
      }
    }
    for (const p of this.rng.shuffle(list)) {
      if (!assigned.has(p.id)) assigned.set(p.id, pool.shift());
    }
    const sabLoad = this.rng.shuffle(SABOTAGES.map((s) => s.id));
    let li = 0;
    for (const p of list) {
      p.role = assigned.get(p.id);
      p.team = ROLES[p.role].team;
      if (p.role === 'vreditel') {
        const loadout = [];
        // Всегда хотя бы один «быстрый» объектный саботаж
        while (loadout.length < 3) {
          const id = sabLoad[li++ % sabLoad.length];
          if (!loadout.includes(id)) loadout.push(id);
        }
        p.sab = { loadout, trick: this.rng.pick(SOCIAL_TRICKS).id, trickUsed: false, cdUntil: 20 };
      }
      if (p.role === 'alesya') p.checks = BALANCE.alesyaChecks;
      if (p.role === 'director') p.calls = BALANCE.directorCalls;
    }
  }

  _tasksPerShift(p, shiftIdx) {
    const k = this.len.tasksPerShift[shiftIdx];
    return p.role === 'director' ? Math.max(1, k - 2) : k;
  }

  _computePlanTarget() {
    let total = 0;
    for (const p of this.players.values()) {
      for (let s = 0; s < 3; s++) total += this._tasksPerShift(p, s) * 1.15;
    }
    this.plan.target = Math.max(4, Math.round(total * BALANCE.planFactor));
  }

  // ------------------------------------------------------------- utilities
  get alivePlayers() { return [...this.players.values()].filter((p) => p.alive && !p.left); }
  get humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  oc() {
    const span = OFFICE_SPANS[Math.max(0, this.shift - 1)] || OFFICE_SPANS[0];
    if (this.shift === 0) return span[0];
    return span[0] + Math.min(1, this.shiftClock / this.shiftDur) * (span[1] - span[0]);
  }
  clock() { return fmtClock(this.oc()); }
  dirty() { this.worldVersion++; }

  logEvent(kind, data = {}) {
    const e = { t: +this.t.toFixed(2), oc: this.clock(), kind, ...data };
    this.matchLog.push(e);
    this.logFn(e);
  }

  pub(text, kind = 'info') {
    this.publicLog.push({ oc: this.clock(), text, kind });
    if (this.publicLog.length > 40) this.publicLog.shift();
    this.dirty();
  }

  toAll(msg) { for (const p of this.players.values()) if (!p.isBot && !p.left) this.send(p.id, msg); }
  to(p, msg) { if (p && !p.isBot && !p.left) this.send(p.id, msg); }
  notice(p, text, kind = 'info') { this.to(p, { t: 'notice', text, kind }); }
  noticeAll(text, kind = 'info') { this.toAll({ t: 'notice', text, kind }); }

  zoneDark(zone) { return (this.dark[zone] || 0) > this.t; }

  // -------------------------------------------------------------- lifecycle
  start() {
    for (const p of this.players.values()) this.sendInit(p);
    this.toAll({ t: 'phase', phase: this.publicPhase() });
  }

  sendInit(p) {
    if (p.isBot) return;
    this.to(p, {
      t: 'init', you: p.id, seed: this.seed, settings: this.settings, version: PROTOCOL_VERSION,
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, staff: q.staff, gender: q.gender, bot: q.isBot })),
      planTarget: this.plan.target,
    });
    this.to(p, { t: 'role', ...this.privateRole(p) });
    this.to(p, { t: 'phase', phase: this.publicPhase() });
    this.to(p, { t: 'world', w: this.worldState() });
    this.to(p, { t: 'tp', x: p.x, z: p.z, rot: p.rot });
    if (this.order) this.to(p, { t: 'order', order: this.publicOrder(), silent: true });
    if (this.meeting) this.to(p, { t: 'meeting', m: this.publicMeeting() });
    if (this.result) this.to(p, { t: 'result', r: this.result });
  }

  privateRole(p) {
    const r = ROLES[p.role];
    const allies = p.role === 'vreditel' && this.players.size >= 8
      ? [...this.players.values()].filter((q) => q.role === 'vreditel' && q.id !== p.id).map((q) => q.id)
      : [];
    return {
      role: p.role, roleName: r.name, team: r.team, goal: r.goal, rules: r.rules, example: r.example, allies,
      sab: p.sab ? { loadout: p.sab.loadout, trick: p.sab.trick } : null,
    };
  }

  publicPhase() {
    const ph = this.phase;
    return {
      name: ph.name, sub: ph.sub || null, shift: this.shift,
      left: Math.max(0, (ph.end ?? 0) - (ph.name === 'work' ? this.shiftClock : this.t)),
      dur: ph.name === 'work' ? this.shiftDur : null,
    };
  }

  tick(dt) {
    if (this.ended && this.phase.name === 'final') { this._tickFinal(dt); return; }
    this.t += dt;
    const ph = this.phase;
    if (ph.name === 'intro') {
      if (this.t >= ph.end) {
        if (ph.sub === 'role') {
          this.phase = { name: 'intro', sub: 'order', end: this.t + BALANCE.introOrder };
          this._issueOrder(1);
          this.toAll({ t: 'phase', phase: this.publicPhase() });
        } else {
          this._startShift(ph.next || 1);
        }
      }
    } else if (ph.name === 'work') {
      this._tickWork(dt);
    } else if (ph.name === 'meeting') {
      this._tickMeeting(dt);
    } else if (ph.name === 'smoke') {
      if (this.t >= ph.end) this._endSmokeBreak();
    }
    for (const p of this.players.values()) if (p.brain) p.brain.tick(dt);
    this._tickConnections();
    this._snapAcc += dt;
    if (this._snapAcc >= 1 / SNAP_RATE) {
      this._snapAcc = 0;
      this._sendSnapshots();
    }
  }

  _tickFinal() { /* матч окончен — комната сама вернёт в лобби */ }

  _tickConnections() {
    for (const p of this.players.values()) {
      if (p.isBot || p.left || p.connected) continue;
      if (p.disconnectedAt != null && this.t - p.disconnectedAt > 90) {
        p.left = true;
        p.alive = false;
        this._dropCarry(p);
        this._redistributeTasks(p);
        this.pub(`${p.name} покинул${p.gender === 'f' ? 'а' : ''} Конторку (связь потеряна)`, 'warn');
        this.logEvent('player_left', { id: p.id });
        this._checkEarlyEnd();
      }
    }
  }

  // ---------------------------------------------------------------- shifts
  _startShift(n) {
    this.shift = n;
    this.shiftClock = 0;
    let dur = this.len.shifts[n - 1];
    if (this.order?.id === 'speedup') dur = Math.round(dur * 0.8);
    this.shiftDur = dur;
    this.phase = { name: 'work', end: dur };
    for (const p of this.players.values()) {
      p.shiftTasksDone = 0;
      p.greeted = false;
      p.ate = false;
      if (!p.alive) continue;
      const k = this._tasksPerShift(p, n - 1);
      for (let i = 0; i < k; i++) this._giveRandomTask(p);
      p.idleSince = this.t;
      if (p.sab) p.sab.cdUntil = Math.max(p.sab.cdUntil, this.t + 15);
    }
    this._applyOrderStart();
    this.logEvent('shift_start', { shift: n, dur });
    this.pub(`Шабашка №${n} началась`, 'phase');
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.dirty();
  }

  _giveRandomTask(p, opts = {}) {
    const have = new Set(p.tasks.map((t) => t.id));
    const pool = TASKS.filter((t) => !have.has(t.id) && (!opts.only || opts.only.includes(t.id)));
    if (!pool.length) return null;
    const def = this.rng.weighted(pool, (t) => (t.rare ? 0.35 : 1));
    return this._addTask(p, def.id, opts);
  }

  _addTask(p, taskId, opts = {}) {
    const def = TASK_BY_ID[taskId];
    let steps = opts.steps || buildTaskSteps(def, this.rng);
    if (this.order?.id === 'red_ban') steps = steps.map((s) => (s === 'arch_shelf_red' ? 'arch_shelf_n' : s));
    if (def.printer && this.order?.id === 'printer_permit') steps = ['dir_desk', ...steps];
    const task = {
      uid: uid('t'), id: def.id, name: opts.name || def.name, hint: opts.hint || def.hint, steps, step: 0,
      plan: opts.plan ?? def.plan ?? 1, forged: !!opts.forged, source: opts.source || 'Хозяин', extra: !!opts.extra,
      permit: def.printer && this.order?.id === 'printer_permit',
    };
    p.tasks.push(task);
    return task;
  }

  _endShift() {
    this._applyOrderEnd();
    this.logEvent('shift_end', { shift: this.shift, plan: this.plan.points });
    // Принудительно завершаем активные действия
    for (const p of this.players.values()) this._cancelWork(p, true);
    if (this.shift >= 3) {
      this._finish('time');
    } else {
      this._startMeeting('shift_end', null);
    }
  }

  _tickWork(dt) {
    this.shiftClock += dt;
    this._maybeLegitUpdate();
    this._tickLegitUpdate();
    this._tickTimers(dt);
    this._econAcc += dt;
    if (this._econAcc >= 1) { this._tickEconomy(this._econAcc); this._econAcc = 0; }
    this._visAcc += dt;
    if (this._visAcc >= 0.2) { this._visAcc = 0; this._computeVisibility(); }
    this._seenAcc += dt;
    if (this._seenAcc >= 0.5) { this._seenAcc = 0; this._trackStations(); }
    this._histAcc += dt;
    if (this._histAcc >= 1) {
      this._histAcc = 0;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        p.hist.push({ t: this.t, x: p.x, z: p.z, oc: this.oc() });
        if (p.hist.length > 240) p.hist.shift();
        // АФК: долгое отсутствие ввода от живого игрока
        if (!p.isBot && p.connected) {
          const afk = this.t - p.lastInputT > 120;
          if (afk !== p.afk) {
            p.afk = afk;
            if (afk) this.pub(`${p.name}: нет на рабочем месте (АФК)`, 'warn');
          }
        }
      }
    }
    // Бездействие (для дебиков и подозрительности)
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.moving || p.work) p.idleSince = this.t;
    }
    if (this.shiftClock >= this.phase.end) this._endShift();
  }

  _tickTimers() {
    // Свет
    for (const z of Object.keys(this.dark)) {
      if (this.dark[z] && this.dark[z] <= this.t) {
        delete this.dark[z];
        this.pub(`Свет ${ZONE_BY_ID[z].loc} восстановлен`);
        this.dirty();
      }
    }
    // Архив / тележка
    for (const inc of this.incidents) {
      if (!inc.open) continue;
      if (inc.type === 'archive_lock' && inc.until <= this.t) this._resolveIncident(inc, null, 'Архив отперт автоматически (истёк срок)');
      if (inc.type === 'cart_block' && inc.until <= this.t) this._resolveIncident(inc, null, 'Тележку откатили на место');
      if (inc.type === 'lights_off' && inc.until <= this.t) this._resolveIncident(inc, null, null);
      if (inc.type === 'kukishi_steal' && !inc.discovered && this.t - inc.t > 45) this._discover(inc, null, 'Кассовая сводка');
      if (inc.type === 'soup_spoil' && !inc.discovered && this.t - inc.t > 15) {
        this._discover(inc, null, 'Бидонья');
        this._npcSay('npc_bidonya', 'КТО ИСПОРТИЛ ЩИ?!');
      }
    }
    // Ускоритель
    if (this.accel && this.t >= this.accel.until) {
      const inc = this.incidents.find((i) => i.id === this.accel.inc);
      this.accel = null;
      if (inc && inc.open) {
        inc.open = false;
        inc.failed = true;
        inc.resolvedAt = this.clock();
        this.plan.points = Math.max(0, this.plan.points - 4);
        this.krediki += 20;
        this.debiki += 10;
        this.costs.explosions += 300;
        this.pub('КАЛОИДНЫЙ ВЫБРОС! План −4, кредики +20', 'alarm');
        this.toAll({ t: 'fx', kind: 'explosion', x: 49.5, z: 14 });
        this.logEvent('accel_explode', { inc: inc.id });
      }
      this.dirty();
    }
  }

  _tickEconomy(dt) {
    let idle = 0;
    for (const p of this.alivePlayers) {
      if (this.t - p.idleSince > BALANCE.idleSeconds && this.phase.name === 'work') idle++;
      if (p.restricted) {
        p.restricted.left -= dt;
        if (p.restricted.left <= 0) { p.restricted = null; this.notice(p, 'Ограничение доступа снято'); }
      }
    }
    this.debiki += idle * 0.02 * dt;
    const alive = this.alivePlayers.length || 1;
    const open = this.alivePlayers.reduce((s, p) => s + p.tasks.length, 0);
    if (open / alive > 4.5) this.krediki += 0.03 * dt;
    if (this.order?.id === 'f_coffee') this.debiki += 0.05 * dt;
    if (this.incidents.some((i) => i.type === 'soup_spoil' && i.open)) this.debiki += 0.03 * dt;
    this.debiki = Math.max(0, Math.min(100, this.debiki));
    this.krediki = Math.max(0, Math.min(100, this.krediki));
    if (this.krediki >= 100) { this._finish('krediki'); return; }
    if (this.debiki >= 100) this._startSmokeBreak();
    if ((this._econTick = (this._econTick || 0) + 1) % 2 === 0) this.dirty();
  }

  // Дебиковый кризис — принудительный перекур
  _startSmokeBreak() {
    for (const p of this.players.values()) this._cancelWork(p, true);
    this.phase = { name: 'smoke', end: this.t + 15, resume: this.shiftClock, workEnd: this.phase.end };
    const spots = [];
    for (let i = 0; i < 12; i++) spots.push({ x: 7 + (i % 4) * 2.4, z: 35.8 + Math.floor(i / 4) * 0.9 });
    this.alivePlayers.forEach((p, i) => this._teleport(p, spots[i].x, spots[i].z, 0));
    this.pub('ДЕБИКОВЫЙ КРИЗИС: всем на перекур в Столовую!', 'alarm');
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.logEvent('debiki_crisis');
  }

  _endSmokeBreak() {
    const ph = this.phase;
    this.debiki = 45;
    this.krediki = Math.min(100, this.krediki + 8);
    this.phase = { name: 'work', end: ph.workEnd };
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.dirty();
  }

  // ------------------------------------------------------------ visibility
  visionRange(p) {
    const z = zoneAt(p.x, p.z);
    if (this.zoneDark(z)) return BALANCE.visionDark;
    if (this.dim[z]) return 7;
    return BALANCE.visionRange;
  }

  canSee(a, b) {
    if (a === b) return true;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > this.visionRange(a)) return false;
    const zb = zoneAt(b.x, b.z);
    if (this.zoneDark(zb) && d > BALANCE.visionDark) return false;
    return this.map.lineOfSight(a.x, a.z, b.x, b.z);
  }

  _computeVisibility() {
    const list = [...this.players.values()].filter((p) => !p.left);
    for (const a of list) {
      const set = new Set([a.id]);
      const aud = {};
      for (const b of list) {
        if (a === b) continue;
        if (!b.alive && a.alive) continue; // уволенные невидимы для живых
        if (!a.alive || this.canSee(a, b)) set.add(b.id);
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 12) aud[b.id] = +(Math.max(0, 1 - d / 12) * (this.map.lineOfSight(a.x, a.z, b.x, b.z) ? 1 : 0.45)).toFixed(2);
      }
      const prev = this.vis.get(a.id);
      this.vis.set(a.id, set);
      this.audible.set(a.id, aud);
      if (a.brain) a.brain.observe(set, prev);
    }
  }

  // Отслеживание «последний раз видели исправным» и обнаружение инцидентов
  _trackStations() {
    const watchers = this.alivePlayers;
    const oc = this.oc();
    for (const st of SAB_STATIONS) {
      for (const p of watchers) {
        const d = Math.hypot(p.x - st.x, p.z - st.z);
        if (d > 8) continue;
        if (this.zoneDark(st.zone) && d > 3) continue;
        if (!this.map.lineOfSight(p.x, p.z, st.x, st.z)) continue;
        const inc = this.incidents.find((i) => i.open && i.station === st.id && !i.discovered && i.culprit !== p.id && DISCOVER_BY_SIGHT.has(i.type));
        if (inc && this.t - inc.t > 1) this._discover(inc, p);
        else if (!this.incidents.some((i) => i.open && i.station === st.id)) this.stationSeen[st.id] = oc;
      }
    }
    // Двери (тележка, запертый архив) и потерянная папка
    for (const inc of this.incidents) {
      if (!inc.open || inc.discovered) continue;
      let pt = null;
      if (inc.type === 'cart_block' || inc.type === 'archive_lock') pt = inc.doorPos || null;
      if (inc.type === 'folders_mix') {
        const it = this.items.find((i) => i.id === inc.item);
        if (it) pt = { x: it.x, z: it.z };
      }
      if (!pt) continue;
      for (const p of watchers) {
        if (p.id === inc.culprit) continue;
        const d = Math.hypot(p.x - pt.x, p.z - pt.z);
        if (d < 7 && this.map.lineOfSight(p.x, p.z, pt.x, pt.z)) { this._discover(inc, p); break; }
      }
    }
  }

  // ------------------------------------------------------------- snapshots
  _sendSnapshots() {
    const wv = this.worldVersion;
    for (const p of this.players.values()) {
      if (p.isBot || !p.connected || p.left) continue;
      const vis = this.vis.get(p.id);
      const ps = [];
      for (const q of this.players.values()) {
        if (q.left) continue;
        const visible = q === p || !vis || vis.has(q.id) || this.phase.name !== 'work';
        if (!visible) continue;
        if (!q.alive && p.alive && q !== p) continue;
        ps.push(this._packPlayer(q));
      }
      const msg = { t: 'snap', ps, me: this._me(p), ph: this.publicPhase(), clock: this.clock(), aud: this.audible.get(p.id) || {} };
      if (p._wv !== wv) { msg.w = this.worldState(); p._wv = wv; }
      this.send(p.id, msg);
    }
  }

  _packPlayer(q) {
    const st = q.work ? STATION_IDX[q.work.station] ?? -1 : -1;
    return [q.id, +q.x.toFixed(2), +q.z.toFixed(2), +q.rot.toFixed(2), ANIM_CODES[q.anim] ?? 0, st,
      q.carry || 0, (q.alive ? 0 : 1) | (q.speech && q.speech.until > this.t ? 2 : 0)];
  }

  _me(p) {
    return {
      tasks: p.tasks.map((t) => ({
        uid: t.uid, id: t.id, name: t.name, hint: t.hint, steps: t.steps, step: t.step, forged: t.forged,
        source: t.source, mg: stepMinigame(TASK_BY_ID[t.id] || { mg: 'stamp' }, t.step), plan: t.plan,
      })),
      work: p.work ? { kind: p.work.kind, station: p.work.station, start: p.work.start, min: p.work.min } : null,
      carry: p.carry, kukishi: p.kukishi, promises: p.promises, alive: p.alive,
      cd: p.sab ? Math.max(0, p.sab.cdUntil - this.t) : 0, trickUsed: p.sab?.trickUsed ?? false,
      restricted: p.restricted ? { zone: p.restricted.zone, left: Math.ceil(p.restricted.left) } : null,
      checks: p.checks, calls: p.calls, bellUsed: p.bellUsed, greeted: p.greeted, ate: p.ate,
      speed: this.speedOf(p), afk: p.afk, sanctionsLeft: p.role === 'director' ? this.sanctionsLeft : undefined,
    };
  }

  worldState() {
    const doors = {};
    for (const d of DOORS) {
      const s = this.map.doorState[d.id];
      if (s.locked || s.cart) doors[d.id] = s.cart ? 'cart' : (this.sealed.has(d.id) ? 'sealed' : 'locked');
    }
    const dark = {};
    for (const [z, until] of Object.entries(this.dark)) if (until > this.t) dark[z] = +(until - this.t).toFixed(1);
    return {
      plan: this.plan.points, planTarget: this.plan.target, debiki: Math.round(this.debiki), krediki: Math.round(this.krediki),
      order: this.publicOrder(), incidents: this.incidents.filter((i) => i.discovered).map((i) => this.publicIncident(i)),
      dark, dim: Object.keys(this.dim), doors, broken: this._publicBroken(),
      items: this.items.map((i) => ({ id: i.id, kind: i.kind, x: +i.x.toFixed(2), z: +i.z.toFixed(2), carriedBy: i.carriedBy })),
      alive: Object.fromEntries([...this.players.values()].map((p) => [p.id, p.alive && !p.left])),
      afk: [...this.players.values()].filter((p) => p.afk).map((p) => p.id),
      accel: this.accel ? { left: +(this.accel.until - this.t).toFixed(1), panels: [...this.accel.panels] } : null,
      log: this.publicLog.slice(-14), sanctionsLeft: this.sanctionsLeft,
    };
  }

  // Состояние поломок видно только после обнаружения инцидента
  _publicBroken() {
    const out = {};
    for (const [st, type] of Object.entries(this.broken)) {
      if (this.incidents.some((i) => i.open && i.discovered && i.station === st)) out[st] = type;
    }
    return out;
  }

  publicOrder() {
    if (!this.order) return null;
    const o = this.order;
    return { id: o.id, type: o.type, title: o.title, text: o.text, stamp: o.stamp, version: o.version || 1 };
  }

  publicIncident(i) {
    const st = STATION_BY_ID[i.station];
    return {
      id: i.id, type: i.type, name: i.name, obj: i.objName, zone: i.zone, zoneName: ZONE_BY_ID[i.zone]?.name, station: i.station,
      window: i.windowFrom && i.windowFrom !== i.windowTo ? `${i.windowFrom}–${i.windowTo}` : i.windowTo,
      open: i.open, failed: !!i.failed, traces: i.traces.slice(), audit: i.auditResult || null,
      x: st ? st.x : i.doorPos?.x, z: st ? st.z : i.doorPos?.z, shift: i.shift, resolvedBy: i.resolvedByName || null,
    };
  }

  // ------------------------------------------------------------- messages
  handle(pid, msg) {
    const p = this.players.get(pid);
    if (!p || p.left || !msg || typeof msg.t !== 'string') return;
    if (!p.isBot) p.lastInputT = this.t;
    if (p.afk && !p.isBot && msg.t !== 'ping') { p.afk = false; }
    switch (msg.t) {
      case 'mv': return this._onMove(p, msg);
      case 'interact': return this._onInteract(p, msg);
      case 'work_done': return this.finishWork(p, msg);
      case 'work_cancel': return this._cancelWork(p, false);
      case 'chat': return this._onChat(p, msg);
      case 'greet': return this._onGreet(p);
      case 'call_meeting': return this._onCallMeeting(p);
      case 'trick': return this._onTrick(p, msg);
      case 'vote': return this._onVote(p, msg);
      case 'skip_ready': return this._onSkipReady(p);
      case 'explain': return this._onExplain(p, msg);
      case 'decide': return this._onDecide(p, msg);
      case 'kassa_log': return this._onKassaLog(p);
      case 'dev': return this.settings.dev ? this._devCommand(p, msg) : undefined;
      default:
    }
  }

  speedOf(p) {
    let s = BALANCE.speed;
    if (this.debiki >= 60) s *= 0.85;
    if (p.carry === 'cart') s *= 0.72;
    if (!p.alive) s *= 1.3;
    return s;
  }

  _onMove(p, msg) {
    const canMove = this.phase.name === 'work' && !p.work && this.t >= p.frozenUntil;
    if (!canMove && p.alive) return;
    const x = Number(msg.x);
    const z = Number(msg.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dt = Math.max(0.03, Math.min(0.5, this.t - p.lastMoveT));
    const allowed = this.speedOf(p) * dt * 1.35 + 0.25;
    let nx = x;
    let nz = z;
    const d = Math.hypot(nx - p.x, nz - p.z);
    let corrected = false;
    if (d > allowed) {
      nx = p.x + ((nx - p.x) / d) * allowed;
      nz = p.z + ((nz - p.z) / d) * allowed;
      corrected = d > allowed + 0.6;
    }
    if (p.alive) {
      const c = this.map.collide(nx, nz);
      if (Math.hypot(c.x - nx, c.z - nz) > 0.15) corrected = true;
      nx = c.x;
      nz = c.z;
    }
    p.moving = Math.hypot(nx - p.x, nz - p.z) > 0.01;
    p.x = nx;
    p.z = nz;
    if (Number.isFinite(msg.rot)) p.rot = msg.rot;
    p.anim = p.carry === 'cart' ? 'carry' : (p.moving ? 'walk' : 'idle');
    if (msg.a === 'wave') p.anim = 'wave';
    p.lastMoveT = this.t;
    if (corrected) this.to(p, { t: 'tp', x: p.x, z: p.z, rot: p.rot, soft: true });
    const it = p.carry ? this.items.find((i) => i.carriedBy === p.id) : null;
    if (it) { it.x = p.x + Math.sin(p.rot) * 0.9; it.z = p.z + Math.cos(p.rot) * 0.9; this.dirty(); }
  }

  // Бот двигается через этот метод (с проверкой коллизий)
  botMove(p, x, z, rot) {
    const c = this.map.collide(x, z);
    p.moving = Math.hypot(c.x - p.x, c.z - p.z) > 0.005;
    p.x = c.x;
    p.z = c.z;
    p.rot = rot;
    p.anim = p.carry === 'cart' ? 'carry' : (p.moving ? 'walk' : 'idle');
    p.lastMoveT = this.t;
    const it = p.carry ? this.items.find((i) => i.carriedBy === p.id) : null;
    if (it) { it.x = p.x + Math.sin(p.rot) * 0.9; it.z = p.z + Math.cos(p.rot) * 0.9; }
  }

  _teleport(p, x, z, rot) {
    p.x = x; p.z = z; p.rot = rot; p.moving = false; p.anim = 'idle';
    this.to(p, { t: 'tp', x, z, rot });
    if (p.brain) p.brain.onTeleport();
  }

  // ------------------------------------------------------- interactions
  near(p, st, extra = 0) {
    return Math.hypot(p.x - st.x, p.z - st.z) <= USE_RADIUS + extra;
  }

  stationBusy(stId, except) {
    for (const q of this.players.values()) if (q !== except && q.work && q.work.station === stId) return true;
    return false;
  }

  // Причина, по которой станцию нельзя использовать для работы (или null)
  stationBlock(st, p, forTask) {
    if (p && p.restricted && p.restricted.zone === st.zone) return `Доступ ограничен Директором: ${ZONE_BY_ID[st.zone].name}`;
    const o = this.order?.id;
    if (this.broken[st.id]) return 'Объект неисправен';
    if (forTask) {
      if (st.id === 'arch_shelf_red' && o === 'red_ban') return 'Красный стеллаж опечатан';
      if (st.id.startsWith('tech_printer') && o === 'f_printers') return 'Принтеры на профилактике (по записюльке)';
      if (st.zone === 'kassa' && o === 'f_kassa' && p?.role !== 'dusya') return 'Касса только для Дуси (по записюльке)';
      if (st.zone === 'archive' && o === 'f_archive') return 'Архив закрыт на учёт (по записюльке)';
      if (forTask.archive && this.incidents.some((i) => i.open && i.type === 'folders_mix')) return 'Не хватает папки — кто-то перепутал папки';
      if (st.id === 'kassa_lockers' && this.incidents.some((i) => i.open && i.type === 'locker_lock')) return 'Шкапчики заперты';
      if (st.id === 'can_pot' && this.incidents.some((i) => i.open && i.type === 'soup_spoil')) return 'Щи испорчены';
    }
    return null;
  }

  _onInteract(p, msg) {
    if (this.phase.name !== 'work' || p.work || !p.alive || this.t < p.frozenUntil) return this._reject(p, null);
    const action = msg.action;
    if (action === 'task') return this._startTask(p, msg);
    if (action === 'repair') return this._startRepair(p, msg);
    if (action === 'sabotage') return this._startSabotage(p, msg);
    if (action === 'check') return this._startCheck(p, msg);
    if (action === 'bell') return this._ringBell(p, msg);
    if (action === 'coffee') return this._startSimple(p, msg, 'coffee', 'can_coffee', 3);
    if (action === 'eat') return this._startSimple(p, msg, 'eat', 'can_pot', 2);
    if (action === 'extra') return this._takeExtra(p, msg);
    if (action === 'pickup') return this._startPickup(p, msg);
    if (action === 'drop') return this._startDrop(p, msg);
    if (action === 'compare') return this._startCompare(p);
    return this._reject(p, 'Неизвестное действие');
  }

  _reject(p, reason) {
    if (reason) this.notice(p, reason, 'warn');
    this.to(p, { t: 'work_reject', reason });
    return false;
  }

  _beginWork(p, work) {
    p.work = { ...work, start: this.t };
    p.anim = 'work';
    this.logEvent('work_start', { id: p.id, kind: work.kind, station: work.station, uid: work.uid });
    p.moving = false;
    const st = STATION_BY_ID[work.station];
    if (st) {
      p.rot = st.rot;
      // Наблюдаемость: свидетели видят, кто и где взаимодействует
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const vis = this.vis.get(q.id);
        if (vis && vis.has(p.id)) {
          const ev = { t: 'seen', id: p.id, station: st.id, oc: this.clock(), kind: st.kind };
          if (q.brain) q.brain.onSeenInteraction(p, st, this.oc());
          else this.to(q, ev);
        }
      }
      this._emitSound(st.kind, st.x, st.z, p.id);
    }
    this.to(p, { t: 'work_start', work: { ...p.work } });
    return true;
  }

  _emitSound(kind, x, z, from) {
    for (const q of this.players.values()) {
      if (q.isBot || q.left || !q.connected) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < 16) this.send(q.id, { t: 'sound', kind, x, z, from });
    }
  }

  _startTask(p, msg) {
    const task = p.tasks.find((t) => t.uid === msg.uid);
    if (!task) return this._reject(p, 'Задача не найдена');
    const stId = task.steps[task.step];
    const st = STATION_BY_ID[stId];
    if (!st || stId !== msg.station) return this._reject(p, 'Не то место для этой задачи');
    if (!this.near(p, st)) return this._reject(p, 'Слишком далеко');
    if (this.stationBusy(stId, p)) return this._reject(p, 'Место занято');
    const def = TASK_BY_ID[task.id];
    const block = this.stationBlock(st, p, def || {});
    if (block) return this._reject(p, block);
    const mg = def ? stepMinigame(def, task.step) : 'stamp';
    let min = BALANCE.minTaskTime;
    if (mg === 'stamp' || mg === 'pickup') min = 1.0;
    if (task.permit && task.step === 0) min = 1.0;
    if (this.order?.id === 'no_chairs' && stId.startsWith('os_pc')) min *= 1.3;
    return this._beginWork(p, { kind: 'task', uid: task.uid, station: stId, min, mg });
  }

  _startSimple(p, msg, kind, stId, min) {
    const st = STATION_BY_ID[stId];
    if (!this.near(p, st)) return this._reject(p, 'Слишком далеко');
    if (kind === 'eat') {
      if (this.order?.id !== 'lunch') return this._reject(p, 'Обед не объявлен');
      if (p.ate) return this._reject(p, 'Ты уже поел' + (p.gender === 'f' ? 'а' : ''));
    }
    if (kind === 'coffee' && this.t - p.coffeeAt < 40) return this._reject(p, 'Кофе можно раз в 40 секунд');
    return this._beginWork(p, { kind, station: stId, min });
  }

  // Сравнение версий записюльки на доске поручений (подлинность печати)
  _startCompare(p) {
    const st = STATION_BY_ID.ent_board;
    if (!this.near(p, st)) return this._reject(p, 'Подойди к доске поручений');
    if (!this.order || (this.order.version || 1) < 2) return this._reject(p, 'На доске одна версия — сравнивать нечего');
    if (this.stationBusy(st.id, p)) return this._reject(p, 'Место занято');
    const prev = this.originalOrder || this.prevOrder || this.order;
    const data = { stampA: prev.stamp, stampB: this.order.stamp, titleA: prev.title, titleB: this.order.title };
    return this._beginWork(p, { kind: 'compare', station: st.id, min: 2.5, mg: 'compare', data });
  }

  _completeCompare(p, w, msg = {}) {
    const inc = this.incidents.find((i) => i.open && i.type === 'order_forge');
    const forged = !!(inc && this.order?.forged);
    const saidFake = msg.answer === 'fake';
    if (forged && saidFake) {
      this._resolveIncident(inc, p, `Записюлька оказалась подделкой! Восстановлена исходная — ${p.name}`);
      return true;
    }
    if (forged && !saidFake) { this.notice(p, 'Ты не заметил' + (p.gender === 'f' ? 'а' : '') + ' ничего подозрительного.', 'info'); return true; }
    if (!forged && saidFake) { this.notice(p, 'Печать подлинная — зря поднял' + (p.gender === 'f' ? 'а' : '') + ' шум.', 'warn'); return false; }
    this.notice(p, 'Печать подлинная: уточнение действительно от Хозяина.', 'good');
    return true;
  }

  // Подлинное уточнение записюльки посреди шабашки (чтобы «версия 2» не выдавала подделку)
  _maybeLegitUpdate() {
    if (this._legitPlanned === this.shift) return;
    this._legitPlanned = this.shift;
    this._legitAt = this.rng.chance(0.4) ? this.shiftDur * this.rng.range(0.35, 0.7) : null;
  }

  _tickLegitUpdate() {
    if (this._legitAt == null || this.shiftClock < this._legitAt) return;
    this._legitAt = null;
    if (!this.order || this.order.forged || this.incidents.some((i) => i.open && i.type === 'order_forge')) return;
    const pool = ORDERS.filter((o) => o.id !== this.order.id && !['speedup', 'kvadry_check', 'kukishi_urgent', 'lockers_inv', 'printer_permit'].includes(o.id));
    const o = this.rng.pick(pool);
    this._clearOrderEffects(this.order);
    this.prevOrder = this.order;
    this.order = { ...o, stamp: OWNER_STAMP, version: 2 };
    this._applyOrderEffects(this.order, false);
    this.logEvent('order_update', { id: o.id });
    this.pub('Хозяин прислал уточнение записюльки', 'order');
    this.toAll({ t: 'order', order: this.publicOrder(), update: true });
  }

  _takeExtra(p) {
    const st = STATION_BY_ID.ent_board;
    if (!this.near(p, st)) return this._reject(p, 'Подойди к доске поручений');
    if (p.tasks.length >= 2) return this._reject(p, 'Сначала доделай свою батрачку');
    const t = this._giveRandomTask(p, { extra: true });
    if (t) this.notice(p, `Доп. батрачка: ${t.name}`);
    this.dirty();
    return true;
  }

  finishWork(p, msg = {}) {
    const w = p.work;
    if (!w) return false;
    const elapsed = this.t - w.start;
    if (elapsed + 0.2 < w.min) {
      this.notice(p, 'Слишком быстро — сервер не засчитал', 'warn');
      this._cancelWork(p, false);
      return false;
    }
    const st = STATION_BY_ID[w.station];
    if (st && !this.near(p, st, 0.8)) { this._cancelWork(p, false); return false; }
    p.work = null;
    p.anim = 'idle';
    p.idleSince = this.t;
    let ok = true;
    switch (w.kind) {
      case 'task': ok = this._completeTaskStep(p, w, msg); break;
      case 'repair': ok = this._completeRepair(p, w); break;
      case 'sabotage': ok = this._completeSabotage(p, w); break;
      case 'check': ok = this._completeCheck(p, w); break;
      case 'coffee':
        p.coffeeAt = this.t; this.debiki += 3; this.krediki = Math.max(0, this.krediki - 5); p.kukishi = Math.max(0, p.kukishi - 2);
        this.notice(p, 'Кофе выпит: кредики −5, дебики +3'); break;
      case 'eat':
        p.ate = true; this.debiki += 1; this.krediki = Math.max(0, this.krediki - 2);
        this.notice(p, 'Тарелка кислых щей съедена'); break;
      case 'pickup': ok = this._completePickup(p, w); break;
      case 'compare': ok = this._completeCompare(p, w, msg); break;
      case 'drop': ok = this._completeDrop(p, w); break;
      default:
    }
    this.to(p, { t: 'work_end', ok, kind: w.kind });
    this.dirty();
    return ok;
  }

  _cancelWork(p, silent) {
    if (!p.work) return;
    const w = p.work;
    p.work = null;
    p.anim = 'idle';
    this.logEvent('work_cancel', { id: p.id, kind: w.kind, station: w.station });
    if (!silent) this.to(p, { t: 'work_end', ok: false, cancelled: true, kind: w.kind });
    else this.to(p, { t: 'work_end', ok: false, cancelled: true, kind: w.kind, forced: true });
  }

  _completeTaskStep(p, w) {
    const task = p.tasks.find((t) => t.uid === w.uid);
    if (!task) return false;
    const st = STATION_BY_ID[w.station];
    // Нервяк от кредиков: задача может сорваться
    if (this.krediki >= 50 && task.step === task.steps.length - 1 && this.rng.chance(0.12)) {
      p.failedTasks++;
      this.notice(p, 'Провал задачи: нервы сдали (кредики ≥ 50). Попробуй ещё раз.', 'warn');
      this.logEvent('task_fail', { id: p.id, task: task.id });
      return false;
    }
    task.step++;
    this._logKassa(p, st);
    if (task.step < task.steps.length) {
      this.logEvent('task_step', { id: p.id, task: task.id, step: task.step });
      if (task.id === 'shchi' && task.step === 1) p.carry = 'cabbage';
      return true;
    }
    if (task.id === 'shchi') p.carry = null;
    p.tasks = p.tasks.filter((t) => t !== task);
    if (task.forged) {
      this.notice(p, 'Странно: такого поручения в журнале нет. Источник не подтверждён.', 'warn');
      this.logEvent('task_fake_done', { id: p.id });
      return true;
    }
    this.plan.points += task.plan;
    p.tasksDone++;
    p.shiftTasksDone++;
    let k = BALANCE.kukishiPerTask;
    if (this.order?.id === 'speedup') k += 5;
    if (this.order?.id === 'stakhanov') k *= 2;
    p.kukishi += k;
    this.debiki += 0.6;
    this.logEvent('task_done', { id: p.id, task: task.id, plan: this.plan.points });
    this.to(p, { t: 'task_done', name: task.name, kukishi: k });
    if (this.shift === 3 && this.plan.points >= this.plan.target && this.phase.name === 'work' && this.shiftClock > 20) {
      // В финальной шабашке выполненный план досрочно ведёт к проверке
      this._finish('plan');
    }
    return true;
  }

  _logKassa(p, st) {
    if (!st || st.zone !== 'kassa') return;
    this.kassaLog.push({ t: this.t, oc: this.clock(), who: p.id, op: st.name, delta: 0, anomaly: false });
    // Обнаружение кражи при работе с кассой
    const inc = this.incidents.find((i) => i.open && !i.discovered && i.type === 'kukishi_steal' && i.culprit !== p.id);
    if (inc && (st.id === 'kassa_tumba' || st.id === 'kassa_desk')) this._discover(inc, p);
  }

  // ------------------------------------------------------------- repairs
  // Какой инцидент можно починить в этой станции/предмете
  repairableAt(stationId) {
    for (const inc of this.incidents) {
      if (!inc.open) continue;
      if (inc.type === 'lights_off') continue;
      const rs = SABOTAGE_BY_ID[inc.type]?.repairStation || inc.station;
      if (inc.type === 'archive_lock' && stationId === 'kv_keybox') return inc;
      if (inc.type === 'accel_overload' && stationId.startsWith('tech_acc') && this.accel && !this.accel.panels.includes(stationId)) return inc;
      if (inc.type === 'kukishi_steal' && stationId === 'kassa_tumba') return inc;
      if (['printer_break', 'status_corrupt', 'locker_lock', 'soup_spoil'].includes(inc.type) && rs === stationId) return inc;
    }
    return null;
  }

  _startRepair(p, msg) {
    const st = STATION_BY_ID[msg.station];
    if (!st) return this._reject(p, 'Нечего чинить');
    if (!this.near(p, st)) return this._reject(p, 'Слишком далеко');
    const inc = this.repairableAt(st.id);
    if (!inc) return this._reject(p, 'Здесь нечего чинить');
    if (this.stationBusy(st.id, p)) return this._reject(p, 'Место занято');
    if (p.restricted && p.restricted.zone === st.zone) return this._reject(p, 'Доступ ограничен Директором');
    const def = SABOTAGE_BY_ID[inc.type];
    const min = def.repairMg ? 2.5 : BALANCE.repairHold;
    const data = def.repairMg === 'typeName' ? { title: 'ВОССТАНОВЛЕНИЕ ЗАПИСИ', text: `ЗАДАЧА ${this.rng.int(100, 999)} ВЫПОЛНЕНА` } : null;
    return this._beginWork(p, { kind: 'repair', station: st.id, inc: inc.id, min, mg: def.repairMg || 'hold', data });
  }

  _completeRepair(p, w) {
    const inc = this.incidents.find((i) => i.id === w.inc);
    if (!inc || !inc.open) return false;
    if (inc.type === 'accel_overload') {
      if (!this.accel || this.accel.panels.includes(w.station)) return false;
      this.accel.panels.push(w.station);
      if (this.accel.panels.length < 2) {
        this.notice(p, 'Панель стабилизирована. Нужна ещё одна!');
        p.repairs++;
        this.dirty();
        return true;
      }
      this.accel = null;
    }
    this._resolveIncident(inc, p);
    return true;
  }

  _resolveIncident(inc, p, text) {
    if (!inc.open) return;
    inc.open = false;
    inc.resolvedAt = this.clock();
    inc.resolvedBy = p ? p.id : null;
    inc.resolvedByName = p ? p.name : null;
    if (!inc.discovered) this._discover(inc, p, null, true);
    switch (inc.type) {
      case 'printer_break': case 'status_corrupt': delete this.broken[inc.station]; break;
      case 'lights_off': delete this.dark[inc.zone]; break;
      case 'archive_lock':
        for (const d of ['d_arch_kassa', 'd_arch_kv']) {
          if (!this.sealed.has(d)) this.map.setDoor(d, { locked: false });
        }
        break;
      case 'cart_block': {
        this.map.setDoor(inc.door, { cart: false });
        const cart = this.items.find((i) => i.id === 'cart');
        Object.assign(cart, { x: CART_HOME.x, z: CART_HOME.z, carriedBy: null, home: true, door: null });
        break;
      }
      case 'order_forge':
        if (this.originalOrder) {
          this._clearOrderEffects(this.order);
          this.order = this.originalOrder;
          this.originalOrder = null;
          this._applyOrderEffects(this.order, false);
          this.toAll({ t: 'order', order: this.publicOrder(), restored: true });
        }
        break;
      case 'folders_mix': this.items = this.items.filter((i) => i.id !== inc.item); break;
      default:
    }
    if (p) {
      p.repairs++;
      p.kukishi += BALANCE.kukishiPerRepair;
      this.krediki = Math.max(0, this.krediki - 2);
      this.notice(p, `Устранено: ${inc.name} (+${BALANCE.kukishiPerRepair} кукишей)`, 'good');
    }
    const msg = text !== undefined ? text : `Устранено: ${inc.name}${p ? ` — ${p.name}` : ''}`;
    if (msg) this.pub(msg, 'good');
    this.logEvent('incident_resolved', { inc: inc.id, by: p?.id });
    for (const q of this.players.values()) if (q.brain) q.brain.onIncidentResolved(inc);
    this.dirty();
  }

  // --------------------------------------------------- pickup / drop / carry
  _startPickup(p, msg) {
    const it = this.items.find((i) => i.id === msg.item);
    if (!it || it.carriedBy) return this._reject(p, 'Нечего брать');
    if (Math.hypot(p.x - it.x, p.z - it.z) > USE_RADIUS + 0.3) return this._reject(p, 'Слишком далеко');
    if (p.carry) return this._reject(p, 'Руки заняты');
    if (it.kind === 'cart') {
      if (it.home) {
        // Взять тележку от дома может только вредитель (саботаж)
        if (p.role !== 'vreditel' || !p.sab.loadout.includes('cart_block')) return this._reject(p, 'Тележку трогать незачем');
        if (p.sab.cdUntil > this.t) return this._reject(p, 'Саботаж перезаряжается');
        return this._beginWork(p, { kind: 'pickup', item: it.id, station: null, min: 1.2, sabotage: true });
      }
      // Откатить тележку от двери — ремонт
      const inc = this.incidents.find((i) => i.open && i.type === 'cart_block');
      if (!inc) return this._reject(p, 'Тележка никому не мешает');
      return this._beginWork(p, { kind: 'repair', item: it.id, station: null, inc: inc.id, min: BALANCE.repairHold, mg: 'hold', x: it.x, z: it.z });
    }
    if (it.kind === 'folder') return this._beginWork(p, { kind: 'pickup', item: it.id, station: null, min: 1.0 });
    return this._reject(p, 'Нечего брать');
  }

  _completePickup(p, w) {
    const it = this.items.find((i) => i.id === w.item);
    if (!it || it.carriedBy) return false;
    it.carriedBy = p.id;
    it.home = false;
    p.carry = it.kind;
    if (it.kind === 'folder') {
      const inc = this.incidents.find((i) => i.item === it.id);
      if (inc && !inc.discovered) this._discover(inc, p);
      this.notice(p, 'Папка у тебя. Отнеси её на стол архивариуса.');
    } else {
      this.notice(p, 'Тележка у тебя. Довези до двери и нажми [F].');
      this.logEvent('cart_taken', { id: p.id });
    }
    return true;
  }

  _startDrop(p, msg) {
    if (!p.carry) return this._reject(p, 'Нечего ставить');
    if (p.carry === 'folder') {
      const st = STATION_BY_ID.arch_desk;
      if (!this.near(p, st)) return this._reject(p, 'Папку нужно вернуть на стол архивариуса');
      return this._beginWork(p, { kind: 'drop', station: 'arch_desk', min: 1.0 });
    }
    if (p.carry === 'cart') {
      const door = nearestDoor(p.x, p.z, 2.6);
      if (!door) return this._reject(p, 'Подкати тележку к двери');
      if (this.map.doorClosed(door.id)) return this._reject(p, 'Эта дверь и так закрыта');
      return this._beginWork(p, { kind: 'drop', station: null, door: door.id, min: 1.0, sabotage: true });
    }
    return this._reject(p, 'Нечего ставить');
  }

  _completeDrop(p, w) {
    const it = this.items.find((i) => i.carriedBy === p.id);
    if (!it) { p.carry = null; return false; }
    if (it.kind === 'folder') {
      const inc = this.incidents.find((i) => i.item === it.id && i.open);
      p.carry = null;
      it.carriedBy = null;
      if (inc) this._resolveIncident(inc, p);
      else this.items = this.items.filter((i) => i !== it);
      return true;
    }
    if (it.kind === 'cart') {
      const door = DOOR_BY_ID[w.door];
      p.carry = null;
      it.carriedBy = null;
      it.x = door.x;
      it.z = door.z;
      it.door = door.id;
      this.map.setDoor(door.id, { cart: true });
      const inc = this._createIncident(p, 'cart_block', null, {
        door: door.id, doorPos: { x: door.x, z: door.z }, until: this.t + BALANCE.cartBlock,
        zone: door.zones[0], objName: `дверь ${ZONE_BY_ID[door.zones[0]].name} — ${ZONE_BY_ID[door.zones[1]].name}`,
      });
      this._afterSabotage(p, inc);
      return true;
    }
    return false;
  }

  _dropCarry(p) {
    if (!p.carry) return;
    const it = this.items.find((i) => i.carriedBy === p.id);
    if (it) {
      it.carriedBy = null;
      if (it.kind === 'cart') Object.assign(it, { x: CART_HOME.x, z: CART_HOME.z, home: true });
      else { it.x = p.x; it.z = p.z; }
    }
    p.carry = null;
    this.dirty();
  }

  // ------------------------------------------------------------- sabotage
  canSabotage(p, sabId, st, zone) {
    if (p.role !== 'vreditel' || !p.alive || !p.sab) return 'Ты не вредитель';
    if (this.phase.name !== 'work') return 'Саботаж только во время шабашки';
    if (!p.sab.loadout.includes(sabId)) return 'Этот саботаж тебе недоступен';
    if (p.sab.cdUntil > this.t) return `Перезарядка: ${Math.ceil(p.sab.cdUntil - this.t)} с`;
    if (p.carry) return 'Руки заняты';
    const def = SABOTAGE_BY_ID[sabId];
    if (!st || !def.stations.includes(st.id)) return 'Здесь это не сработает';
    if (!this.near(p, st)) return 'Слишком далеко';
    if (p.restricted && p.restricted.zone === st.zone) return 'Доступ в зону ограничен';
    if (this.stationBusy(st.id, p)) return 'Кто-то работает рядом';
    const openOf = (type) => this.incidents.some((i) => i.open && i.type === type);
    switch (sabId) {
      case 'printer_break': case 'status_corrupt': if (this.broken[st.id]) return 'Уже сломано'; break;
      case 'lights_off': {
        const z = zone || st.zone;
        if (!ZONE_BY_ID[z]) return 'Выбери зону';
        if (this.zoneDark(z)) return 'Там и так темно';
        break;
      }
      case 'folders_mix': if (openOf('folders_mix')) return 'Папки уже перепутаны'; break;
      case 'kukishi_steal': if (openOf('locker_lock')) return 'Шкапчики заперты'; if (openOf('kukishi_steal')) return 'Касса и так не сходится'; break;
      case 'order_forge': if (!this.order || this.order.forged) return 'Записюлька уже подменена'; break;
      case 'archive_lock': if (openOf('archive_lock')) return 'Архив уже заперт'; break;
      case 'locker_lock': if (openOf('locker_lock')) return 'Уже заперто'; break;
      case 'accel_overload': if (this.accel) return 'Ускоритель уже перегружен'; break;
      case 'soup_spoil': if (openOf('soup_spoil')) return 'Щи уже испорчены'; break;
      default:
    }
    return null;
  }

  _startSabotage(p, msg) {
    const st = STATION_BY_ID[msg.station];
    const err = this.canSabotage(p, msg.sab, st, msg.zone);
    if (err) return this._reject(p, err);
    return this._beginWork(p, { kind: 'sabotage', sab: msg.sab, station: st.id, zone: msg.zone || null, min: BALANCE.sabotageHold, mg: 'hold' });
  }

  _completeSabotage(p, w) {
    const st = STATION_BY_ID[w.station];
    const err = this.canSabotage(p, w.sab, st, w.zone);
    if (err && !err.startsWith('Перезарядка')) { this.notice(p, err, 'warn'); return false; }
    let inc = null;
    switch (w.sab) {
      case 'printer_break':
        inc = this._createIncident(p, w.sab, st);
        this.broken[st.id] = 'printer_break';
        break;
      case 'status_corrupt':
        inc = this._createIncident(p, w.sab, st);
        this.broken[st.id] = 'status_corrupt';
        this.plan.points = Math.max(0, this.plan.points - 1);
        break;
      case 'lights_off': {
        const z = w.zone || st.zone;
        const dur = this.order?.id === 'economy' ? 20 : BALANCE.lightsOff;
        this.dark[z] = this.t + dur;
        inc = this._createIncident(p, w.sab, st, { zone: z, until: this.t + dur, objName: `свет: ${ZONE_BY_ID[z].name}` });
        this._discover(inc, null, null, true);
        this.toAll({ t: 'fx', kind: 'lights_off', zone: z });
        break;
      }
      case 'folders_mix': {
        const zones = ZONES.filter((z) => z.id !== 'archive');
        const zn = this.rng.pick(zones);
        const pt = this.map.randomPointInZone(zn.id, this.rng);
        const item = { id: uid('folder'), kind: 'folder', x: pt.x, z: pt.z, carriedBy: null, zone: zn.id };
        this.items.push(item);
        inc = this._createIncident(p, w.sab, st, { item: item.id });
        break;
      }
      case 'kukishi_steal':
        inc = this._createIncident(p, w.sab, st);
        this.costs.stolen += 120;
        this.plan.points = Math.max(0, this.plan.points - 1);
        this.krediki += 5;
        this.kassaLog.push({ t: this.t, oc: this.clock(), who: p.id, op: `Шкапчик №${this.rng.int(1, 12)}`, delta: -120, anomaly: true, inc: inc.id });
        break;
      case 'order_forge': {
        const forged = this.rng.pick(FORGED_ORDERS);
        this.originalOrder = this.order;
        this._clearOrderEffects(this.order);
        this.order = { ...forged, stamp: this.rng.pick(FORGED_STAMPS), version: (this.originalOrder?.version || 1) + 1 };
        this._applyOrderEffects(this.order, false);
        inc = this._createIncident(p, w.sab, st);
        this.toAll({ t: 'order', order: this.publicOrder(), update: true });
        this.pub('Хозяин прислал уточнение записюльки', 'order');
        break;
      }
      case 'archive_lock':
        for (const d of ['d_arch_kassa', 'd_arch_kv']) this.map.setDoor(d, { locked: true });
        inc = this._createIncident(p, w.sab, st, { until: this.t + BALANCE.archiveLock, doorPos: { x: 14, z: 6.75 }, zone: 'archive', objName: 'двери Архива' });
        break;
      case 'locker_lock':
        inc = this._createIncident(p, w.sab, st);
        break;
      case 'accel_overload':
        inc = this._createIncident(p, w.sab, st);
        this.accel = { inc: inc.id, until: this.t + BALANCE.accelCountdown, panels: [] };
        this._discover(inc, null, null, true);
        this.toAll({ t: 'fx', kind: 'alarm' });
        break;
      case 'soup_spoil':
        inc = this._createIncident(p, w.sab, st);
        break;
      default:
        return false;
    }
    this._afterSabotage(p, inc);
    return true;
  }

  _afterSabotage(p, inc) {
    p.sab.cdUntil = this.t + BALANCE.sabotageCooldown;
    p.sabotagesDone++;
    // «Саботаж при свете» — рост кредиков
    if (!this.zoneDark(zoneAt(p.x, p.z)) && inc.type !== 'lights_off') this.krediki += 4;
    this.notice(p, `Саботаж: ${SABOTAGE_BY_ID[inc.type].name}. Уходи спокойно.`, 'sab');
    this.logEvent('sabotage', { id: p.id, type: inc.type, inc: inc.id, station: inc.station });
    for (const q of this.players.values()) if (q.brain) q.brain.onSabotage(inc);
    this.dirty();
  }

  _createIncident(p, type, st, extra = {}) {
    const def = SABOTAGE_BY_ID[type];
    const zone = extra.zone || st?.zone || zoneAt(p.x, p.z);
    const lastSeen = st ? this.stationSeen[st.id] : null;
    const inc = {
      id: uid('i'), type, name: def.incident, station: st?.id || null, zone,
      objName: extra.objName || st?.name || '', culprit: p.id, t: this.t, oc: this.oc(), ocStr: this.clock(), shift: this.shift,
      windowFrom: lastSeen != null && this.oc() - lastSeen < 200 ? fmtClock(lastSeen) : null, windowTo: null,
      discovered: false, open: true, traces: [def.trace], planted: [],
      nearby: this._nearbyAt(st ? st.x : p.x, st ? st.z : p.z, 15, 8),
      ...extra,
    };
    this.incidents.push(inc);
    return inc;
  }

  _nearbyAt(x, z, back, radius, tFrom = null, tTo = null) {
    const from = tFrom ?? this.t - back;
    const to = tTo ?? this.t;
    const out = [];
    for (const q of this.players.values()) {
      if (!q.alive && q.firedAt != null && q.firedAt < from) continue;
      const near = q.hist.some((h) => h.t >= from && h.t <= to && Math.hypot(h.x - x, h.z - z) <= radius) ||
        (Math.hypot(q.x - x, q.z - z) <= radius && to >= this.t - 1);
      if (near) out.push(q.id);
    }
    return out;
  }

  _discover(inc, p, by = null, silent = false) {
    if (inc.discovered) return;
    inc.discovered = true;
    inc.discoveredAt = this.t;
    inc.windowTo = this.clock();
    if (!inc.windowFrom && inc.type !== 'lights_off' && inc.type !== 'accel_overload') {
      inc.windowFrom = fmtClock(Math.max(OFFICE_SPANS[inc.shift - 1][0], inc.oc - 25));
    }
    if (inc.type === 'lights_off' || inc.type === 'accel_overload') inc.windowFrom = null;
    const who = p ? p.name : by;
    const where = ZONE_BY_ID[inc.zone]?.name || '';
    if (!silent || inc.type === 'lights_off' || inc.type === 'accel_overload') {
      this.pub(`Инцидент: ${inc.name} (${where})${who ? ` — заметил${p && p.gender === 'f' ? 'а' : ''} ${who}` : ''}`, 'alarm');
      this.toAll({ t: 'incident', inc: this.publicIncident(inc), by: who || null });
    }
    this.logEvent('incident_discovered', { inc: inc.id, by: p?.id || by });
    for (const q of this.players.values()) if (q.brain) q.brain.onIncident(inc);
    this.dirty();
  }

  // ------------------------------------------------------------ tricks
  _onTrick(p, msg) {
    if (p.role !== 'vreditel' || !p.alive || p.sab.trickUsed) return this.notice(p, 'Трюк недоступен', 'warn');
    if (this.phase.name !== 'work') return this.notice(p, 'Только во время шабашки', 'warn');
    const target = this.players.get(msg.target);
    if (!target || !target.alive || target === p) return this.notice(p, 'Выбери сотрудника', 'warn');
    if (p.sab.trick === 'plant_evidence') {
      const inc = [...this.incidents].reverse().find((i) => i.open && i.station && i.shift === this.shift);
      if (!inc) return this.notice(p, 'Нет свежего инцидента, к которому можно подбросить улику', 'warn');
      inc.traces.push(`У места найден пропуск сотрудника: ${target.name}`);
      inc.planted.push({ target: target.id, by: p.id });
      p.sab.trickUsed = true;
      this.notice(p, `Пропуск ${declineName(target.name, target.gender, 'gen')} подброшен к «${inc.objName}»`, 'sab');
      this.logEvent('trick_plant', { id: p.id, target: target.id, inc: inc.id });
      for (const q of this.players.values()) if (q.brain) q.brain.onPlanted(inc, target);
      if (inc.discovered) this.toAll({ t: 'incident', inc: this.publicIncident(inc), update: true });
    } else {
      const sabSt = this.incidents.filter((i) => i.open && i.station).map((i) => i.station);
      const stId = sabSt.length ? this.rng.pick(sabSt) : this.rng.pick(SAB_STATIONS).id;
      const st = STATION_BY_ID[stId];
      this._addTask(target, 'shtamp', {
        steps: [stId], name: `Срочное поручение: осмотреть ${st.name.toLowerCase()}`,
        hint: 'Срочно! Осмотреть объект и отметиться.', forged: true, source: 'не подтверждён', plan: 0,
      });
      p.sab.trickUsed = true;
      this.notice(target, 'Новое срочное поручение!', 'order');
      this.notice(p, `${target.name} получил${target.gender === 'f' ? 'а' : ''} подставную задачу`, 'sab');
      this.logEvent('trick_fake_task', { id: p.id, target: target.id, station: stId });
    }
    this.dirty();
    return true;
  }

  // ------------------------------------------------------------- abilities
  _startCheck(p, msg) {
    if (p.role !== 'alesya') return this._reject(p, 'Это может только Кудесница');
    if (p.checks <= 0) return this._reject(p, 'Проверки закончились');
    const st = STATION_BY_ID.kv_terminal;
    if (!this.near(p, st)) return this._reject(p, 'Подойди к терминалу квадровой проверки');
    const target = this.players.get(msg.target);
    if (!target || target === p || target.left) return this._reject(p, 'Выбери сотрудника');
    return this._beginWork(p, { kind: 'check', station: st.id, target: target.id, min: 4, mg: 'hold' });
  }

  _completeCheck(p, w) {
    const target = this.players.get(w.target);
    if (!target) return false;
    p.checks--;
    const bad = target.team === 'vrediteli';
    const r = this.rng.next();
    let res;
    if (bad) res = r < 0.6 ? 'high' : r < 0.9 ? 'mid' : 'low';
    else res = r < 0.55 ? 'low' : r < 0.9 ? 'mid' : 'high';
    const label = { high: 'высокий риск', mid: 'неопределённо', low: 'низкий риск' }[res];
    p.checksDone.push({ target: target.id, res, oc: this.clock() });
    this.to(p, { t: 'check_result', target: target.id, name: target.name, res, label });
    this.logEvent('alesya_check', { id: p.id, target: target.id, res });
    if (p.brain) p.brain.onCheck(target, res);
    return true;
  }

  kassaLogFor(p) {
    const detailed = this.order?.id === 'kukishi_urgent';
    return this.kassaLog.slice(-30).map((e) => {
      if (!e.anomaly) return { oc: e.oc, who: this.players.get(e.who)?.name, op: e.op, delta: e.delta, anomaly: false };
      const win = detailed ? 10 : 25;
      const near = this._nearbyAt(1.7, 21.5, 0, 4.5, e.t - win, e.t + win).map((id) => this.players.get(id)?.name);
      return { oc: e.oc, who: null, op: e.op, delta: e.delta, anomaly: true, near: this.rng.shuffle(near) };
    });
  }

  _onKassaLog(p) {
    const remote = this.order?.id === 'lockers_inv';
    if (p.role !== 'dusya') return this.notice(p, 'Журнал кукишей доступен только Дусе', 'warn');
    if (!remote && !this.near(p, STATION_BY_ID.kassa_tumba)) return this.notice(p, 'Подойди к тумбе кассы', 'warn');
    const log = this.kassaLogFor(p);
    this.to(p, { t: 'kassa_log', log });
    for (const inc of this.incidents) if (inc.type === 'kukishi_steal' && inc.open && !inc.discovered) this._discover(inc, p);
    if (p.brain) p.brain.onKassaLog(log);
    return true;
  }

  _ringBell(p) {
    const st = STATION_BY_ID.dir_bell;
    if (!this.near(p, st)) return this._reject(p, 'Подойди к звонку планёрки');
    if (p.bellUsed) return this._reject(p, 'Ты уже созывал' + (p.gender === 'f' ? 'а' : '') + ' планёрку');
    if (this.shiftClock < 20) return this._reject(p, 'Шабашка только началась');
    p.bellUsed = true;
    this._startMeeting('emergency', p.id);
    return true;
  }

  _onCallMeeting(p) {
    if (p.role !== 'director' || !p.alive) return this.notice(p, 'Созывать планёрку из любого места может только Директор', 'warn');
    if (this.phase.name !== 'work') return;
    if (p.calls <= 0) return this.notice(p, 'Лимит созывов исчерпан', 'warn');
    if (this.shiftClock < 20) return this.notice(p, 'Шабашка только началась', 'warn');
    p.calls--;
    this._startMeeting('emergency', p.id);
  }

  _onGreet(p) {
    if (this.phase.name !== 'work' || !p.alive) return;
    const dir = [...this.players.values()].find((q) => q.role === 'director' && q.alive);
    this.say(p, this.rng.pick(['Здравствуйте!', 'Доброго дня!', 'Здрасьте!']), 'near');
    p.anim = 'wave';
    if (!dir || dir === p) return;
    if (Math.hypot(dir.x - p.x, dir.z - p.z) > 2.8) return;
    if (this.order?.id === 'greet' && !p.greeted) {
      p.greeted = true;
      p.promises += 1;
      this.notice(p, 'Директор поприветствован. +1 обещание', 'good');
      this.dirty();
    }
  }

  // ------------------------------------------------------------ chat/speech
  say(p, text, ch) {
    p.speech = { text, until: this.t + 3.5 };
    const msg = { t: 'speech', from: p.id, text, ch };
    if (ch === 'meeting') {
      for (const q of this.players.values()) {
        if (q.left) continue;
        if (!p.alive && q.alive) continue; // уволенные не слышны живым
        if (q.brain && q !== p) q.brain.onChat(p, text, ch);
        else this.to(q, msg);
      }
      if (this.meeting) {
        this.meeting.chat.push({ from: p.id, text, oc: this.clock() });
        if (this.meeting.chat.length > 200) this.meeting.chat.shift();
      }
      return;
    }
    // Ближняя речь (во время шабашки): слышно в радиусе 10 м
    const silence = this.order?.id === 'silence' && zoneAt(p.x, p.z) === 'openspace';
    for (const q of this.players.values()) {
      if (q.left) continue;
      if (!p.alive && q.alive) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (q !== p && (d > 10 || silence)) continue;
      if (q.brain && q !== p) q.brain.onChat(p, text, ch);
      else this.to(q, msg);
    }
    if (silence) this.notice(p, 'Режим тишины: в Опенспейсе тебя никто не услышал', 'warn');
  }

  _npcSay(npcId, text) {
    this.toAll({ t: 'speech', from: npcId, text, ch: 'npc' });
  }

  _onChat(p, msg) {
    let text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!text) return;
    if (this.t - p.lastChatT < 0.6) return;
    p.lastChatT = this.t;
    if (this.phase.name === 'meeting') {
      if (this.meeting.sub === 'result') return;
      this.say(p, text, 'meeting');
    } else if (this.phase.name === 'work' || this.phase.name === 'smoke' || this.phase.name === 'intro') {
      this.say(p, text, 'near');
    }
  }

  // --------------------------------------------------------------- orders
  _issueOrder(shift) {
    const prev = this.order?.id;
    const pool = ORDERS.filter((o) => o.id !== prev && !(this._usedOrders || []).includes(o.id));
    const o = this.rng.pick(pool.length ? pool : ORDERS);
    (this._usedOrders = this._usedOrders || []).push(o.id);
    this.order = { ...o, stamp: OWNER_STAMP, version: 1 };
    this.originalOrder = null;
    this.prevOrder = null;
    this.logEvent('order', { id: o.id, shift });
    this.pub(`Записюлька Хозяина: «${o.title}»`, 'order');
    this.toAll({ t: 'order', order: this.publicOrder() });
    this.dirty();
  }

  _applyOrderStart() {
    this._applyOrderEffects(this.order, true);
  }

  _applyOrderEffects(o, shiftStart) {
    if (!o) return;
    switch (o.id) {
      case 'speedup':
        if (shiftStart) {
          const add = Math.round(this.alivePlayers.length * this.len.tasksPerShift[this.shift - 1] * 0.2);
          this.plan.target += add;
          this.pub(`План увеличен на ${add}`, 'order');
        }
        break;
      case 'red_ban':
        this.sealed.add('d_arch_kv');
        this.map.setDoor('d_arch_kv', { locked: true });
        break;
      case 'slop_sealed':
        for (const d of ['d_os_slop', 'd_ent_slop']) { this.sealed.add(d); this.map.setDoor(d, { locked: true }); }
        break;
      case 'kvadry_check':
        if (shiftStart) {
          for (const p of this.alivePlayers) this._addTask(p, 'obhod_kv', { steps: ['cp_kvadry'], name: 'Отметиться в Отделе квадров', hint: 'Записюлька: отметься на посту Отдела квадров.', plan: 1 });
          for (const p of this.alivePlayers) if (p.role === 'alesya') p.checks++;
        }
        break;
      case 'kukishi_urgent':
        if (shiftStart) {
          const ps = this.rng.shuffle(this.alivePlayers).slice(0, 2);
          ps.forEach((p, i) => this._addTask(p, i ? 'pereschet' : 'sverka'));
        }
        break;
      case 'lockers_inv':
        if (shiftStart) for (const p of this.alivePlayers) if (!p.tasks.some((t) => t.id === 'shkap')) this._addTask(p, 'shkap');
        break;
      case 'economy':
        this.dim.archive = true;
        this.dim.slop = true;
        break;
      case 'printer_permit':
        if (shiftStart) {
          for (const p of this.alivePlayers) {
            for (const t of p.tasks) {
              if (TASK_BY_ID[t.id]?.printer && !t.permit && t.step === 0) { t.steps = ['dir_desk', ...t.steps]; t.permit = true; }
            }
          }
        }
        break;
      case 'f_archive': case 'f_printers': case 'f_kassa': case 'f_coffee': break;
      default:
    }
    this.dirty();
  }

  _clearOrderEffects(o) {
    if (!o) return;
    if (o.id === 'red_ban') { this.sealed.delete('d_arch_kv'); this.map.setDoor('d_arch_kv', { locked: this.incidents.some((i) => i.open && i.type === 'archive_lock') }); }
    if (o.id === 'slop_sealed') for (const d of ['d_os_slop', 'd_ent_slop']) { this.sealed.delete(d); this.map.setDoor(d, { locked: false }); }
    if (o.id === 'economy') { delete this.dim.archive; delete this.dim.slop; }
    this.dirty();
  }

  _applyOrderEnd() {
    const o = this.order;
    if (!o) return;
    if (o.id === 'greet') {
      const rude = this.alivePlayers.filter((p) => p.role !== 'director' && !p.greeted);
      this.debiki += rude.length * 2;
      if (rude.length) this.pub(`Не поздоровались с Директором: ${rude.map((p) => p.name).join(', ')}`, 'order');
    }
    if (o.id === 'lunch') {
      const hungry = this.alivePlayers.filter((p) => !p.ate);
      this.debiki += hungry.length * 3;
      if (hungry.length) this.pub(`Пропустили обед: ${hungry.map((p) => p.name).join(', ')}`, 'order');
    }
    if (o.id === 'stakhanov') {
      const top = this.alivePlayers.slice().sort((a, b) => b.shiftTasksDone - a.shiftTasksDone).slice(0, 3).filter((p) => p.shiftTasksDone > 0);
      for (const p of top) p.promises += 2;
      if (top.length) this.pub(`Стахановцы шабашки: ${top.map((p) => p.name).join(', ')} (+2 обещания)`, 'order');
    }
    this._clearOrderEffects(o);
    if (this.originalOrder) this._clearOrderEffects(this.originalOrder);
  }

  // -------------------------------------------------------------- meeting
  _startMeeting(kind, callerId) {
    const caller = callerId ? this.players.get(callerId) : null;
    for (const p of this.players.values()) { this._cancelWork(p, true); this._dropCarry(p); }
    // Тележку от двери откатываем, если ещё стоит — инцидент остаётся открытым
    const resume = this.phase.name === 'work' ? { shiftClock: this.shiftClock, end: this.phase.end } : null;
    this.phase = { name: 'meeting', sub: 'gather', end: this.t + BALANCE.meetingGather, resume, kind };
    this.debiki = Math.max(0, this.debiki - 12);
    this.krediki = Math.min(100, this.krediki + 2);
    const alive = this.alivePlayers;
    alive.forEach((p, i) => {
      const s = MEETING_SEATS[i % MEETING_SEATS.length];
      p.seat = i;
      p.anim = 'sit';
      this._teleport(p, s.x, s.z, s.rot);
      p.anim = 'sit';
    });
    this.meeting = {
      id: uid('m'), kind, caller: callerId, shift: this.shift, votes: {}, skip: new Set(), explainUsed: false,
      explaining: null, decision: null, chat: [], startOc: this.clock(),
    };
    const reason = kind === 'shift_end' ? `Планёрка по итогам шабашки №${this.shift}` : `Внеочередная планёрка: созвал${caller?.gender === 'f' ? 'а' : ''} ${caller?.name}`;
    this.pub(reason, 'phase');
    this.logEvent('meeting_start', { kind, caller: callerId });
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.toAll({ t: 'meeting', m: this.publicMeeting(), reason });
    for (const p of this.players.values()) if (p.brain) p.brain.onMeetingStart(this.meeting);
    this.dirty();
  }

  publicMeeting() {
    const m = this.meeting;
    if (!m) return null;
    const tally = {};
    for (const v of Object.values(m.votes)) tally[v] = (tally[v] || 0) + 1;
    return {
      id: m.id, kind: m.kind, sub: this.phase.sub, left: Math.max(0, this.phase.end - this.t), tally,
      votes: { ...m.votes }, explaining: m.explaining ? { target: m.explaining.target, left: Math.max(0, m.explaining.until - this.t) } : null,
      explainUsed: m.explainUsed, decision: m.decision, caller: m.caller, sanctionsLeft: this.sanctionsLeft,
      incidents: this.incidents.filter((i) => i.discovered && (i.open || i.shift === this.shift || i.shift === this.shift - 0)).map((i) => this.publicIncident(i)),
      log: this.publicLog.slice(-12),
      seats: Object.fromEntries(this.alivePlayers.map((p) => [p.id, p.seat])),
      chat: m.chat.slice(-60),
    };
  }

  _tickMeeting() {
    const ph = this.phase;
    const m = this.meeting;
    if (m.explaining && this.t >= m.explaining.until) {
      m.explaining = null;
      this.toAll({ t: 'meeting', m: this.publicMeeting() });
    }
    if (this.t < ph.end) return;
    if (ph.sub === 'gather') {
      this.phase = { ...ph, sub: 'discuss', end: this.t + this.len.discuss };
    } else if (ph.sub === 'discuss') {
      this.phase = { ...ph, sub: 'decide', end: this.t + BALANCE.meetingDecide };
      for (const p of this.players.values()) if (p.brain) p.brain.onDecidePhase();
    } else if (ph.sub === 'decide') {
      if (!m.decision) this._applyDecision({ sanction: 'none' }, null);
      this.phase = { ...ph, sub: 'result', end: this.t + BALANCE.meetingResult };
    } else if (ph.sub === 'result') {
      this._endMeeting();
      return;
    }
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.toAll({ t: 'meeting', m: this.publicMeeting() });
  }

  _endMeeting() {
    const ph = this.phase;
    const m = this.meeting;
    this.meeting = null;
    this.logEvent('meeting_end', { id: m.id, decision: m.decision });
    for (const p of this.players.values()) if (p.anim === 'sit') p.anim = 'idle';
    if (this._checkEarlyEnd()) return;
    if (ph.kind === 'shift_end') {
      // Новая записюлька Хозяина, затем следующая шабашка
      this.phase = { name: 'intro', sub: 'order', end: this.t + BALANCE.introOrder, next: this.shift + 1 };
      this._issueOrder(this.shift + 1);
      this.toAll({ t: 'phase', phase: this.publicPhase() });
    } else {
      this.phase = { name: 'work', end: ph.resume?.end ?? this.shiftDur };
      if (ph.resume) this.shiftClock = ph.resume.shiftClock;
      this.toAll({ t: 'phase', phase: this.publicPhase() });
    }
    this.dirty();
  }

  _onVote(p, msg) {
    if (this.phase.name !== 'meeting' || !p.alive) return;
    if (!['discuss', 'decide'].includes(this.phase.sub)) return;
    const target = msg.target;
    if (target === null || target === undefined) delete this.meeting.votes[p.id];
    else if (target === 'skip' || (this.players.get(target)?.alive && target !== p.id)) this.meeting.votes[p.id] = target;
    else return;
    this.toAll({ t: 'meeting', m: this.publicMeeting() });
  }

  _onSkipReady(p) {
    if (this.phase.name === 'intro') {
      (this._introSkip = this._introSkip || new Set()).add(p.id);
      const humans = this.humans.filter((h) => h.connected && !h.left);
      if (humans.every((h) => this._introSkip.has(h.id))) { this.phase.end = Math.min(this.phase.end, this.t + 0.5); this._introSkip.clear(); }
      return;
    }
    if (this.phase.name !== 'meeting' || this.phase.sub !== 'discuss' || !p.alive) return;
    this.meeting.skip.add(p.id);
    const humans = this.alivePlayers.filter((h) => !h.isBot && h.connected);
    if (humans.length && humans.every((h) => this.meeting.skip.has(h.id))) {
      this.phase.end = Math.min(this.phase.end, this.t + 2);
      this.noticeAll('Все готовы — переходим к решению Директора');
    }
    this.toAll({ t: 'meeting', m: this.publicMeeting(), skipCount: this.meeting.skip.size });
  }

  _onExplain(p, msg) {
    if (p.role !== 'director' || this.phase.name !== 'meeting' || this.phase.sub !== 'discuss') return;
    const m = this.meeting;
    if (m.explainUsed) return this.notice(p, 'Объяснительная уже была на этой планёрке', 'warn');
    const target = this.players.get(msg.target);
    if (!target || !target.alive || target === p) return;
    m.explainUsed = true;
    m.explaining = { target: target.id, until: this.t + BALANCE.explainTime };
    this.phase.end = Math.max(this.phase.end, this.t + BALANCE.explainTime + 3);
    this.pub(`Директор вызвал ${declineName(target.name, target.gender, 'acc')} на объяснительную`, 'phase');
    this.toAll({ t: 'meeting', m: this.publicMeeting() });
    this.toAll({ t: 'explain', target: target.id });
    if (target.brain) target.brain.onExplain();
  }

  _onDecide(p, msg) {
    if (p.role !== 'director' || this.phase.name !== 'meeting' || this.phase.sub !== 'decide' || this.meeting.decision) return;
    const ok = this._applyDecision(msg, p);
    if (ok) {
      this.phase.end = this.t;
    }
  }

  _applyDecision(d, director) {
    const m = this.meeting;
    const sanction = d.sanction || 'none';
    const target = d.target ? this.players.get(d.target) : null;
    const costly = ['restrict', 'take_task', 'audit', 'fire'].includes(sanction);
    if (costly && this.sanctionsLeft <= 0) { if (director) this.notice(director, 'Санкции закончились', 'warn'); return false; }
    let text = 'Директор решил обойтись без санкций.';
    let correct = null;
    switch (sanction) {
      case 'none': break;
      case 'restrict': {
        if (!target || !target.alive || !ZONE_BY_ID[d.zone]) return false;
        target.restricted = { zone: d.zone, left: BALANCE.restrictTime };
        text = `${target.name}: доступ к зоне «${ZONE_BY_ID[d.zone].name}» ограничен на ${BALANCE.restrictTime} с.`;
        correct = target.team === 'vrediteli';
        break;
      }
      case 'take_task': {
        if (!target || !target.alive) return false;
        let to = d.to ? this.players.get(d.to) : null;
        if (!to || !to.alive || to === target) to = this.rng.pick(this.alivePlayers.filter((q) => q !== target));
        const moved = target.tasks.filter((t) => !t.forged);
        target.tasks = target.tasks.filter((t) => t.forged);
        for (const t of moved) { t.step = 0; to.tasks.push(t); }
        text = `Задачи ${declineName(target.name, target.gender, 'gen')} (${moved.length}) переданы: ${to.name}.`;
        correct = target.team === 'vrediteli';
        this.notice(to, `Тебе передали ${moved.length} задач(и) от ${declineName(target.name, target.gender, 'gen')}`, 'order');
        break;
      }
      case 'audit': {
        const inc = this.incidents.find((i) => i.id === d.incident && i.discovered);
        if (!inc || inc.auditResult) return false;
        const st = STATION_BY_ID[inc.station];
        const pos = st || inc.doorPos || { x: 14, z: 6.75 };
        let near = this._nearbyAt(pos.x, pos.z, 0, 8, inc.t - 15, inc.t + 10);
        if (near.length <= 1) {
          // «по данным турникета» — кто был в той же зоне примерно тогда же
          const zoneNear = [...this.players.values()].filter((q) => !near.includes(q.id) && q.hist.some((h) => Math.abs(h.t - inc.t) < 40 && zoneAt(h.x, h.z) === inc.zone));
          if (zoneNear.length) near.push(this.rng.pick(zoneNear).id);
        }
        near = this.rng.shuffle(near);
        const names = near.map((id) => this.players.get(id).name);
        inc.auditResult = names.length ? `Рядом в момент инцидента: ${names.join(', ')}` : 'Рядом никого не зафиксировано';
        inc.auditIds = near;
        text = `Аудит «${inc.name}»: ${inc.auditResult}.`;
        correct = near.includes(inc.culprit);
        for (const q of this.players.values()) if (q.brain) q.brain.onAudit(inc, near);
        break;
      }
      case 'fire': {
        if (!target || !target.alive || target.role === 'director') return false;
        target.alive = false;
        target.firedAt = this.t;
        target.anim = 'fired';
        this._dropCarry(target);
        this._redistributeTasks(target);
        correct = target.team === 'vrediteli';
        if (!correct) {
          this.krediki = Math.min(100, this.krediki + BALANCE.wrongFireKrediki);
          this.debiki = Math.min(100, this.debiki + 5);
          this.costs.wrongFire += 250;
        }
        text = `${target.name} уволен${target.gender === 'f' ? 'а' : ''}. Пропуск сдан на вахту.`;
        this.to(target, { t: 'fired' });
        break;
      }
      default: return false;
    }
    if (costly) this.sanctionsLeft--;
    m.decision = { sanction, target: target?.id || null, text, zone: d.zone || null, incident: d.incident || null };
    this.decisions.push({ ...m.decision, oc: this.clock(), shift: this.shift, correct, by: director?.id || null, targetRole: target?.role || null });
    this.pub(text, 'decision');
    this.logEvent('decision', { ...m.decision, correct });
    this.toAll({ t: 'decision', d: m.decision });
    for (const q of this.players.values()) if (q.brain) q.brain.onDecision(m.decision);
    this.dirty();
    return true;
  }

  _redistributeTasks(p) {
    const others = this.alivePlayers.filter((q) => q !== p);
    const tasks = p.tasks.filter((t) => !t.forged);
    p.tasks = [];
    if (!others.length) return;
    tasks.forEach((t, i) => { t.step = 0; others[i % others.length].tasks.push(t); });
  }

  _checkEarlyEnd() {
    if (this.ended) return true;
    const alive = this.alivePlayers;
    const humansAlive = alive.filter((p) => !p.isBot);
    if (!this.settings.dev && this.humans.filter((p) => !p.left).length === 0) { this._finish('abandoned'); return true; }
    if (humansAlive.length === 0 && this.humans.length && !this.settings.dev) { this._finish('abandoned'); return true; }
    return false;
  }

  // ------------------------------------------------------------ final
  _finish(reason) {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.players.values()) this._cancelWork(p, true);
    const vredAlive = [...this.players.values()].filter((p) => p.team === 'vrediteli' && p.alive && !p.left).length;
    const planPct = this.plan.points / this.plan.target;
    const openSab = this.incidents.filter((i) => i.open && i.type !== 'lights_off').length;
    const planOk = planPct >= 1 && openSab < BALANCE.openSabotageLimit;
    let outcome;
    let winner;
    if (reason === 'krediki') {
      if (vredAlive) { outcome = 'Кризис кредиков: Конторка в хаосе, вредители торжествуют'; winner = 'vrediteli'; }
      else { outcome = 'Кризис кредиков: Конторка обанкротилась, но вредителей уже нет. Никто не победил'; winner = 'none'; }
    } else if (reason === 'abandoned') {
      outcome = 'Матч прерван: в Конторке не осталось сотрудников'; winner = 'none';
    } else if (planOk && vredAlive === 0) {
      outcome = 'Победа Конторки: план выполнен, вредители обезврежены'; winner = 'kontorka';
    } else if (planOk) {
      outcome = 'Пограничная победа Конторки: план выполнен, но вредители остались в штате'; winner = 'kontorka_partial';
    } else if (vredAlive > 0) {
      outcome = openSab >= BALANCE.openSabotageLimit && planPct >= 1
        ? 'Победа вредителей: план формально выполнен, но слишком много незакрытых саботажей'
        : 'Победа вредителей: план сорван';
      winner = 'vrediteli';
    } else {
      outcome = 'Никто не победил: вредители уволены, но план сорван'; winner = 'none';
    }
    // Обещания: нестабильная награда, конвертируется частично
    const promiseRate = Math.round(this.rng.range(0.3, 0.75) * 100) / 100;
    const players = [...this.players.values()].map((p) => {
      const fromPromises = Math.round(p.promises * 20 * promiseRate);
      return {
        id: p.id, name: p.name, staff: p.staff, role: p.role, roleName: ROLES[p.role].name, team: p.team,
        alive: p.alive && !p.left, fired: p.firedAt != null, left: p.left, bot: p.isBot,
        tasksDone: p.tasksDone, repairs: p.repairs, sabotages: p.sabotagesDone, failed: p.failedTasks,
        kukishi: p.kukishi, promises: p.promises, promiseKukishi: fromPromises, total: p.kukishi + fromPromises,
      };
    });
    const timeline = this.incidents.map((i) => ({
      oc: i.ocStr, shift: i.shift, name: i.name, obj: i.objName, zone: ZONE_BY_ID[i.zone]?.name,
      culprit: this.players.get(i.culprit)?.name, discovered: i.discovered, open: i.open, failed: !!i.failed,
      resolvedBy: i.resolvedByName, nearby: (i.nearby || []).filter((id) => id !== i.culprit).map((id) => this.players.get(id)?.name),
      planted: i.planted.map((x) => this.players.get(x.target)?.name),
    }));
    const missed = this.incidents.filter((i) => !i.discovered).length;
    this.result = {
      reason, outcome, winner, plan: this.plan.points, planTarget: this.plan.target, planPct: Math.round(planPct * 100),
      openSab, missed, found: this.incidents.filter((i) => i.discovered).length, debiki: Math.round(this.debiki), krediki: Math.round(this.krediki),
      promiseRate, players, timeline,
      decisions: this.decisions.map((d) => ({ ...d, targetName: d.target ? this.players.get(d.target)?.name : null })),
      costs: { ...this.costs, openSab: openSab * 50, total: this.costs.stolen + this.costs.wrongFire + this.costs.explosions + openSab * 50 },
      seed: this.seed, log: this.matchLog.slice(-400),
    };
    this.phase = { name: 'final', end: this.t + 999 };
    this.logEvent('match_end', { outcome, winner });
    this.toAll({ t: 'phase', phase: this.publicPhase() });
    this.toAll({ t: 'result', r: this.result });
    this.onEnd(this.result);
  }

  // Отладочные команды (только лобби разработчика)
  _devCommand(p, msg) {
    if (this.phase.name !== 'work') return;
    const vred = [...this.players.values()].find((q) => q.role === 'vreditel' && q.alive) || p;
    switch (msg.cmd) {
      case 'fire_me':
        if (p.role === 'director') return;
        p.alive = false; p.firedAt = this.t; p.anim = 'fired';
        this._dropCarry(p); this._redistributeTasks(p);
        this.to(p, { t: 'fired' });
        break;
      case 'accel': {
        if (this.accel) return;
        const st = STATION_BY_ID.tech_acc1;
        const inc = this._createIncident(vred, 'accel_overload', st);
        this.accel = { inc: inc.id, until: this.t + BALANCE.accelCountdown, panels: [] };
        this._discover(inc, null, null, true);
        this.toAll({ t: 'fx', kind: 'alarm' });
        break;
      }
      case 'lights': {
        const z = zoneAt(p.x, p.z);
        this.dark[z] = this.t + BALANCE.lightsOff;
        const inc = this._createIncident(vred, 'lights_off', STATION_BY_ID.tech_shield, { zone: z, until: this.t + BALANCE.lightsOff, objName: `свет: ${ZONE_BY_ID[z].name}` });
        this._discover(inc, null, null, true);
        this.toAll({ t: 'fx', kind: 'lights_off', zone: z });
        break;
      }
      case 'smoke': this.debiki = 100; break;
      case 'krediki': this.krediki = 100; break;
      default:
    }
    this.dirty();
  }

  // --------------------------------------------------------- connections
  // Игрок сам покинул матч (кнопка «Покинуть матч»)
  playerLeft(pid) {
    const p = this.players.get(pid);
    if (!p || p.left || p.isBot) return;
    p.connected = false;
    p.left = true;
    p.alive = false;
    this._cancelWork(p, true);
    this._dropCarry(p);
    this._redistributeTasks(p);
    this.pub(`${p.name} покинул${p.gender === 'f' ? 'а' : ''} Конторку`, 'warn');
    this.logEvent('player_left', { id: p.id, voluntary: true });
    this._checkEarlyEnd();
  }

  setConnected(pid, connected) {
    const p = this.players.get(pid);
    if (!p || p.isBot) return;
    p.connected = connected;
    if (!connected) {
      p.disconnectedAt = this.t;
      this._cancelWork(p, true);
      this.pub(`${p.name}: связь потеряна`, 'warn');
    } else {
      p.disconnectedAt = null;
      p.lastInputT = this.t;
      p._wv = -1;
      this.sendInit(p);
    }
  }
}

const SAB_STATION_IDS = new Set(SABOTAGES.flatMap((s) => s.stations));
export const SAB_STATIONS = STATIONS.filter((s) => SAB_STATION_IDS.has(s.id));
const DISCOVER_BY_SIGHT = new Set(['printer_break', 'status_corrupt', 'folders_mix', 'locker_lock', 'soup_spoil']);
export const STATION_IDX = Object.fromEntries(STATIONS.map((s, i) => [s.id, i]));
export { CART_HOME };
