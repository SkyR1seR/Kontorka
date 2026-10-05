// Клиент матча: принимает состояние от сервера, предсказывает движение своего
// персонажа, интерполирует остальных, показывает HUD/планёрку и шлёт намерения.
import * as THREE from 'three';
import {
  STATIONS, STATION_BY_ID, ZONE_BY_ID, USE_RADIUS, MEETING_SEATS, zoneAt, nearestDoor, FURN_BY_ID,
} from '../shared/map.js';
import { SABOTAGE_BY_ID, TRICK_BY_ID, TASK_BY_ID, STAFF } from '../shared/content.js';
import { ANIM_CODES } from '../shared/game.js';
import { createHud } from './ui/hud.js';
import { createMeeting } from './ui/meeting.js';
import {
  showRoleReveal, showOrder, pickPlayer, pickOption, pickZone, showKassaLog, showResult,
} from './ui/overlays.js';
import { openMinigame, openHold } from './minigames/index.js';
import { audio } from './audio.js';
import { settings } from './settings.js';
import { h, clear } from './ui/dom.js';

const ANIMS = Object.keys(ANIM_CODES);
const QUICK = ['Здравствуйте!', 'Я тут работаю, не мешайте.', 'Видел саботаж! Пошли со мной.', 'Приходи в столовку.', 'Выдыхай.'];
const CARRY_NAMES = { folder: 'папка', cart: 'тележка', cabbage: 'капуста' };
const INTERP_DELAY = 110;

