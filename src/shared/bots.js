// Тестовые боты (только режим разработчика): заполняют места, чтобы матч
// можно было прогнать малым составом. Поведение намеренно простое.
import { STATION_BY_ID, ZONE_BY_ID, DOORS, zoneAt, USE_RADIUS } from './map.js';
import { TASK_BY_ID, SABOTAGE_BY_ID, BALANCE } from './content.js';
import { LINES, fill, zoneLoc, nameVars, taskPhrase, fmtClock } from './text.js';

function parseClock(s) {
  if (!s) return null;
  const m = /^(\d+):(\d+)/.exec(s);
  return m ? +m[1] * 60 + +m[2] : null;
}

export class BotBrain {
  constructor(game, p, rng) {
    this.g = game;
    this.p = p;
    this.rng = rng;
    this.goal = null;
    this.path = null;
    this.pi = 0;
    this.thinkAt = 0;
    this.workUntil = 0;
    this.waitUntil = 0;
    this.susp = {};
    this.sightings = [];
    this.interactions = [];
    this.lastSeenAt = {};
    this.skipTask = {};
    this.lastWork = null;
    this.queue = [];
    this.sabNext = 25 + rng.range(0, 30);
    this.stuckT = 0;
    this.lastPos = { x: p.x, z: p.z };
    this.checkNext = 40 + rng.range(0, 40);
    this.logNext = 60 + rng.range(0, 60);
    this.voted = false;
    this.replied = new Set();
    this.checkResults = [];
    this.kassaFacts = [];
    this.barkAt = rng.range(20, 60);
  }

  get isVred() { return this.p.role === 'vreditel'; }

  isAlly(id) {
    const q = this.g.players.get(id);
    return this.isVred && q && q.role === 'vreditel';
  }

  addSusp(id, v) {
    if (id === this.p.id || this.isAlly(id)) return;
    this.susp[id] = (this.susp[id] || 0) + v;
  }

  topSuspect(minVal = 0) {
    let best = null;
    let bv = minVal;
    for (const [id, v] of Object.entries(this.susp)) {
      const q = this.g.players.get(id);
      if (!q || !q.alive || q.left) continue;
      if (v > bv) { bv = v; best = id; }
    }
    return best;
  }

  // ------------------------------------------------------------- main
  tick(dt) {
    const g = this.g;
    const p = this.p;
    if (!p.alive || p.left) return;
    if (g.phase.name === 'meeting') { this.meetingTick(); return; }
    if (g.phase.name !== 'work') { this.path = null; return; }
    if (p.work) {
      if (g.t >= this.workUntil) g.finishWork(p, { answer: g.order?.forged ? (this.rng.chance(0.75) ? 'fake' : 'same') : 'same' });
      return;
    }
    if (g.t < this.waitUntil) return;
    if (g.t > this.barkAt) {
      this.barkAt = g.t + this.rng.range(40, 120);
      if (this.rng.chance(0.4)) g.say(p, this.rng.pick(LINES.barks), 'near');
    }
    if (this.path) this.follow(dt);
    else if (g.t >= this.thinkAt) this.think();
  }

  goTo(x, z, goal) {
    const path = this.g.map.findPath(this.p.x, this.p.z, x, z);
    if (!path) { this.goal = null; this.thinkAt = this.g.t + 1; return false; }
    this.path = path;
    this.pi = 0;
    this.goal = goal;
    this.stuckT = 0;
    return true;
  }

  goStation(stId, goal) {
    const st = STATION_BY_ID[stId];
    return this.goTo(st.x, st.z, { ...goal, station: stId });
  }

