// HUD (TZ 7.1): текущая батрачка, таймер шабашки, состояние Конторки, подсказки,
// мини-карта, журнал наблюдений, субтитры речи, уведомления.
import { h, clear } from './dom.js';
import { ZONES, WALLS, DOORS, STATION_BY_ID, ZONE_BY_ID, MAP_W, MAP_D } from '../../shared/map.js';
import { SABOTAGE_BY_ID, TRICK_BY_ID } from '../../shared/content.js';
import { fmtSec } from '../../shared/text.js';
import { settings } from '../settings.js';

const SHORT = { kvadry: 'Квадры', cabinet: 'Кабинет', openspace: 'Опенспейс', entrance: 'Входная', canteen: 'Столовая' };
const ZONE_COLORS = {
  archive: '#7a5a3a', kvadry: '#6a6e78', cabinet: '#7a2a26', tech: '#4a5a66', kassa: '#8a7a50',
  openspace: '#3f6a32', canteen: '#a8a698', entrance: '#6a665a', slop: '#4f5a2a',
};

export function createHud(root, api) {
  const el = {};
  const hud = h('div', { class: 'hud' },
    el.topLeft = h('div', { class: 'hud-tl panel' },
      h('div', { class: 'hud-shiftrow' }, el.shift = h('div', { class: 'hud-shift' }, 'Шабашка'), el.clock = h('div', { class: 'hud-clock' }, '09:00')),
      el.timeBar = h('div', { class: 'bar bar-time' }, h('div', { class: 'bar-fill' }), el.timeText = h('span', { class: 'bar-text' }, '')),
      h('div', { class: 'hud-label' }, 'План Конторки'),
      el.planBar = h('div', { class: 'bar bar-plan' }, h('div', { class: 'bar-fill' }), el.planText = h('span', { class: 'bar-text' }, '')),
      h('div', { class: 'hud-meters' },
        h('div', { class: 'meter' }, h('span', { class: 'meter-ico' }, 'Д'), h('span', { class: 'meter-name' }, 'Дебики'), el.debBar = h('div', { class: 'bar bar-deb' }, h('div', { class: 'bar-fill' })), el.debText = h('span', { class: 'meter-val' }, '0')),
        h('div', { class: 'meter' }, h('span', { class: 'meter-ico' }, 'К'), h('span', { class: 'meter-name' }, 'Кредики'), el.kredBar = h('div', { class: 'bar bar-kred' }, h('div', { class: 'bar-fill' })), el.kredText = h('span', { class: 'meter-val' }, '0')),
      ),
      el.alerts = h('div', { class: 'hud-alerts' }),
    ),
    el.tasks = h('div', { class: 'hud-tasks panel' }),
    el.topRight = h('div', { class: 'hud-tr' },
      el.mapWrap = h('div', { class: 'minimap panel', title: 'Карта [M]' }, el.map = h('canvas', { width: 224, height: 168 }), el.zoneName = h('div', { class: 'minimap-zone' }, '')),
      el.order = h('button', { class: 'order-card panel', title: 'Записюлька Хозяина [O]', onclick: () => api.openOrder() }),
    ),
    el.role = h('div', { class: 'hud-role panel' }),
    el.prompts = h('div', { class: 'hud-prompts' }),
    el.toasts = h('div', { class: 'hud-toasts' }),
    el.subs = h('div', { class: 'subtitles' }),
    el.chat = h('div', { class: 'hud-chat' },
      el.chatInput = h('input', { class: 'chat-input', maxlength: 200, placeholder: 'Сказать рядом стоящим… (Enter)' }),
    ),
    el.bigmap = h('div', { class: 'bigmap hidden' }, el.bigCanvas = h('canvas', { width: 896, height: 672 })),
    el.journal = h('div', { class: 'journal panel hidden' }),
    el.banner = h('div', { class: 'hud-banner hidden' }),
    el.spectate = h('div', { class: 'spectate hidden' }),
  );
  root.append(hud);

  el.chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = el.chatInput.value.trim();
      if (text) api.say(text);
      el.chatInput.value = '';
      el.chatInput.blur();
    } else if (e.key === 'Escape') el.chatInput.blur();
  });

  const toasts = [];
  const journal = [];
  let lastTasksKey = '';
  let lastRoleKey = '';

  const H = {
    el,
    show(v) { hud.classList.toggle('hidden', !v); },
    focusChat() { el.chatInput.focus(); },
    chatFocused() { return document.activeElement === el.chatInput; },

    toast(text, kind = 'info', ms = 4200) {
      const t = h('div', { class: `toast toast-${kind}` }, text);
      el.toasts.prepend(t);
      toasts.push(t);
      while (toasts.length > 5) toasts.shift().remove();
      setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 400); }, ms);
    },

    // Субтитры в стиле видео: белый жирный текст на тёмной плашке
    subtitle(name, text, opts = {}) {
      if (!settings.subtitles && !opts.force) return;
      const s = h('div', { class: `sub ${opts.cls || ''}` }, name ? h('div', { class: 'sub-name' }, name) : null, h('div', { class: 'sub-text' }, text));
      el.subs.append(s);
      while (el.subs.children.length > 3) el.subs.firstChild.remove();
      const ms = Math.min(7000, 2200 + text.length * 55);
      setTimeout(() => { s.classList.add('sub-out'); setTimeout(() => s.remove(), 300); }, ms);
    },

    banner(text, sub = '', ms = 3000) {
      clear(el.banner).append(h('div', { class: 'banner-text' }, text), sub ? h('div', { class: 'banner-sub' }, sub) : null);
      el.banner.classList.remove('hidden');
      clearTimeout(H._bt);
      if (ms) H._bt = setTimeout(() => el.banner.classList.add('hidden'), ms);
    },

    prompts(list) {
      const key = list.map((p) => p.key + p.label).join('|');
      if (key === H._pk) return;
      H._pk = key;
      clear(el.prompts);
      for (const p of list) el.prompts.append(h('div', { class: `prompt ${p.cls || ''}` }, h('span', { class: 'key' }, p.key), h('span', {}, p.label)));
    },

    update(v) {
      // Шабашка и время
      const ph = v.phase;
      const shiftName = ph?.name === 'work' ? (v.shift === 3 ? 'Финальная шабашка' : `Шабашка №${v.shift}`) : ph?.name === 'smoke' ? 'Перекур' : ph?.name === 'meeting' ? 'Планёрка' : 'Вводная';
      el.shift.textContent = shiftName;
      el.clock.textContent = v.clock || '';
      const left = v.phaseLeft ?? 0;
      el.timeText.textContent = ph?.name === 'work' ? `осталось ${fmtSec(left)}` : '';
      el.timeBar.firstChild.style.width = ph?.dur ? `${Math.max(0, Math.min(100, (left / ph.dur) * 100))}%` : '0%';
      el.timeBar.classList.toggle('bar-urgent', ph?.name === 'work' && left < 30);
      const w = v.world;
      if (w) {
        const pct = Math.round((w.plan / Math.max(1, w.planTarget)) * 100);
        el.planBar.firstChild.style.width = `${Math.min(100, pct)}%`;
        el.planText.textContent = `${w.plan} / ${w.planTarget} (${pct}%)`;
        el.planBar.classList.toggle('bar-done', pct >= 100);
        el.debBar.firstChild.style.width = `${w.debiki}%`;
        el.kredBar.firstChild.style.width = `${w.krediki}%`;
        el.debText.textContent = String(w.debiki);
        el.kredText.textContent = String(w.krediki);
        el.debBar.classList.toggle('bar-warn', w.debiki >= 60);
        el.kredBar.classList.toggle('bar-warn', w.krediki >= 50);
        // тревоги
        const al = [];
        if (w.accel) al.push(`⚠ ПЕРЕГРУЗКА УСКОРИТЕЛЯ: ${Math.ceil(w.accel.left)} с (панели ${w.accel.panels.length}/2)`);
        for (const z of Object.keys(w.dark || {})) al.push(`Нет света: ${ZONE_BY_ID[z].name}`);
        if (w.krediki >= 50) al.push('Кредики ≥ 50: задачи могут срываться');
        if (w.debiki >= 60) al.push('Дебики ≥ 60: все ходят медленнее');
        const ak = al.join('|');
        if (ak !== H._ak) { H._ak = ak; clear(el.alerts); for (const a of al) el.alerts.append(h('div', { class: 'alert' }, a)); }
        // записюлька
        const o = w.order;
        const ok = o ? `${o.id}${o.version}` : '';
        if (ok !== H._ok) {
          H._ok = ok;
          clear(el.order);
          if (o) el.order.append(h('div', { class: 'order-type' }, `Записюлька Хозяина · ${o.type}${o.version > 1 ? ` · версия ${o.version}` : ''}`), h('div', { class: 'order-title' }, o.title));
        }
      }
      // задачи
      const me = v.me;
      if (me) {
        const tk = JSON.stringify(me.tasks.map((t) => [t.uid, t.step, t.name])) + (me.carry || '') + JSON.stringify(me.restricted);
        if (tk !== lastTasksKey) {
          lastTasksKey = tk;
          clear(el.tasks);
          el.tasks.append(h('div', { class: 'panel-title' }, 'Батрачка'));
          if (!me.tasks.length) {
            const txt = v.phase?.name === 'intro' ? 'Батрачку выдадут с началом шабашки.' : v.alive ? 'Батрачка сделана. Возьми доп. задачу у доски поручений во Входной или наблюдай.' : '—';
            el.tasks.append(h('div', { class: 'task-empty' }, txt));
          }
          for (const t of me.tasks) {
            const st = STATION_BY_ID[t.steps[t.step]];
            el.tasks.append(h('div', { class: `task ${t.forged ? 'task-forged' : ''}` },
              h('div', { class: 'task-name' }, t.name, t.steps.length > 1 ? h('span', { class: 'task-step' }, ` ${t.step + 1}/${t.steps.length}`) : null),
              h('div', { class: 'task-where' }, st ? `→ ${st.name} · ${ZONE_BY_ID[st.zone].name}` : ''),
              t.forged || t.source !== 'Хозяин' ? h('div', { class: 'task-src' }, `Источник: ${t.source}`) : null,
            ));
          }
          if (me.carry) el.tasks.append(h('div', { class: 'task-carry' }, `В руках: ${{ folder: 'папка (на стол архивариуса)', cart: 'тележка (к двери)', cabbage: 'капуста (в Столовую)' }[me.carry]}`));
          if (me.restricted) el.tasks.append(h('div', { class: 'task-restricted' }, `Ограничение: ${ZONE_BY_ID[me.restricted.zone].name} (${me.restricted.left} с)`));
        }
        // роль
        const rk = JSON.stringify([v.role?.role, me.cd > 0 ? Math.ceil(me.cd) : 0, me.trickUsed, me.checks, me.calls, me.bellUsed, me.kukishi, me.promises, me.sanctionsLeft, v.alive]);
        if (rk !== lastRoleKey && v.role) {
          lastRoleKey = rk;
          renderRole(el.role, v, api);
        }
      }
      // мини-карта
      if ((H._mt = (H._mt || 0) + 1) % 3 === 0) drawMap(el.map, v, false);
      if (!el.bigmap.classList.contains('hidden')) drawMap(el.bigCanvas, v, true);
      el.zoneName.textContent = v.zone ? ZONE_BY_ID[v.zone].name : '';
    },

    toggleMap() { el.bigmap.classList.toggle('hidden'); },

    addJournal(entry) {
      journal.push(entry);
      if (journal.length > 250) journal.shift();
      if (!el.journal.classList.contains('hidden')) H.renderJournal();
    },
    journalEntries() { return journal; },
    toggleJournal(force) {
      const show = force ?? el.journal.classList.contains('hidden');
      el.journal.classList.toggle('hidden', !show);
      if (show) H.renderJournal();
    },
    renderJournal() {
      clear(el.journal);
      el.journal.append(h('div', { class: 'panel-title' }, 'Журнал наблюдений [J]', h('button', { class: 'btn-x', onclick: () => H.toggleJournal(false) }, '×')));
      el.journal.append(h('div', { class: 'journal-hint' }, 'Записывается само: кого и где вы видели. На планёрке запись можно предъявить.'));
      const list = h('div', { class: 'journal-list' });
      for (const e of journal.slice().reverse().slice(0, 120)) list.append(h('div', { class: `jrow j-${e.kind}` }, h('span', { class: 'jtime' }, e.oc), h('span', {}, e.text)));
      el.journal.append(list);
    },

    spectate(text) {
      el.spectate.classList.toggle('hidden', !text);
      if (text) el.spectate.textContent = text;
    },
  };
  return H;
}