export class GameClient {
  constructor({ conn, renderer, layers, onLeave, onPause }) {
    this.conn = conn;
    this.r = renderer;
    this.layers = layers;
    this.onLeave = onLeave;
    this.onPause = onPause;
    this.players = new Map();
    this.myId = null;
    this.role = null;
    this.phase = null;
    this.world = null;
    this.me = null;
    this.meeting = null;
    this.snaps = [];
    this.pos = { x: 28, z: 32, rot: Math.PI };
    this.keys = new Set();
    this.working = null;
    this.pending = 0;
    this.lastSend = 0;
    this.sentPos = null;
    this.clock = '09:00';
    this.phaseLeft = 0;
    this.phaseAt = performance.now();
    this.lastZoneSeen = {};
    this.journalTick = 0;
    this.waveUntil = 0;
    this.spectateIdx = 0;
    this.camCut = null;
    this.alive = true;
    this.labels = new Map();
    this.overlay = null;
    this.ended = false;

    const api = {
      say: (text) => this.say(text),
      openOrder: () => this.openOrder(),
      openTrick: () => this.openTrick(),
      callMeeting: () => this.send({ t: 'call_meeting' }),
      playerName: (id) => this.players.get(id)?.name || '?',
    };
    this.hud = createHud(layers.hud, api);
    this.mt = createMeeting(layers.meeting, {
      say: (t) => this.send({ t: 'chat', text: t }),
      vote: (target) => this.send({ t: 'vote', target }),
      skipReady: () => { this.send({ t: 'skip_ready' }); this.hud.toast('Вы готовы к решению'); },
      explain: (target) => this.send({ t: 'explain', target }),
      decide: (d) => this.send({ t: 'decide', ...d }),
      journal: () => this.hud.journalEntries(),
    });
    this.labelLayer = h('div', { class: 'labels' });
    layers.hud.append(this.labelLayer);
    this.holdLayer = layers.overlay;

    this._onKeyDown = (e) => this.keyDown(e);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouse = (e) => this.mouseMove(e);
    this._onWheel = (e) => { this.r.cam.dist = Math.max(1.6, Math.min(6, this.r.cam.dist + Math.sign(e.deltaY) * 0.35)); };
    this._onClick = () => this.canvasClick();
    this._onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouse);
    window.addEventListener('blur', this._onBlur);
    this.r.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: true });
    this.r.renderer.domElement.addEventListener('click', this._onClick);
    this._onCtx = (e) => e.preventDefault();
    this.r.renderer.domElement.addEventListener('contextmenu', this._onCtx);
    this.r.setCamMode(settings.camMode);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouse);
    window.removeEventListener('blur', this._onBlur);
    this.r.renderer.domElement.removeEventListener('wheel', this._onWheel);
    this.r.renderer.domElement.removeEventListener('click', this._onClick);
    this.r.renderer.domElement.removeEventListener('contextmenu', this._onCtx);
    this.closeWork();
    this.closeOverlay();
    this.hud.el && this.layers.hud.replaceChildren();
    this.layers.meeting.replaceChildren();
    this.r.clearCharacters();
    this.r.setCinematic(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  send(msg) { this.conn.send(msg); }
  nameOf(id) { return this.players.get(id)?.name || (id === 'npc_bidonya' ? 'Бидонья' : id === 'npc_tosya' ? 'Тося Бося' : '?'); }

  // ------------------------------------------------------------ messages
  handle(msg) {
    switch (msg.t) {
      case 'init': return this.onInit(msg);
      case 'role': return this.onRole(msg);
      case 'phase': return this.onPhase(msg.phase);
      case 'world': this.world = msg.w; this.r.applyWorld(msg.w); return;
      case 'snap': return this.onSnap(msg);
      case 'tp':
        if (msg.soft && Math.hypot(msg.x - this.pos.x, msg.z - this.pos.z) < 0.6) return;
        this.pos.x = msg.x; this.pos.z = msg.z; if (Number.isFinite(msg.rot)) this.pos.rot = msg.rot;
        return;
      case 'order': return this.onOrder(msg);
      case 'meeting': return this.onMeeting(msg);
      case 'decision':
        this.hud.banner(msg.d.text, 'Решение Директора', 5000);
        if (this.mt.visible()) this.mt.subtitle('ДИРЕКТОР', msg.d.text);
        if (msg.d.sanction === 'fire') audio.ui('bad'); else audio.ui('notice');
        return;
      case 'explain':
        if (msg.target === this.myId) { this.hud.toast('Вас вызвали на объяснительную! Объяснитесь в чате.', 'warn', 6000); audio.ui('alarm'); }
        return;
      case 'speech': return this.onSpeech(msg);
      case 'sound': if (msg.from !== this.myId || true) audio.play(msg.kind, msg.x, msg.z); return;
      case 'incident': return this.onIncident(msg);
      case 'notice': this.hud.toast(msg.text, msg.kind); if (msg.kind === 'warn') audio.ui('bad'); else if (msg.kind === 'good') audio.ui('good'); else if (msg.kind === 'sab') audio.ui('sab'); else audio.ui('notice'); return;
      case 'work_start': return this.onWorkStart(msg.work);
      case 'work_reject': this.pending = 0; return;
      case 'work_end': return this.onWorkEnd(msg);
      case 'task_done': this.hud.toast(`Готово: ${msg.name} (+${msg.kukishi} кукишей)`, 'good'); return;
      case 'seen': return this.onSeen(msg);
      case 'check_result':
        this.hud.toast(`Квадровая проверка: ${msg.name} — ${msg.label}`, msg.res === 'high' ? 'warn' : 'good', 8000);
        this.hud.addJournal({ oc: this.clock, kind: 'special', text: `Квадровая проверка: ${msg.name} — ${msg.label.toUpperCase()}` });
        return;
      case 'kassa_log':
        this.closeOverlay();
        this.overlay = showKassaLog(this.layers.overlay, msg.log);
        for (const e of msg.log.filter((x) => x.anomaly)) this.hud.addJournal({ oc: e.oc, kind: 'special', text: `Журнал кукишей: аномалия ${e.delta} (${e.op}), рядом: ${e.near.join(', ') || 'никого'}` });
        return;
      case 'fx':
        if (msg.kind === 'explosion') { this.r.explosion(); audio.play('explosion'); this.hud.banner('КАЛОИДНЫЙ ВЫБРОС!', 'План −4, кредики +20', 4000); }
        if (msg.kind === 'lights_off') { audio.play('lights_off'); }
        if (msg.kind === 'alarm') { audio.play('alarm'); this.hud.banner('ПЕРЕГРУЗКА УСКОРИТЕЛЯ!', 'Стабилизируйте две панели в Техзоне', 4000); }
        return;
      case 'fired':
        this.alive = false;
        this.hud.banner('ВЫ УВОЛЕНЫ', 'Пропуск сдан. Теперь вы наблюдаете за Конторкой. [Tab] — сменить сотрудника', 6000);
        return;
      case 'result': return this.onResult(msg.r);
      default:
    }
  }

  onInit(msg) {
    this.myId = msg.you;
    this.players.clear();
    this.r.clearCharacters();
    for (const p of msg.players) {
      this.players.set(p.id, p);
      this.r.addCharacter(p.id, p.staff, p.name);
      this.r.setCharState(p.id, { visible: false });
    }
    this.ended = false;
    this.hud.show(true);
  }

  onRole(msg) {
    this.role = msg;
  }

  onPhase(ph) {
    const prev = this.phase;
    this.phase = ph;
    this.phaseLeft = ph.left;
    this.phaseAt = performance.now();
    if (ph.name === 'intro' && ph.sub === 'role' && (!prev || prev.sub !== 'role')) this.showRoleIntro();
    if (ph.name === 'intro' && ph.sub === 'order') {
      if (this.overlay?.classList?.contains('role-reveal')) this.closeOverlay();
      this.r.setCinematic(null);
    }
    if (ph.name === 'work') {
      if (prev?.name !== 'work') {
        this.closeOverlay();
        this.mt.hide();
        this.r.setCinematic(null);
        this.camCut = null;
        if (prev?.name === 'intro' || prev?.name === 'meeting') {
          this.hud.banner(ph.shift === 3 ? 'ФИНАЛЬНАЯ ШАБАШКА' : `ШАБАШКА №${ph.shift}`, prev?.name === 'meeting' ? 'Работаем дальше' : 'За работу!', 2600);
          // камера смотрит туда же, куда персонаж
          this.r.cam.yaw = this.pos.rot;
        }
      }
    }
    if (ph.name === 'meeting' && prev?.name !== 'meeting') {
      this.closeWork();
      this.closeOverlay();
      this.hud.toggleJournal(false);
      if (document.pointerLockElement) document.exitPointerLock();
      audio.ui('meeting');
    }
    if (ph.name === 'smoke') {
      this.closeWork();
      this.hud.banner('ДЕБИКОВЫЙ КРИЗИС', 'Принудительный перекур в Столовой — 15 секунд', 8000);
    }
    if (ph.name === 'final') this.closeWork();
  }

  onSnap(msg) {
    const now = performance.now();
    this.snaps.push({ t: now, ps: msg.ps });
    while (this.snaps.length > 30) this.snaps.shift();
    this.me = msg.me;
    if (msg.ph) { this.phase = { ...this.phase, ...msg.ph }; this.phaseLeft = msg.ph.left; this.phaseAt = now; }
    this.clock = msg.clock;
    this.aud = msg.aud;
    if (msg.w) { this.world = msg.w; this.r.applyWorld(msg.w); }
    if (this.me) this.alive = this.me.alive;
  }

  onOrder(msg) {
    const o = msg.order;
    if (this.world) this.world.order = o;
    if (msg.silent) return;
    audio.ui('order');
    if (msg.restored) { this.hud.toast(`Подделка разоблачена! Действует исходная записюлька: «${o.title}»`, 'good', 7000); return; }
    if (msg.update) {
      this.hud.toast(`Хозяин прислал уточнение: «${o.title}»`, 'order', 7000);
      this.hud.addJournal({ oc: this.clock, kind: 'order', text: `Уточнение записюльки: «${o.title}» (печать: ${o.stamp})` });
      if (!this.working && !this.overlay) this.openOrder(6000);
      return;
    }
    this.hud.addJournal({ oc: this.clock, kind: 'order', text: `Записюлька: «${o.title}»` });
    this.closeOverlay();
    this.overlay = showOrder(this.layers.overlay, o, { auto: 9000, onClose: () => { this.overlay = null; } });
  }

  openOrder(auto) {
    const o = this.world?.order;
    if (!o) return;
    this.closeOverlay();
    this.overlay = showOrder(this.layers.overlay, o, { auto, onClose: () => { this.overlay = null; } });
  }

  onMeeting(msg) {
    const m = msg.m;
    const first = !this.meeting || this.meeting.id !== m.id;
    this.meeting = m;
    const ctx = this.meetingCtx(msg.reason);
    if (first) {
      this.mt.show(m, ctx);
      this.hud.show(false);
    } else this.mt.update(m, ctx);
  }

  meetingCtx(reason) {
    const aliveMap = this.world?.alive || {};
    return {
      players: [...this.players.values()], myId: this.myId, alive: this.alive, aliveMap,
      isDirector: this.role?.role === 'director', portrait: (s) => this.r.portrait(s),
      allies: this.role?.allies || [], afk: this.world?.afk || [], nameOf: (id) => this.nameOf(id),
      reason: reason || this._meetingReason,
    };
  }

  onSpeech(msg) {
    const name = this.nameOf(msg.from).toUpperCase();
    this.r.talk(msg.from, Math.min(6, 1.5 + msg.text.length * 0.05));
    const p = this.players.get(msg.from);
    const female = p ? p.gender === 'f' : true;
    if (msg.ch === 'meeting' || this.phase?.name === 'meeting') {
      this.mt.addChat(this.nameOf(msg.from), msg.text, msg.from === this.myId);
      this.mt.subtitle(name, msg.text);
      this.cutTo(msg.from);
      audio.mumble(msg.text, { female });
    } else {
      this.hud.subtitle(name, msg.text);
      const c = this.r.chars.get(msg.from);
      audio.mumble(msg.text, { female, near: true, x: c?.x, z: c?.z });
    }
  }

  onIncident(msg) {
    const i = msg.inc;
    if (msg.update) return;
    this.hud.toast(`ИНЦИДЕНТ: ${i.name} — ${i.zoneName}${msg.by ? ` (заметил: ${msg.by})` : ''}`, 'alarm', 6500);
    this.hud.addJournal({ oc: this.clock, kind: 'incident', text: `Инцидент: ${i.name} — ${i.zoneName}, ${i.obj}. Время: ${i.window || '?'}` });
    audio.ui('alarm');
  }

  onSeen(msg) {
    const st = STATION_BY_ID[msg.station];
    const name = this.nameOf(msg.id);
    this.hud.addJournal({ oc: msg.oc, kind: 'seen', text: `${name} ${st.at} (${ZONE_BY_ID[st.zone].name})` });
  }

  onResult(r) {
    this.ended = true;
    this.closeWork();
    this.closeOverlay();
    this.mt.hide();
    this.hud.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    // финальная сцена: все сотрудники в Опенспейсе
    this.r.setCinematic({ pos: new THREE.Vector3(28, 2.2, 26.5), look: new THREE.Vector3(28, 1.2, 20), fov: 55, drift: 1.2 });
    const list = [...this.players.values()];
    list.forEach((p, i) => {
      const c = this.r.chars.get(p.id);
      if (!c) return;
      Object.assign(c, { x: 22 + (i % 6) * 2.3, z: 20.6 + Math.floor(i / 6) * 1.6, rot: 0, anim: r.players.find((x) => x.id === p.id)?.team === 'vrediteli' ? 'panic' : 'wave', visible: true, carry: null });
    });
    this.overlay = showResult(this.layers.overlay, r, {
      portrait: (s) => this.r.portrait(s), myId: this.myId,
      onLobby: () => { this.send({ t: 'to_lobby' }); this.onLeave?.('lobby'); },
    });
  }

  // ------------------------------------------------------------ intro
  showRoleIntro() {
    const r = this.role;
    if (!r) { setTimeout(() => this.showRoleIntro(), 200); return; }
    this.closeOverlay();
    const meChar = this.r.chars.get(this.myId);
    const allyNames = (r.allies || []).map((id) => this.nameOf(id));
    if (meChar) {
      // Камера перед лицом, персонаж — в правой части кадра (слева текст роли)
      const pos = new THREE.Vector3();
      const look = new THREE.Vector3();
      this.r.setCinematic({
        key: 'role', fov: 40,
        fn: (cam, t) => {
          const fx = Math.sin(this.pos.rot);
          const fz = Math.cos(this.pos.rot);
          const hy = 1.62 * (meChar.rig.root.scale.x || 1);
          Object.assign(meChar, { x: this.pos.x, z: this.pos.z, rot: this.pos.rot, visible: true });
          pos.set(this.pos.x + fx * 1.2 + Math.sin(t * 0.3) * 0.04, hy + 0.04, this.pos.z + fz * 1.2);
          look.set(this.pos.x - fz * 0.42, hy - 0.05, this.pos.z + fx * 0.42);
          cam.position.copy(pos);
          cam.lookAt(look);
        },
      });
      this.soloShot = true;
    }
    this.hud.show(false);
    this.overlay = showRoleReveal(this.layers.overlay, r, {
      playerName: this.players.get(this.myId)?.name || '', allyNames,
      onSkip: () => { this.send({ t: 'skip_ready' }); this.closeOverlay(); },
    });
    audio.ui(r.role === 'vreditel' ? 'sab' : 'order');
  }

  closeOverlay() {
    if (this.overlay) {
      if (this.overlay.classList?.contains('role-reveal')) { this.soloShot = false; this.hud.show(true); }
      this.overlay.remove?.();
      this.overlay = null;
    }
  }

  // ------------------------------------------------------------ input
  typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  keyDown(e) {
    if (this.typing()) return;
    this.keys.add(e.code);
    if (e.repeat) return;
    const ph = this.phase?.name;
    if (ph === 'meeting') {
      if (e.key === 'Enter') { e.preventDefault(); this.mt.focusInput(); }
      return;
    }
    if (this.ended) return;
    if (this.working && e.code !== 'Escape') return;
    switch (e.code) {
      case 'Enter': e.preventDefault(); this.hud.focusChat(); break;
      case 'KeyE': case 'KeyR': case 'KeyF': case 'KeyT': {
        const act = this._actions?.find((a) => a.key === e.code.slice(3));
        if (act && !act.disabled) { act.run(); audio.ui('click'); }
        else if (e.code === 'KeyT' && this.role?.role === 'vreditel') this.openTrick();
        break;
      }
      case 'KeyG': this.greet(); break;
      case 'KeyB': if (this.role?.role === 'director') this.send({ t: 'call_meeting' }); break;
      case 'KeyJ': this.hud.toggleJournal(); break;
      case 'KeyM': this.hud.toggleMap(); break;
      case 'KeyO': this.openOrder(); break;
      case 'Tab': e.preventDefault(); if (!this.alive) this.spectateIdx++; break;
      case 'Escape':
        if (this.overlay) { this.closeOverlay(); break; }
        if (!document.pointerLockElement) this.onPause?.();
        break;
      default:
        if (/^Digit[1-5]$/.test(e.code)) this.say(QUICK[Number(e.code.slice(5)) - 1]);
    }
  }

  mouseMove(e) {
    if (document.pointerLockElement !== this.r.renderer.domElement) {
      // правая кнопка — поворот камеры без захвата мыши
      if (e.buttons & 2 && e.target === this.r.renderer.domElement) this.r.cam.yaw -= e.movementX * 0.006 * settings.mouseSens;
      return;
    }
    const s = 0.0024 * settings.mouseSens;
    this.r.cam.yaw -= e.movementX * s;
    this.r.cam.pitch = Math.max(-0.35, Math.min(1.0, this.r.cam.pitch + e.movementY * s * (settings.invertY ? -1 : 1)));
  }

  canvasClick() {
    audio.init();
    if (this.phase?.name !== 'work' || this.working || this.overlay || this.ended) return;
    if (settings.camMode !== 'follow') return;
    if (!document.pointerLockElement) this.r.renderer.domElement.requestPointerLock?.();
  }

  say(text) {
    const t = String(text || '').trim();
    if (!t) return;
    this.send({ t: 'chat', text: t });
  }

  greet() {
    this.send({ t: 'greet' });
    this.waveUntil = performance.now() + 1500;
  }

  // ------------------------------------------------------------ actions
  interact(msg) {
    if (this.pending && performance.now() - this.pending < 1500) return;
    this.pending = performance.now();
    if (document.pointerLockElement) document.exitPointerLock();
    this.send({ t: 'interact', ...msg });
  }

  repairIncAt(stId) {
    const w = this.world;
    if (!w) return null;
    for (const i of w.incidents || []) {
      if (!i.open) continue;
      if (['printer_break', 'status_corrupt', 'locker_lock', 'soup_spoil'].includes(i.type) && i.station === stId) return i;
      if (i.type === 'kukishi_steal' && stId === 'kassa_tumba') return i;
      if (i.type === 'archive_lock' && stId === 'kv_keybox') return i;
      if (i.type === 'accel_overload' && stId.startsWith('tech_acc') && w.accel && !w.accel.panels.includes(stId)) return i;
    }
    return null;
  }

  computeActions() {
    const me = this.me;
    const w = this.world;
    const out = [];
    if (!me || !w || this.phase?.name !== 'work' || this.working || !this.alive) return out;
    const p = this.pos;
    const d = (s) => Math.hypot(s.x - p.x, s.z - p.z);
    const near = STATIONS.filter((s) => d(s) <= USE_RADIUS).sort((a, b) => d(a) - d(b));
    const has = (id) => near.some((s) => s.id === id);
    let E = null;
    if (me.carry === 'folder' && has('arch_desk')) E = { label: 'Вернуть папку на стол архивариуса', run: () => this.interact({ action: 'drop' }) };
    if (!E && !me.carry) {
      const f = (w.items || []).find((i) => i.kind === 'folder' && !i.carriedBy && Math.hypot(i.x - p.x, i.z - p.z) <= USE_RADIUS + 0.2);
      if (f) E = { label: 'Подобрать папку (вернуть в Архив)', run: () => this.interact({ action: 'pickup', item: f.id }) };
    }
    if (!E && !me.carry) {
      const cart = (w.items || []).find((i) => i.kind === 'cart' && !i.carriedBy && i.door);
      if (cart && Math.hypot(cart.x - p.x, cart.z - p.z) <= USE_RADIUS + 0.4) E = { label: 'Откатить тележку от двери', run: () => this.interact({ action: 'pickup', item: 'cart' }) };
    }
    if (!E) {
      for (const s of near) {
        const t = me.tasks.find((x) => x.steps[x.step] === s.id);
        if (t) {
          const step = t.steps.length > 1 ? ` (${t.step + 1}/${t.steps.length})` : '';
          E = { label: `${t.name}${step}`, run: () => this.interact({ action: 'task', uid: t.uid, station: s.id }) };
          break;
        }
      }
    }
    if (!E) {
      for (const s of near) {
        const inc = this.repairIncAt(s.id);
        if (inc) { E = { label: `Устранить: ${inc.name}`, cls: 'prompt-repair', run: () => this.interact({ action: 'repair', station: s.id }) }; break; }
      }
    }
    if (!E && has('ent_board') && me.tasks.length <= 1) E = { label: 'Взять доп. батрачку', run: () => this.interact({ action: 'extra' }) };
    if (!E && has('can_coffee')) E = { label: 'Выпить кофе (кредики −5, дебики +3)', run: () => this.interact({ action: 'coffee' }) };
    if (!E && has('dir_bell') && !me.bellUsed) E = { label: 'Созвать внеочередную планёрку', cls: 'prompt-repair', run: () => this.confirmBell() };
    if (E) out.push({ key: 'E', ...E });
    // R — особые действия
    let R = null;
    if (has('ent_board') && (w.order?.version || 1) >= 2) R = { label: 'Сравнить версии записюльки', run: () => this.interact({ action: 'compare' }) };
    else if (has('kv_terminal') && this.role?.role === 'alesya' && me.checks > 0) R = { label: `Квадровая проверка (${me.checks})`, run: () => this.openCheck() };
    else if (has('kassa_tumba') && this.role?.role === 'dusya') R = { label: 'Журнал кукишей', run: () => this.send({ t: 'kassa_log' }) };
    else if (this.role?.role === 'dusya' && w.order?.id === 'lockers_inv') R = { label: 'Журнал кукишей (удалённо)', run: () => this.send({ t: 'kassa_log' }) };
    else if (has('can_pot') && w.order?.id === 'lunch' && !me.ate) R = { label: 'Съесть тарелку щей', run: () => this.interact({ action: 'eat' }) };
    else if (has('ent_board')) R = { label: 'Прочитать записюльку', run: () => this.openOrder() };
    if (R) out.push({ key: 'R', ...R });
    // F — саботаж
    if (this.role?.role === 'vreditel' && this.role.sab) {
      const load = this.role.sab.loadout;
      const cd = me.cd > 0;
      let F = null;
      if (me.carry === 'cart') {
        const door = nearestDoor(p.x, p.z, 2.6);
        F = door ? { label: 'Поставить тележку в проходе', run: () => this.interact({ action: 'drop' }) } : { label: 'Тележка: подкати к двери', disabled: true, run: () => {} };
      } else if (load.includes('cart_block')) {
        const cart = (w.items || []).find((i) => i.kind === 'cart' && !i.carriedBy && !i.door);
        if (cart && Math.hypot(cart.x - p.x, cart.z - p.z) <= USE_RADIUS + 0.4) F = { label: cd ? `Взять тележку (через ${Math.ceil(me.cd)} с)` : 'Саботаж: взять тележку', disabled: cd, run: () => this.interact({ action: 'pickup', item: 'cart' }) };
      }
      if (!F) {
        const opts = [];
        for (const s of near) {
          for (const sid of load) {
            if (sid === 'cart_block') continue;
            if (SABOTAGE_BY_ID[sid].stations.includes(s.id)) opts.push({ sid, st: s });
          }
        }
        if (opts.length) {
          const label = opts.length === 1 ? `Саботаж: ${SABOTAGE_BY_ID[opts[0].sid].name}` : 'Саботаж (выбрать)';
          F = { label: cd ? `${label} — ${Math.ceil(me.cd)} с` : label, disabled: cd, cls: 'prompt-sab', run: () => this.chooseSabotage(opts) };
        }
      }
      if (F) out.push({ key: 'F', cls: 'prompt-sab', ...F });
    }
    // приветствие Директора по записюльке
    if (w.order?.id === 'greet' && !me.greeted && this.role?.role !== 'director') {
      const dir = [...this.r.chars.values()].find((c) => c.visible && c.role === 'director');
      void dir;
    }
    return out;
  }

  confirmBell() {
    this.closeOverlay();
    this.overlay = pickOption(this.layers.overlay, {
      title: 'Созвать внеочередную планёрку?',
      options: [{ label: 'Да, звоним! (один раз за матч)', value: 'yes' }, { label: 'Нет, передумал', value: 'no' }],
      onPick: (v) => { this.overlay = null; if (v === 'yes') this.interact({ action: 'bell' }); },
      onCancel: () => { this.overlay = null; },
    });
  }

  chooseSabotage(opts) {
    const go = (o) => {
      if (o.sid === 'lights_off') {
        this.closeOverlay();
        this.overlay = pickZone(this.layers.overlay, {
          title: 'Где вырубить свет?',
          onPick: (zone) => { this.overlay = null; this.interact({ action: 'sabotage', sab: o.sid, station: o.st.id, zone }); this.keys.add('KeyF'); },
          onCancel: () => { this.overlay = null; },
        });
        return;
      }
      this.interact({ action: 'sabotage', sab: o.sid, station: o.st.id });
    };
    if (opts.length === 1) { go(opts[0]); return; }
    this.closeOverlay();
    this.overlay = pickOption(this.layers.overlay, {
      title: 'Какой саботаж?',
      options: opts.map((o, i) => ({ label: SABOTAGE_BY_ID[o.sid].name, sub: `${SABOTAGE_BY_ID[o.sid].cat} · ${o.st.name}`, value: i })),
      onPick: (i) => { this.overlay = null; this.keys.add('KeyF'); go(opts[i]); },
      onCancel: () => { this.overlay = null; },
    });
  }

  openCheck() {
    const list = [...this.players.values()].filter((p) => p.id !== this.myId && this.world?.alive?.[p.id]);
    this.closeOverlay();
    this.overlay = pickPlayer(this.layers.overlay, {
      title: 'Квадровая проверка — кого проверить?', players: list, portrait: (s) => this.r.portrait(s),
      note: 'Результат: «низкий риск», «неопределённо» или «высокий риск». Это не раскрывает роль.',
      onPick: (id) => { this.overlay = null; this.interact({ action: 'check', target: id }); },
      onCancel: () => { this.overlay = null; },
    });
  }

  openTrick() {
    if (this.role?.role !== 'vreditel' || this.me?.trickUsed || this.phase?.name !== 'work') return;
    const tr = TRICK_BY_ID[this.role.sab.trick];
    const list = [...this.players.values()].filter((p) => p.id !== this.myId && this.world?.alive?.[p.id] && !(this.role.allies || []).includes(p.id));
    this.closeOverlay();
    if (document.pointerLockElement) document.exitPointerLock();
    this.overlay = pickPlayer(this.layers.overlay, {
      title: `${tr.name} — кого подставить?`, players: list, portrait: (s) => this.r.portrait(s), note: tr.desc,
      onPick: (id) => { this.overlay = null; this.send({ t: 'trick', target: id }); },
      onCancel: () => { this.overlay = null; },
    });
  }

  onWorkStart(work) {
    this.pending = 0;
    this.closeWork();
    this.closeOverlay();
    if (document.pointerLockElement) document.exitPointerLock();
    const st = STATION_BY_ID[work.station];
    this.working = { work, kind: st?.kind || 'rummage' };
    const done = (res = {}) => { this.send({ t: 'work_done', ...res }); this.working.ui = null; };
    const cancel = () => { this.send({ t: 'work_cancel' }); this.working = null; };
    const holdLabel = {
      sabotage: `Саботаж: ${SABOTAGE_BY_ID[work.sab]?.name || ''}`, pickup: work.sabotage ? 'Берём тележку…' : 'Поднимаем…', drop: 'Ставим…',
      eat: 'Едим кислые щи…', coffee: 'Пьём кофе…', check: 'Квадровая проверка…', repair: 'Устраняем…',
    }[work.kind] || 'Работаем…';
    if (work.kind === 'task' || work.kind === 'compare' || (work.kind === 'repair' && work.mg && work.mg !== 'hold')) {
      const task = this.me?.tasks.find((t) => t.uid === work.uid);
      const title = work.kind === 'task' ? (task?.name || 'Задача') : work.kind === 'compare' ? 'Сравнение версий записюльки' : 'Устранение неисправности';
      const hint = work.kind === 'task' ? task?.hint : '';
      const stepLabel = task && task.steps.length > 1 ? `Шаг ${task.step + 1} из ${task.steps.length}: ${STATION_BY_ID[task.steps[task.step]]?.name}` : st?.name;
      this.working.ui = openMinigame(this.layers.overlay, {
        mg: work.mg, title, hint, stepLabel, data: work.data, myName: this.players.get(this.myId)?.name,
        extra: this.world?.order?.id === 'no_chairs' && work.station?.startsWith('os_pc'),
        onDone: done, onCancel: cancel,
      });
    } else {
      const key = work.kind === 'sabotage' || (work.kind === 'pickup' && work.sabotage) || (work.kind === 'drop' && work.sabotage) ? 'F' : 'E';
      const requireHold = work.kind === 'sabotage' || work.kind === 'repair';
      this.working.ui = openHold(this.layers.overlay, {
        label: holdLabel, seconds: work.min + 0.1, key, requireHold, held: () => this.keys.has(`Key${key}`),
        onDone: () => done(), onCancel: cancel,
      });
    }
  }

  onWorkEnd(msg) {
    if (this.working?.ui) this.working.ui.close();
    this.working = null;
    if (msg.forced) return;
    if (!msg.ok && !msg.cancelled) audio.ui('bad');
  }

  closeWork() {
    if (this.working?.ui) this.working.ui.close();
    this.working = null;
  }

  // ------------------------------------------------------------ frame
  frame(dt) {
    const now = performance.now();
    const ph = this.phase?.name;
    // таймер фазы
    const left = Math.max(0, this.phaseLeft - (now - this.phaseAt) / 1000);
    // движение своего персонажа
    const canMove = ph === 'work' && !this.working && !this.overlay && !this.typing() && !this.ended;
    let moving = false;
    if (canMove || (ph === 'work' && !this.alive)) {
      let fx = 0;
      let fz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx += 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx -= 1;
      if (this.keys.has('KeyZ')) this.r.cam.yaw += dt * 2.2;
      if (this.keys.has('KeyC')) this.r.cam.yaw -= dt * 2.2;
      if (fx || fz) {
        const yaw = this.r.cam.yaw;
        const len = Math.hypot(fx, fz);
        const dx = (Math.sin(yaw) * fz + Math.cos(yaw) * fx) / len;
        const dz = (Math.cos(yaw) * fz - Math.sin(yaw) * fx) / len;
        const speed = this.me?.speed || 3.6;
        const nx = this.pos.x + dx * speed * dt;
        const nz = this.pos.z + dz * speed * dt;
        const c = this.alive ? this.r.map.collide(nx, nz) : { x: Math.max(0.5, Math.min(55.5, nx)), z: Math.max(0.5, Math.min(41.5, nz)) };
        this.pos.x = c.x;
        this.pos.z = c.z;
        this.pos.rot = Math.atan2(dx, dz);
        moving = true;
        if (this.alive) audio.footstep(this.pos.x, this.pos.z);
      }
    }
    this.moving = moving;
    // отправка позиции
    if (ph === 'work' && now - this.lastSend > 66) {
      const sp = this.sentPos;
      const changed = !sp || Math.abs(sp.x - this.pos.x) > 0.01 || Math.abs(sp.z - this.pos.z) > 0.01 || Math.abs(sp.rot - this.pos.rot) > 0.02 || sp.moving !== moving;
      if (changed || now - this.lastSend > 500) {
        this.send({ t: 'mv', x: +this.pos.x.toFixed(3), z: +this.pos.z.toFixed(3), rot: +this.pos.rot.toFixed(3), a: now < this.waveUntil ? 'wave' : null });
        this.sentPos = { ...this.pos, moving };
        this.lastSend = now;
      }
    }
    this.interpolate(now);
    // свой персонаж
    const meChar = this.r.chars.get(this.myId);
    if (meChar && ph !== 'final') {
      const kind = this.working ? STATION_BY_ID[this.working.work.station]?.kind || 'rummage' : null;
      let anim = this.working ? 'work' : moving ? 'walk' : 'idle';
      if (this.me?.carry === 'cart' && !this.working) anim = moving ? 'carry' : 'idle';
      if (now < this.waveUntil && !moving && !this.working) anim = 'wave';
      if (ph === 'meeting' || (ph === 'intro' && this._serverAnim === 'sit')) anim = this._serverAnim || anim;
      if (ph !== 'meeting') Object.assign(meChar, { x: this.pos.x, z: this.pos.z, rot: this.pos.rot, anim, kind, carry: this.me?.carry, visible: this.alive || ph !== 'work', speed: 1 });
    }
    // камера
    let focus = this.pos;
    if (!this.alive && ph === 'work') {
      const others = [...this.r.chars.values()].filter((c) => !c.npc && c.visible && c.id !== this.myId && this.world?.alive?.[c.id]);
      if (others.length) {
        const t = others[this.spectateIdx % others.length];
        focus = { x: t.x, z: t.z, rot: t.rot };
        this.hud.spectate(`Наблюдение: ${this.nameOf(t.id)} · [Tab] — следующий`);
        this.pos.x = t.x; this.pos.z = t.z;
      }
    } else this.hud.spectate(null);
    if (ph === 'meeting') this.meetingCamera(dt);
    audio.listener = { x: focus.x, z: focus.z, yaw: this.r.cam.yaw };
    // действия и HUD (10 Гц)
    this._hudT = (this._hudT || 0) + dt;
    if (this._hudT > 0.1) {
      this._hudT = 0;
      this._actions = this.computeActions();
      this.hud.prompts(this._actions.map((a) => ({ key: a.key, label: a.label, cls: `${a.cls || ''} ${a.disabled ? 'prompt-disabled' : ''}` })));
      this.hud.update({
        phase: this.phase, phaseLeft: left, shift: this.phase?.shift, clock: this.clock, world: this.world, me: this.me,
        role: this.role, alive: this.alive, pos: this.pos, zone: zoneAt(this.pos.x, this.pos.z),
      });
      if (this.meeting && this.mt.visible()) this.mt.tick(left);
      this.journalSightings();
    }
    this.r.render(dt, focus);
    this.updateLabels();
  }

  interpolate(now) {
    const snaps = this.snaps;
    if (!snaps.length) return;
    const rt = now - INTERP_DELAY;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].t <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
    }
    const k = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
    const amap = new Map(a.ps.map((p) => [p[0], p]));
    const seen = new Set();
    for (const pb of b.ps) {
      const id = pb[0];
      seen.add(id);
      const c = this.r.chars.get(id);
      if (!c) continue;
      const pa = amap.get(id) || pb;
      const anim = ANIMS[pb[4]] || 'idle';
      if (id === this.myId) {
        this._serverAnim = anim;
        if (this.phase?.name === 'meeting' || this.phase?.name === 'smoke' || (this.phase?.name === 'intro')) {
          Object.assign(c, { x: pb[1], z: pb[2], rot: pb[3], anim, visible: true });
          this.pos.x = pb[1]; this.pos.z = pb[2]; this.pos.rot = pb[3];
        }
        continue;
      }
      let dr = pb[3] - pa[3];
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      const st = pb[5] >= 0 ? STATIONS[pb[5]] : null;
      const x = pa[1] + (pb[1] - pa[1]) * k;
      const z = pa[2] + (pb[2] - pa[2]) * k;
      const sp = Math.hypot(pb[1] - pa[1], pb[2] - pa[2]) / Math.max(0.05, (b.t - a.t) / 1000) / 3.6;
      Object.assign(c, {
        x, z, rot: pa[3] + dr * k, anim, kind: st?.kind || null, carry: pb[6] || null,
        visible: (!(pb[7] & 1) || !this.alive) && !this.soloShot, speed: Math.max(0.6, Math.min(1.4, sp || 1)),
      });
      if (anim === 'walk' && c.visible) audio.footstep(x, z);
    }
    for (const [id, c] of this.r.chars) {
      if (c.npc || id === this.myId) continue;
      if (!seen.has(id)) c.visible = false;
    }
  }

  // Журнал: кого и в какой зоне видели (автоматически)
  journalSightings() {
    if (this.phase?.name !== 'work' || !this.alive) return;
    const now = performance.now();
    if (now - this.journalTick < 4000) return;
    this.journalTick = now;
    for (const [id, c] of this.r.chars) {
      if (c.npc || id === this.myId || !c.visible) continue;
      const zone = zoneAt(c.x, c.z);
      const last = this.lastZoneSeen[id];
      if (!last || last.zone !== zone || now - last.t > 45000) {
        this.lastZoneSeen[id] = { zone, t: now };
        this.hud.addJournal({ oc: this.clock, kind: 'zone', text: `${this.nameOf(id)} — ${ZONE_BY_ID[zone].loc}` });
      }
    }
  }

  // Камера планёрки: общий план стола и наезды на говорящих
  cutTo(id) {
    if (this.phase?.name !== 'meeting') return;
    const c = this.r.chars.get(id);
    if (!c || c.npc) return;
    this.camCut = { id, until: performance.now() + 3500 };
  }

  meetingCamera() {
    const now = performance.now();
    if (this.camCut && now < this.camCut.until) {
      const c = this.r.chars.get(this.camCut.id);
      if (c) {
        const fx = Math.sin(c.rot);
        const fz = Math.cos(c.rot);
        const sc = c.rig.root.scale.x || 1;
        const head = new THREE.Vector3(c.x, 1.18 * sc, c.z);
        const pos = new THREE.Vector3(c.x + fx * 1.75 - fz * 0.45, 1.42, c.z + fz * 1.75 + fx * 0.45);
        if (!this.r.cine || this.r.cine.key !== this.camCut.id) this.r.setCinematic({ key: this.camCut.id, pos, look: head, fov: 44 });
        return;
      }
    }
    if (!this.r.cine || this.r.cine.key !== 'overview') {
      this.r.setCinematic({ key: 'overview', pos: new THREE.Vector3(35, 2.55, 13.3), look: new THREE.Vector3(35, 0.7, 7.8), fov: 58, drift: 0.6 });
    }
  }

  updateLabels() {
    const show = settings.showNames && (this.phase?.name === 'work' || this.phase?.name === 'smoke');
    const allies = new Set(this.role?.allies || []);
    for (const [id, c] of this.r.chars) {
      let lab = this.labels.get(id);
      const visible = show && c.visible && c.alpha > 0.5 && id !== this.myId;
      if (!visible) { if (lab) lab.style.display = 'none'; continue; }
      const scale = c.rig.root.scale.x;
      const p = this.r.project(c.x, 2.05 * scale, c.z);
      const los = this.r.map.lineOfSight(this.pos.x, this.pos.z, c.x, c.z);
      if (!p || p.depth > 16 || !los) { if (lab) lab.style.display = 'none'; continue; }
      if (!lab) {
        lab = h('div', { class: `name-label ${c.npc ? 'npc' : ''}` }, this.nameOf(id), allies.has(id) ? h('span', { class: 'ally-star' }, ' ★') : null);
        this.labelLayer.append(lab);
        this.labels.set(id, lab);
      }
      lab.style.display = 'block';
      lab.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      lab.style.opacity = String(Math.max(0.25, 1 - p.depth / 18));
      lab.classList.toggle('talking', c.talkUntil > this.r.time);
    }
  }
}

export { STAFF, TASK_BY_ID, FURN_BY_ID, MEETING_SEATS, CARRY_NAMES, clear };