  follow(dt) {
    const g = this.g;
    const p = this.p;
    const wp = this.path[this.pi];
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    const step = g.speedOf(p) * dt;
    if (d <= Math.max(step, 0.05)) {
      g.botMove(p, wp.x, wp.z, d > 0.01 ? Math.atan2(dx, dz) : p.rot);
      this.pi++;
      if (this.pi >= this.path.length) {
        this.path = null;
        p.moving = false;
        p.anim = p.carry === 'cart' ? 'carry' : 'idle';
        this.arrive();
      }
      return;
    }
    g.botMove(p, p.x + (dx / d) * step, p.z + (dz / d) * step, Math.atan2(dx, dz));
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) < 0.3) {
        const goal = this.goal;
        this.path = null;
        if (goal && goal.station) this.goStation(goal.station, goal);
        else this.thinkAt = g.t + 0.5;
      }
      this.lastPos = { x: p.x, z: p.z };
      this.stuckT = 0;
    }
  }

  arrive() {
    const g = this.g;
    const p = this.p;
    const goal = this.goal;
    this.goal = null;
    this.thinkAt = g.t + this.rng.range(0.3, 1.2);
    if (!goal) return;
    const call = (msg) => { g.handle(p.id, { t: 'interact', ...msg }); return !!p.work; };
    let dur = 0;
    switch (goal.action) {
      case 'task': {
        const task = p.tasks.find((t) => t.uid === goal.uid);
        if (!task) return;
        if (!call({ action: 'task', uid: task.uid, station: goal.station })) { this.skipTask[task.uid] = g.t + 25; return; }
        const def = TASK_BY_ID[task.id];
        dur = (p.work.min <= 1.01) ? this.rng.range(1.5, 2.6) : this.rng.range(def.dur[0], def.dur[1]);
        if (g.order?.id === 'no_chairs' && goal.station.startsWith('os_pc')) dur *= 1.3;
        this.lastWork = { task: task.name, zone: STATION_BY_ID[goal.station].zone, oc: g.oc() };
        break;
      }
      case 'repair':
        if (goal.item) {
          if (!call({ action: 'pickup', item: goal.item })) return;
        } else if (!call({ action: 'repair', station: goal.station })) return;
        dur = Math.max(p.work.min + 0.3, this.rng.range(3.2, 6));
        if (this.rng.chance(0.5)) g.say(p, this.rng.pick(LINES.repairBark), 'near');
        break;
      case 'sabotage': {
        const witnesses = g.alivePlayers.filter((q) => q !== p && !this.isAlly(q.id) && g.canSee(q, p)).length;
        if (witnesses > 1 || (witnesses === 1 && this.rng.chance(0.6))) {
          this.sabNext = g.t + this.rng.range(6, 14);
          return;
        }
        if (!call({ action: 'sabotage', sab: goal.sab, station: goal.station, zone: goal.zone })) { this.sabNext = g.t + 10; return; }
        dur = p.work.min + 0.2;
        break;
      }
      case 'cart_pick':
        if (!call({ action: 'pickup', item: 'cart' })) { this.sabNext = g.t + 15; return; }
        dur = p.work.min + 0.2;
        break;
      case 'drop':
        if (!call({ action: 'drop' })) { this.thinkAt = g.t + 1; return; }
        dur = p.work.min + 0.2;
        break;
      case 'check': {
        const target = this.pickCheckTarget();
        if (!target || !call({ action: 'check', target })) return;
        dur = p.work.min + 0.3;
        break;
      }
      case 'log':
        g.handle(p.id, { t: 'kassa_log' });
        this.waitUntil = g.t + 2;
        return;
      case 'eat': case 'coffee':
        if (!call({ action: goal.action })) return;
        dur = p.work.min + 0.4;
        break;
      case 'compare':
        this.compared = g.order ? `${g.order.id}:${g.order.version}` : null;
        if (!call({ action: 'compare' })) return;
        dur = p.work.min + this.rng.range(0.5, 2);
        break;
      case 'greet':
        g.handle(p.id, { t: 'greet' });
        this.waitUntil = g.t + 1.5;
        return;
      case 'wander':
        this.waitUntil = g.t + this.rng.range(2, 6);
        return;
      default:
    }
    this.workUntil = g.t + dur;
  }

  // ------------------------------------------------------------ decisions
  think() {
    const g = this.g;
    const p = this.p;
    this.thinkAt = g.t + 1;
    // 1. Перегрузка ускорителя — бежать стабилизировать
    if (g.accel && !this.isVred) {
      const panels = ['tech_acc1', 'tech_acc2', 'tech_acc3'].filter((s) => !g.accel.panels.includes(s));
      const helpers = g.alivePlayers.filter((q) => q.brain?.goal?.action === 'repair' && q.brain.goal.station?.startsWith('tech_acc'));
      if (helpers.length < 2 && panels.length) {
        const st = panels.find((s) => !helpers.some((h) => h.brain.goal.station === s)) || panels[0];
        this.goStation(st, { action: 'repair' });
        return;
      }
    }
    // 2. Несём что-то
    if (p.carry === 'cart') {
      const doors = DOORS.filter((d) => !g.map.doorClosed(d.id));
      const d = this.rng.pick(doors);
      const off = d.h ? { x: 0, z: (p.z < d.z ? -0.9 : 0.9) } : { x: (p.x < d.x ? -0.9 : 0.9), z: 0 };
      this.goTo(d.x + off.x, d.z + off.z, { action: 'drop' });
      return;
    }
    if (p.carry === 'folder') { this.goStation('arch_desk', { action: 'drop' }); return; }
    // 3. Саботаж
    if (this.isVred && g.t >= this.sabNext && p.sab.cdUntil <= g.t) {
      if (this.planSabotage()) return;
    }
    if (this.isVred && !p.sab.trickUsed && g.shift >= 2 && this.rng.chance(0.02)) this.useTrick();
    // 4. Ремонт известных инцидентов
    if (!this.isVred || this.rng.chance(0.25)) {
      const r = this.findRepair();
      if (r) { this.goTo(r.x, r.z, r.goal); return; }
    }
    // 5. Записюльки (проверить подлинность уточнения)
    const key = g.order ? `${g.order.id}:${g.order.version}` : null;
    if (!this.isVred && g.order && (g.order.version || 1) >= 2 && this.compared !== key && this.rng.chance(0.08)) {
      this.compared = key;
      this.goStation('ent_board', { action: 'compare' });
      return;
    }
    const o = g.order?.id;
    if (o === 'greet' && !p.greeted && p.role !== 'director') {
      const dir = g.alivePlayers.find((q) => q.role === 'director');
      if (dir && this.rng.chance(0.5)) {
        if (Math.hypot(dir.x - p.x, dir.z - p.z) < 2.5) { g.handle(p.id, { t: 'greet' }); this.waitUntil = g.t + 1; return; }
        this.goTo(dir.x, dir.z, { action: 'greet' });
        return;
      }
    }
    if (o === 'lunch' && !p.ate && this.rng.chance(0.3)) { this.goStation('can_pot', { action: 'eat' }); return; }
    // 6. Спецроли
    if (p.role === 'alesya' && p.checks > 0 && g.shiftClock > this.checkNext) {
      this.checkNext = g.shiftClock + this.rng.range(60, 110);
      this.goStation('kv_terminal', { action: 'check' });
      return;
    }
    if (p.role === 'dusya' && g.shiftClock > this.logNext) {
      this.logNext = g.shiftClock + this.rng.range(70, 120);
      this.goStation('kassa_tumba', { action: 'log' });
      return;
    }
    // 7. Батрачка
    const task = this.pickTask();
    if (task) { this.goStation(task.station, { action: 'task', uid: task.uid }); return; }
    // 8. Нечего делать: взять доп. задачу, кофе или побродить
    if (p.tasks.length === 0 && this.rng.chance(0.35)) {
      const board = STATION_BY_ID.ent_board;
      if (Math.hypot(board.x - p.x, board.z - p.z) < USE_RADIUS) {
        g.handle(p.id, { t: 'interact', action: 'extra' });
        return;
      }
      this.goStation('ent_board', { action: 'wander' });
      return;
    }
    if (this.rng.chance(0.15) && g.t - p.coffeeAt > 60) { this.goStation('can_coffee', { action: 'coffee' }); return; }
    const zone = this.rng.pick(Object.keys(ZONE_BY_ID));
    const pt = g.map.randomPointInZone(zone, this.rng);
    this.goTo(pt.x, pt.z, { action: 'wander' });
  }

  pickTask() {
    const g = this.g;
    const p = this.p;
    let best = null;
    let bd = Infinity;
    for (const t of p.tasks) {
      if ((this.skipTask[t.uid] || 0) > g.t) continue;
      const stId = t.steps[t.step];
      const st = STATION_BY_ID[stId];
      if (!st) continue;
      if (g.stationBlock(st, p, TASK_BY_ID[t.id] || {})) continue;
      if (g.stationBusy(stId, p)) continue;
      const d = Math.hypot(st.x - p.x, st.z - p.z) + this.rng.range(0, 8);
      if (d < bd) { bd = d; best = { uid: t.uid, station: stId }; }
    }
    // Вредитель иногда «работает спустя рукава»
    if (best && this.isVred && this.rng.chance(0.25)) return null;
    return best;
  }

  findRepair() {
    const g = this.g;
    const p = this.p;
    for (const inc of g.incidents) {
      if (!inc.open || !inc.discovered) continue;
      const taken = g.alivePlayers.some((q) => q !== p && q.brain?.goal?.inc === inc.id);
      if (taken) continue;
      if (inc.type === 'folders_mix') {
        const it = g.items.find((i) => i.id === inc.item && !i.carriedBy);
        if (it && Math.hypot(it.x - p.x, it.z - p.z) < 30) return { x: it.x, z: it.z, goal: { action: 'repair', item: it.id, inc: inc.id } };
        continue;
      }
      if (inc.type === 'cart_block') {
        const it = g.items.find((i) => i.id === 'cart');
        if (it && Math.hypot(it.x - p.x, it.z - p.z) < 30) {
          const door = DOORS.find((d) => d.id === inc.door);
          const side = door.h ? { x: 0, z: p.z < door.z ? -1.2 : 1.2 } : { x: p.x < door.x ? -1.2 : 1.2, z: 0 };
          return { x: it.x + side.x, z: it.z + side.z, goal: { action: 'repair', item: 'cart', inc: inc.id } };
        }
        continue;
      }
      if (inc.type === 'lights_off' || inc.type === 'accel_overload') continue;
      let stId = inc.station;
      if (inc.type === 'kukishi_steal') stId = 'kassa_tumba';
      if (inc.type === 'archive_lock') stId = 'kv_keybox';
      const st = STATION_BY_ID[stId];
      if (!st || g.stationBusy(stId, p)) continue;
      if (Math.hypot(st.x - p.x, st.z - p.z) > 28) continue;
      return { x: st.x, z: st.z, goal: { action: 'repair', station: stId, inc: inc.id } };
    }
    return null;
  }

  planSabotage() {
    const g = this.g;
    const p = this.p;
    const options = this.rng.shuffle(p.sab.loadout);
    for (const sabId of options) {
      const def = SABOTAGE_BY_ID[sabId];
      if (sabId === 'cart_block') {
        const cart = g.items.find((i) => i.id === 'cart');
        if (cart && cart.home && !cart.carriedBy) {
          this.goTo(cart.x - 1.0, cart.z, { action: 'cart_pick' });
          return true;
        }
        continue;
      }
      const stations = this.rng.shuffle(def.stations);
      for (const stId of stations) {
        const st = STATION_BY_ID[stId];
        const zone = sabId === 'lights_off' ? this.pickDarkZone() : null;
        const err = g.canSabotage({ ...p, x: st.x, z: st.z, work: null, carry: null }, sabId, st, zone);
        if (err) continue;
        this.goStation(stId, { action: 'sabotage', sab: sabId, zone });
        return true;
      }
    }
    this.sabNext = g.t + 15;
    return false;
  }

  pickDarkZone() {
    // Гасим свет там, где есть другой объект саботажа, или в людной зоне
    const zones = ['tech', 'archive', 'kassa', 'openspace', 'slop'];
    return this.rng.pick(zones);
  }

  useTrick() {
    const g = this.g;
    const p = this.p;
    const victims = g.alivePlayers.filter((q) => q !== p && q.role !== 'vreditel');
    if (!victims.length) return;
    const target = this.rng.pick(victims);
    g.handle(p.id, { t: 'trick', target: target.id });
  }

  pickCheckTarget() {
    const g = this.g;
    const p = this.p;
    const done = new Set(p.checksDone.map((c) => c.target));
    const top = this.topSuspect(0.5);
    if (top && !done.has(top)) return top;
    const pool = g.alivePlayers.filter((q) => q !== p && !done.has(q.id));
    return pool.length ? this.rng.pick(pool).id : null;
  }

  // ----------------------------------------------------------- observation
  observe(set) {
    const g = this.g;
    if (!this.p.alive) return;
    for (const id of set) {
      if (id === this.p.id) continue;
      const q = g.players.get(id);
      if (!q || !q.alive) continue;
      if ((this.lastSeenAt[id] || -9) > g.t - 1.5) continue;
      this.lastSeenAt[id] = g.t;
      this.sightings.push({ t: g.t, oc: g.oc(), id, zone: zoneAt(q.x, q.z), x: q.x, z: q.z, st: q.work?.station || null });
      if (q.work && q.work.kind === 'task') this.susp[id] = (this.susp[id] || 0) - 0.05;
      if (!q.work && !q.moving && g.t - q.idleSince > 20) this.addSusp(id, 0.08);
    }
    if (this.sightings.length > 400) this.sightings.splice(0, 100);
  }

  onSeenInteraction(q, st, oc) {
    this.interactions.push({ t: this.g.t, oc, id: q.id, st: st.id, zone: st.zone });
    if (this.interactions.length > 200) this.interactions.shift();
  }

  windowOf(inc) {
    const to = parseClock(inc.windowTo) ?? inc.oc;
    const from = parseClock(inc.windowFrom) ?? to - 3;
    return [from - 1, to + 1];
  }

  onIncident(inc) {
    if (!this.p.alive) return;
    const [from, to] = this.windowOf(inc);
    const st = STATION_BY_ID[inc.station];
    const hits = this.interactions.filter((s) => s.oc >= from && s.oc <= to && st && (s.st === st.id || Math.hypot(STATION_BY_ID[s.st].x - st.x, STATION_BY_ID[s.st].z - st.z) < 3));
    const ids = [...new Set(hits.map((h) => h.id))];
    for (const id of ids) this.addSusp(id, 2.5 / ids.length);
    const zoneHits = new Set(this.sightings.filter((s) => s.oc >= from && s.oc <= to && s.zone === inc.zone).map((s) => s.id));
    for (const id of zoneHits) this.addSusp(id, 0.4);
    for (const pl of inc.planted || []) this.addSusp(pl.target, 1.2);
  }

  onPlanted(inc, target) { if (inc.discovered) this.addSusp(target.id, 1.2); }
  onSabotage() {}
  onIncidentResolved(inc) {
    if (this.goal?.inc === inc.id) { this.goal = null; this.path = null; }
    if (inc.resolvedBy) this.addSusp(inc.resolvedBy, -0.6);
  }
  onCheck(target, res) {
    this.checkResults.push({ id: target.id, res, reported: false });
    this.addSusp(target.id, res === 'high' ? 3 : res === 'low' ? -2 : 0.3);
  }
  onKassaLog(log) {
    for (const e of log) {
      if (!e.anomaly) continue;
      const key = e.oc + e.op;
      if (this.kassaFacts.some((f) => f.key === key)) continue;
      this.kassaFacts.push({ key, oc: e.oc, near: e.near, reported: false });
      for (const name of e.near) {
        const q = [...this.g.players.values()].find((x) => x.name === name);
        if (q) this.addSusp(q.id, 1);
      }
    }
  }
  onAudit(inc, near) { for (const id of near) this.addSusp(id, 1.6 / Math.max(1, near.length)); }
  onDecision() {}
  onTeleport() { this.path = null; this.goal = null; }

  // --------------------------------------------------------------- meeting
  onMeetingStart() {
    const g = this.g;
    const p = this.p;
    this.queue = [];
    this.voted = false;
    this.replied.clear();
    this.path = null;
    this.goal = null;
    if (!p.alive) return;
    const base = g.t + BALANCE.meetingGather + this.rng.range(1, 12);
    const v = { g: p.gender };
    const lw = this.lastWork;
    const lines = [];
    if (lw) lines.push(fill(this.rng.pick(LINES.alibiTask), { ...v, task: taskPhrase(lw.task), loc: zoneLoc(lw.zone) }));
    else lines.push(fill(this.rng.pick(LINES.alibiWander), { ...v, loc: zoneLoc(zoneAt(p.x, p.z)) }));
    // Наблюдения по инцидентам этой шабашки
    const incs = g.incidents.filter((i) => i.discovered && i.shift === g.shift);
    for (const inc of incs.slice(-2)) {
      const [from, to] = this.windowOf(inc);
      if (!this.isVred) {
        const hit = this.interactions.find((s) => s.oc >= from && s.oc <= to && s.st === inc.station && s.id !== p.id);
        if (hit) {
          const q = g.players.get(hit.id);
          lines.push(fill(this.rng.pick(LINES.sawAt), { ...v, ...nameVars(q), at: STATION_BY_ID[hit.st].at, time: fmtClock(hit.oc) }));
        }
      } else if (this.rng.chance(0.55)) {
        const s = this.sightings.find((x) => x.oc >= from - 3 && x.oc <= to && !this.isAlly(x.id));
        if (s) {
          const q = g.players.get(s.id);
          lines.push(fill(this.rng.pick(LINES.sawInZone), { ...v, ...nameVars(q), loc: zoneLoc(inc.zone), time: fmtClock(s.oc) }));
        }
      }
    }
    for (const c of this.checkResults.filter((x) => !x.reported)) {
      const q = g.players.get(c.id);
      c.reported = true;
      if (!q) continue;
      const key = c.res === 'high' ? 'alesyaHigh' : c.res === 'low' ? 'alesyaLow' : 'alesyaMid';
      lines.push(fill(this.rng.pick(LINES[key]), { ...v, ...nameVars(q) }));
    }
    for (const f of this.kassaFacts.filter((x) => !x.reported)) {
      f.reported = true;
      lines.push(fill(this.rng.pick(LINES.dusyaLog), { ...v, time: f.oc, names: f.near.join(', ') || 'никого' }));
    }
    const top = this.isVred ? this.vredTarget() : this.topSuspect(2);
    if (top) {
      const q = g.players.get(top);
      lines.push(fill(this.rng.pick(LINES.accuse), { ...v, ...nameVars(q) }));
    } else if (this.rng.chance(0.5)) {
      lines.push(fill(this.rng.pick([...LINES.noInfo, ...LINES.filler]), v));
    }
    lines.forEach((text, i) => this.queue.push({ at: base + i * this.rng.range(4, 9), text }));
  }

  vredTarget() {
    const g = this.g;
    const tally = {};
    for (const v of Object.values(g.meeting?.votes || {})) tally[v] = (tally[v] || 0) + 1;
    const honest = g.alivePlayers.filter((q) => q.role !== 'vreditel' && q.id !== this.p.id);
    const voted = honest.filter((q) => tally[q.id]).sort((a, b) => tally[b.id] - tally[a.id])[0];
    if (voted) return voted.id;
    return this.rng.chance(0.4) && honest.length ? this.rng.pick(honest).id : null;
  }

  meetingTick() {
    const g = this.g;
    const p = this.p;
    if (!p.alive || !g.meeting) return;
    const sub = g.phase.sub;
    if (sub === 'discuss') {
      while (this.queue.length && this.queue[0].at <= g.t) g.say(p, this.queue.shift().text, 'meeting');
      if (!this.voted && g.phase.end - g.t < this.rng.range(4, 12)) {
        this.voted = true;
        const target = this.isVred ? this.vredTarget() : this.topSuspect(1.5);
        g.handle(p.id, { t: 'vote', target: target || 'skip' });
      }
      // Директор-бот вызывает на объяснительную самого подозрительного
      if (p.role === 'director' && !g.meeting.explainUsed && g.phase.end - g.t < 25 && this.rng.chance(0.02)) {
        const top = this.topSuspect(1.5);
        if (top) g.handle(p.id, { t: 'explain', target: top });
      }
    } else if (sub === 'decide' && p.role === 'director' && !g.meeting.decision && g.t > (this.decideAt || 0)) {
      this.decide();
    }
  }

  onDecidePhase() {
    if (this.p.role === 'director') this.decideAt = this.g.t + this.rng.range(3, 7);
    if (!this.voted && this.p.alive) {
      this.voted = true;
      const target = this.isVred ? this.vredTarget() : this.topSuspect(1.5);
      this.g.handle(this.p.id, { t: 'vote', target: target || 'skip' });
    }
  }

  decide() {
    const g = this.g;
    const m = g.meeting;
    const tally = {};
    for (const v of Object.values(m.votes)) tally[v] = (tally[v] || 0) + 1;
    const voters = g.alivePlayers.length;
    let top = null;
    let n = 0;
    for (const [id, c] of Object.entries(tally)) if (id !== 'skip' && c > n) { n = c; top = id; }
    const own = top ? (this.susp[top] || 0) : 0;
    if (g.sanctionsLeft > 0 && top && n >= Math.max(2, voters * 0.4) && (own > 0.5 || n >= voters * 0.5)) {
      g.handle(this.p.id, { t: 'decide', sanction: 'fire', target: top });
      return;
    }
    const unaudited = g.incidents.filter((i) => i.discovered && !i.auditResult && i.shift === g.shift);
    if (g.sanctionsLeft > 1 && unaudited.length && this.rng.chance(0.5)) {
      g.handle(this.p.id, { t: 'decide', sanction: 'audit', incident: this.rng.pick(unaudited).id });
      return;
    }
    const mine = this.topSuspect(2.5);
    if (g.sanctionsLeft > 1 && mine && this.rng.chance(0.5)) {
      const inc = g.incidents.filter((i) => i.discovered).slice(-1)[0];
      g.handle(this.p.id, { t: 'decide', sanction: 'restrict', target: mine, zone: inc ? inc.zone : 'tech' });
      return;
    }
    g.handle(this.p.id, { t: 'decide', sanction: 'none' });
  }

  onExplain() {
    const g = this.g;
    const p = this.p;
    const lw = this.lastWork;
    const v = { g: p.gender, task: lw ? taskPhrase(lw.task) : 'Батрачка', loc: zoneLoc(lw ? lw.zone : zoneAt(p.x, p.z)) };
    this.queue.unshift({ at: g.t + 2, text: fill(this.rng.pick(this.isVred ? LINES.explainLie : LINES.explain), v) });
  }

  onChat(from, text, ch) {
    const g = this.g;
    const p = this.p;
    if (from === p || !p.alive) return;
    const low = text.toLowerCase();
    // Обвинения в чате (простой разбор имён)
    for (const q of g.players.values()) {
      if (q === from || !q.alive) continue;
      const stem = q.name.toLowerCase().slice(0, 4);
      if (!low.includes(stem)) continue;
      const defending = /не он|не она|ручаюсь|не виноват|доверя|алиби|свой|своя/.test(low);
      const accusing = /вредит|подозр|видел|сломал|уволить|виноват|саботаж|он это|она это/.test(low);
      if (q === p) {
        if (accusing && !defending && ch === 'meeting' && !this.replied.has(from.id)) {
          this.replied.add(from.id);
          const lw = this.lastWork;
          const v = { g: p.gender, ...nameVars(from), task: lw ? taskPhrase(lw.task) : 'Батрачка', loc: zoneLoc(lw ? lw.zone : zoneAt(p.x, p.z)) };
          const pool = this.isVred && this.rng.chance(0.5) ? LINES.counter : LINES.replyAccused;
          this.queue.unshift({ at: g.t + this.rng.range(1.5, 3.5), text: fill(this.rng.pick(pool), v) });
        }
        continue;
      }
      if (accusing && !defending) this.addSusp(q.id, 0.5);
      if (defending) this.addSusp(q.id, -0.4);
    }
  }
}