function renderRole(root, v, api) {
  clear(root);
  const r = v.role;
  const me = v.me;
  root.append(h('div', { class: `role-chip role-${r.role}` }, r.roleName));
  root.append(h('div', { class: 'role-money' }, `Кукиши: ${me.kukishi}`, h('span', { class: 'role-prom' }, ` · Обещания: ${me.promises}`)));
  if (!v.alive) { root.append(h('div', { class: 'role-line' }, 'Вы уволены. Наблюдайте [Tab].')); return; }
  if (r.role === 'vreditel' && r.sab) {
    root.append(h('div', { class: 'role-line' }, me.cd > 0 ? `Саботаж: перезарядка ${Math.ceil(me.cd)} с` : 'Саботаж готов [F у объекта]'));
    const list = h('div', { class: 'sab-list' });
    for (const id of r.sab.loadout) {
      const s = SABOTAGE_BY_ID[id];
      list.append(h('div', { class: 'sab-item', title: `${s.cat}. Где: ${s.stations.map((x) => STATION_BY_ID[x]?.name || 'тележка в Слоповине').slice(0, 3).join(', ')}` }, s.name, h('span', { class: 'sab-where' }, ` — ${s.stations[0] === 'slop_cart' ? 'тележка (Слоповина)' : ZONE_BY_ID[STATION_BY_ID[s.stations[0]].zone].name}`)));
    }
    root.append(list);
    const tr = TRICK_BY_ID[r.sab.trick];
    root.append(h('button', { class: 'btn btn-small btn-sab', disabled: me.trickUsed, onclick: () => api.openTrick() }, me.trickUsed ? `${tr.name}: использован` : `[T] ${tr.name}`));
    if (r.allies?.length) root.append(h('div', { class: 'role-line role-allies' }, 'Союзники: ', r.allies.map((id) => api.playerName(id)).join(', ')));
  } else if (r.role === 'director') {
    root.append(h('button', { class: 'btn btn-small', disabled: !me.calls, onclick: () => api.callMeeting() }, `[B] Созвать планёрку (${me.calls})`));
    root.append(h('div', { class: 'role-line' }, `Санкций осталось: ${me.sanctionsLeft ?? '—'}`));
  } else if (r.role === 'alesya') {
    root.append(h('div', { class: 'role-line' }, `Квадровых проверок: ${me.checks}. Терминал — Отдел квадров [R].`));
  } else if (r.role === 'dusya') {
    root.append(h('div', { class: 'role-line' }, 'Журнал кукишей — у тумбы кассы [R].'));
  } else {
    root.append(h('div', { class: 'role-line' }, 'Работай и наблюдай. Видишь поломку — чини!'));
  }
  if (!me.bellUsed) root.append(h('div', { class: 'role-line role-dim' }, 'Звонок планёрки — в Кабинете Директора (1 раз).'));
  root.append(h('div', { class: 'role-keys' }, '[G] поздороваться · [J] журнал · [M] карта · [Enter] сказать · [1–5] фразы'));
}

function drawMap(canvas, v, big) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const Hh = canvas.height;
  const s = Math.min(W / MAP_W, Hh / MAP_D);
  ctx.clearRect(0, 0, W, Hh);
  ctx.fillStyle = 'rgba(10,10,12,0.85)';
  ctx.fillRect(0, 0, W, Hh);
  for (const z of ZONES) {
    const dark = v.world?.dark?.[z.id];
    ctx.fillStyle = dark ? '#151515' : ZONE_COLORS[z.id];
    ctx.globalAlpha = 0.75;
    ctx.fillRect(z.x0 * s, z.z0 * s, (z.x1 - z.x0) * s, (z.z1 - z.z0) * s);
    ctx.globalAlpha = 1;
    if (big || W > 200) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${big ? 16 : 9}px Montserrat, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(big ? z.name : (SHORT[z.id] || z.name), ((z.x0 + z.x1) / 2) * s, ((z.z0 + z.z1) / 2) * s + (big ? 5 : 3));
    }
  }
  ctx.fillStyle = '#e8e0c8';
  for (const w of WALLS) ctx.fillRect(w.x0 * s, w.z0 * s, Math.max(1, (w.x1 - w.x0) * s), Math.max(1, (w.z1 - w.z0) * s));
  for (const d of DOORS) {
    const st = v.world?.doors?.[d.id];
    if (!st) continue;
    ctx.fillStyle = st === 'cart' ? '#e0a020' : '#c02020';
    ctx.fillRect(d.rect.x0 * s - 1, d.rect.z0 * s - 1, (d.rect.x1 - d.rect.x0) * s + 2, (d.rect.z1 - d.rect.z0) * s + 2);
  }
  const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.4;
  // цели задач
  if (v.me) {
    for (const t of v.me.tasks) {
      const st = STATION_BY_ID[t.steps[t.step]];
      if (!st) continue;
      ctx.fillStyle = `rgba(255,220,60,${pulse})`;
      ctx.beginPath(); ctx.arc(st.x * s, st.z * s, big ? 7 : 3.5, 0, Math.PI * 2); ctx.fill();
      if (big) { ctx.fillStyle = '#ffe680'; ctx.font = '12px Montserrat, sans-serif'; ctx.fillText(t.name, st.x * s, st.z * s - 10); }
    }
  }
  // открытые инциденты
  for (const inc of v.world?.incidents || []) {
    if (!inc.open || inc.x == null) continue;
    ctx.fillStyle = `rgba(255,60,40,${pulse})`;
    ctx.font = `bold ${big ? 20 : 11}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('!', inc.x * s, inc.z * s + 4);
  }
  // я
  if (v.pos) {
    ctx.save();
    ctx.translate(v.pos.x * s, v.pos.z * s);
    ctx.rotate(-v.pos.rot + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -(big ? 10 : 6)); ctx.lineTo(big ? 6 : 4, big ? 7 : 4); ctx.lineTo(-(big ? 6 : 4), big ? 7 : 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
